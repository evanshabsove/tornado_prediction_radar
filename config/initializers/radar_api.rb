Rails.application.config.x.radar_api_base_url =
  ENV.fetch("RADAR_API_BASE_URL", "http://localhost:5050")
