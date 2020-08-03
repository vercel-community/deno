import { Drash } from "https://deno.land/x/drash@v1.x/mod.ts";

class HomeResource extends Drash.Http.Resource {
  static paths = ["/api/drash"];
  public GET() {
    this.response.body = "Hello World!";
    return this.response;
  }
}

const server = new Drash.Http.Server({
  response_output: "text/html",
  resources: [HomeResource]
});

export default server.handleHttpRequest.bind(server);
