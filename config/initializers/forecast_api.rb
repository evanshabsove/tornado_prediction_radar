# Browsers refuse to connect to some ports (5060 and 5061 among them), so the forecast API's old
# default of 5060 can never work from a page's fetch(). Run the API with PORT=5070.
Rails.application.config.x.forecast_api_base_url =
  ENV.fetch("FORECAST_API_BASE_URL", "http://localhost:5070")
