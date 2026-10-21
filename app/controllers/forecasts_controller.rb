class ForecastsController < ApplicationController
  def index
    @forecast_api_base_url = Rails.application.config.x.forecast_api_base_url
  end
end
