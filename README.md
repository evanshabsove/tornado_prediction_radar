# Tornado Prediction Radar

A Rails front end for visualizing live radar reflectivity and modeled tornado probability. It
renders three map-based views — a searchable single-storm predictor, a live single-site heatmap,
and a national overview — and pulls all storm, radar, and prediction data from an external
**Radar API** service at request time.

This app owns no storm data itself: it's a thin Hotwire/Leaflet UI over that API.

## Features

- **Storm search (`/`)** — search by storm ID and view its latest reflectivity scan plus tornado
  probability from three models (`no_madis`, `madis`, `madis_film`), tiered into low/moderate/high risk.
- **Live site view (`/live`)** — pick a reporting radar site and watch its heatmap auto-refresh, with
  staleness detection if the feed goes quiet.
- **National overview (`/national`)** — aggregates every reporting site into a single national heatmap
  with per-site peak-probability markers and optional radar image overlays.

## Requirements

- Ruby (see `.ruby-version`)
- SQLite 3
- A running instance of the Radar API this app talks to

No Node.js toolchain is required — JavaScript dependencies are pinned via `importmap-rails` and
styling uses the Tailwind CSS standalone CLI (`tailwindcss-rails`).

## Setup

```bash
bin/setup
```

This installs gems, prepares the local SQLite databases, and starts the dev server. Pass
`--skip-server` to provision without starting Puma.

## Configuration

The app needs to know where the Radar API lives:

```bash
export RADAR_API_BASE_URL=http://localhost:5050  # default if unset
```

See `config/initializers/radar_api.rb`.

## Running locally

```bash
bin/dev
```

Then visit `http://localhost:3000`.

## Testing

```bash
bin/rails test
```

Run a single file or test with:

```bash
bin/rails test test/controllers/storms_controller_test.rb
bin/rails test test/controllers/storms_controller_test.rb -n "/renders successfully/"
```

## Linting & security checks

```bash
bin/rubocop               # Ruby style (Omakase Rails style)
bin/brakeman              # static security analysis
bin/bundler-audit         # gem CVE audit
bin/importmap audit       # JS dependency CVE audit
```

Or run the full CI pipeline locally with `bin/ci` (see `config/ci.rb`).

## Deployment

Deployed as a Docker container via [Kamal](https://kamal-deploy.org); see `config/deploy.yml`.

```bash
bin/kamal deploy
```

## Tech stack

Rails 8, Hotwire (Turbo + Stimulus), Leaflet.js, Tailwind CSS, SQLite (with Solid Cache / Solid
Queue / Solid Cable), Propshaft, Kamal.
