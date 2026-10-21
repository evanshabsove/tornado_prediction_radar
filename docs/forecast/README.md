# Forecast integration docs

Snapshots from the `short_term_tornado_predictor` project for adding the tornado **forecast** pages to this app.

| file | what it is |
|---|---|
| `forecast_api_tickets.md` | The full ticket set. Open here: **9** (Rails forecast page), **10** (SPC verification overlay), **11** (deployment, Rails half). 1-8 are done and documented in the Python repo. |
| `forecast_api_contract.md` | The Flask API contract (routes, payloads, error codes, caching, wording rules). Code against this. |
| `tier_study_results.md` | Measured meaning of the Low / Elevated / High tiers; source for the legend's hit rates and area shares. |

The API runs from the Python repo (`api/app.py`, port 5060). To develop against it:

```
cd ../short_term_tornado_predictor && source .venv/bin/activate
python scripts/09_serving/run_forecast_job.py   # fills data/live/ with the latest forecasts
python api/app.py                               # serves on :5060
```

Order: 9 first, then 10 (needs 9's map), then 11.
