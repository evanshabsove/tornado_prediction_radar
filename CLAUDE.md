# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A Rails 8 front end for a tornado-detection radar system. This repo has **no domain models
and no application database tables** — it renders three pages (storm search, live site view,
national overview) whose Stimulus/Leaflet JavaScript talks directly to an external "Radar API"
HTTP service for all storm/radar/prediction data. Rails here is purely the delivery mechanism
(routing, layout, asset pipeline) for that JS.

The Radar API base URL is configured once in `config/initializers/radar_api.rb` via
`Rails.application.config.x.radar_api_base_url`, read from `ENV["RADAR_API_BASE_URL"]`
(defaults to `http://localhost:5050` in development). Each controller (`StormsController`,
`LiveController`, `NationalController`) just assigns `@radar_api_base_url` and renders a view;
that value is threaded into `data-*-api-base-url-value` attributes for the Stimulus controllers
to read. If you add a new page that calls the Radar API, follow this same pattern rather than
hardcoding the URL.

## Commands

- `bin/setup` — install gems, prepare the sqlite dbs (cache/queue/cable), start the dev server. Use `--skip-server` to just provision.
- `bin/dev` — run the development server (Puma via Procfile.dev).
- `bin/rails test` — run the full test suite. Run a single file with `bin/rails test test/controllers/storms_controller_test.rb`, or a single test with `bin/rails test test/controllers/storms_controller_test.rb -n "/renders successfully/"`.
- `bin/rubocop` — lint/style check (Omakase Rails style, see `.rubocop.yml`). Add `-a` to autocorrect.
- `bin/brakeman --quiet --no-pager --exit-on-warn --exit-on-error` — static security analysis.
- `bin/bundler-audit` — audit gems for known CVEs.
- `bin/importmap audit` — audit pinned JS packages for known CVEs.
- `bin/ci` — runs the full CI pipeline locally (setup, rubocop, bundler-audit, importmap audit, brakeman, tests, seed replant) — see `config/ci.rb` for the exact steps; mirror this before pushing if you want to reproduce CI.
- `bin/kamal deploy` — deploy via Kamal (see `config/deploy.yml`). Aliases: `bin/kamal console`, `bin/kamal shell`, `bin/kamal logs`, `bin/kamal dbc`.

## Architecture

**Routing → controller → view is trivial by design.** `config/routes.rb` maps `/` → `storms#index`,
`/live` → `live#index`, `/national` → `national#index`. Each controller has a single `index` action
whose only job is exposing `@radar_api_base_url`. All real logic — fetching storm lists, predictions,
heatmap tiles, site status — lives in the page's Stimulus controller(s) under
`app/javascript/controllers/`, which `fetch()` the Radar API directly from the browser:

- **`storm_search_controller.js`** (used on `/`) — loads storm IDs from `/storms/madis`, provides a
  typeahead/combobox, and dispatches a `storm-search:selected` custom event with the chosen storm ID.
- **`radar_map_controller.js`** (used on `/`, listens for `storm-search:selected`) — fetches
  `/predict/:stormId`, renders a Leaflet marker + optional radar reflectivity image overlay, and shows
  per-model probability badges (`no_madis`, `madis`, `madis_film`) tiered into low/moderate/high risk.
- **`live_site_select_controller.js`** (used on `/live`) — loads `/live/sites` and dispatches a
  `live-site-select:selected` event when the user changes site.
- **`live_heatmap_map_controller.js`** (used on `/live`, listens for site selection) — polls a single
  site's heatmap on an interval (`POLL_INTERVAL_MS`), flags data as stale after
  `STALE_THRESHOLD_SECONDS`, and renders a custom color ramp (not Leaflet.heat) over the site's tiles.
- **`national_heatmap_map_controller.js`** (used on `/national`) — fetches `/live/sites`, then
  fan-outs a fetch to `/live/:site/heatmap` for every `ok` site, aggregates each site's peak probability
  and centroid, and renders a `Leaflet.heat` layer plus per-site markers/tooltips across the whole map.
  Read the inline comments here before touching `HEAT_MAX`/`HEAT_RADIUS`/`maxZoom` — the values encode
  non-obvious workarounds for how Leaflet.heat scales weight by zoom level.

Stimulus controllers on the same page communicate exclusively via custom DOM events
(`data-action="controllerA:eventName->controllerB#handler"`) rather than direct references — follow
that convention for any new cross-controller wiring instead of reaching into another controller's state.

**No Node toolchain**: JS dependencies (`leaflet`, `leaflet.heat`, Turbo, Stimulus) are pinned in
`config/importmap.rb` and served via `importmap-rails`/Propshaft — there is no `package.json`/bundler
build step. Styling is Tailwind CSS via the `tailwindcss-rails` gem (standalone CLI, no Node required).

**Persistence**: `solid_cache`, `solid_queue`, and `solid_cable` are configured as separate sqlite
databases (`db/cache_schema.rb`, `db/queue_schema.rb`, `db/cable_schema.rb`; see `config/database.yml`
and `config/cache.yml`/`config/queue.yml`/`config/cable.yml`). There is no primary application schema —
don't assume ActiveRecord models exist for storms/predictions/sites; that data only ever lives in the
external Radar API's response payloads.

**Deployment**: Dockerized via Kamal (`config/deploy.yml`, `.kamal/`), single web server, sqlite
storage on a persistent volume, Solid Queue supervisor run in-process with Puma
(`SOLID_QUEUE_IN_PUMA=true`).

## Forecast pages

A second feature: a `/forecast` page backed by a *separate* Flask API (the HRRR U-Net ensemble from the sibling
`short_term_tornado_predictor` repo, base URL via `FORECAST_API_BASE_URL`, default `http://localhost:5070`), not the Radar API
above. The tickets, the API contract and the tier evidence are in `docs/forecast/` (start with `docs/forecast/README.md`; those
files are snapshots and still say port 5060). Tickets 9 (page) and 10 (SPC verification overlay) are built, and the Rails half of 11
is in `config/deploy.yml`; what remains of 11 is deploying the Python API itself. Follow the existing conventions (controller exposes
a base-URL ivar, Stimulus `fetch()`es the API, custom DOM events between controllers). Do not reuse `radar_map_controller.js`'s
probability cutoffs; the forecast API sends tiers per cell and the client never computes them.

The page is `ForecastsController#index` + four Stimulus controllers on one root element, with shared helpers in
`app/javascript/lib/` (pinned as `lib/*` in `config/importmap.rb`):

- **`forecast_select_controller.js`** — a Live/Replay mode toggle, the run `<select>` (live: `/forecasts`, polled every 5 minutes;
  replay: `/replays`, grouped by case) and the two 4-hour bin buttons. Dispatches `forecast-select:selected` with
  `{ mode, id, initTime, bin, stale, latest }`.
- **`forecast_map_controller.js`** — listens for that event, fetches `/forecast/<id>` or `/replay/<id>` (separate namespaces in the
  API) and `/grid` (once), and draws one Leaflet canvas polygon per cell coloured by the API's tier code (`lib/forecast_tiers.js`).
  Cells are non-interactive; hover is a bounding-box lookup (`cellAt`) because per-layer hit-testing on ~11k canvas paths is slow.
  Age is computed client-side from `init_time` (a revalidated 304 leaves the body's `age_seconds` old). Replays show the API's
  `note` and a "Retrospective replay" badge instead of age/staleness. Also draws SPC reports (SVG, own pane above the cells) when
  it receives `forecast-reports:loaded`, and removes them on `forecast-reports:cleared`.
- **`forecast_reports_controller.js`** — replay only: fetches `/reports` for the selected bin's valid window and dispatches
  `forecast-reports:loaded` / `cleared`. It never touches the map. Timestamps sent to the API must be `YYYY-MM-DDTHH:MM:SSZ`
  (`binWindow` strips the `.000` that `toISOString` adds; the API answers 400 otherwise).
- **`forecast_legend_controller.js`** — renders `/tiers` (hit rate, area share, capture share, wording caveats). No number in
  the legend is hardcoded.

**Browsers refuse to connect to port 5060** (SIP; Chrome reports `ERR_UNSAFE_PORT`), so a page that `fetch()`es the API there
fails with "Failed to fetch" while `curl` works. Run the API with `PORT=5070 python api/app.py`; that is also this app's default.
In production the URL must be public, https if this app is, and the API's `FORECAST_CORS_ORIGINS` must allow this app's origin
(see the comments in `config/deploy.yml`, which sets both `FORECAST_API_BASE_URL` and `RADAR_API_BASE_URL`; both are placeholders until
the real hosts are chosen).
