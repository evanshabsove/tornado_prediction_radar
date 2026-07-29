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
