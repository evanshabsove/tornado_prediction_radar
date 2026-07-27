class StormsController < ApplicationController
  def index
    @radar_api_base_url = Rails.application.config.x.radar_api_base_url
  end
end
