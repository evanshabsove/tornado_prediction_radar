require "test_helper"

class StormsControllerTest < ActionDispatch::IntegrationTest
  test "GET / renders successfully" do
    get root_url
    assert_response :success
  end
end
