require "test_helper"

class LiveControllerTest < ActionDispatch::IntegrationTest
  test "GET /live renders successfully" do
    get live_url
    assert_response :success
  end
end
