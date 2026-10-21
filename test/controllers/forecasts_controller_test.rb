require "test_helper"

class ForecastsControllerTest < ActionDispatch::IntegrationTest
  test "GET /forecast renders successfully" do
    get forecast_url
    assert_response :success
  end

  test "GET /forecast threads the forecast API base URL into each Stimulus controller" do
    base_url = Rails.application.config.x.forecast_api_base_url

    get forecast_url

    %w[forecast-select forecast-map forecast-reports forecast-legend].each do |controller|
      assert_select "[data-#{controller}-api-base-url-value=?]", base_url
    end
  end

  test "GET /forecast does not use the radar API base URL" do
    get forecast_url

    assert_select "[data-forecast-map-api-base-url-value=?]", Rails.application.config.x.radar_api_base_url, count: 0
  end

  test "GET /forecast offers live and replay modes and a verification panel" do
    get forecast_url

    assert_select "button[data-mode=live]"
    assert_select "button[data-mode=replay]"
    assert_select "[data-forecast-reports-target=panel].hidden"
    assert_select "[data-forecast-map-target=retrospectiveNote].hidden"
  end

  test "navigation links to the forecast page" do
    get root_url

    assert_select "nav a[href=?]", forecast_path, text: "Forecast"
  end
end
