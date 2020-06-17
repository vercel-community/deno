import { ServerRequest } from 'https://deno.land/std@0.57.0/http/server.ts';

// In the current Oak, the `handleRequest()` function is private.
import { Application } from "https://raw.githubusercontent.com/TooTallNate/oak/1ef8db7fa4f3efbd8b0b15440f024ae68c705dc4/mod.ts";

const app = new Application();

app.use((ctx) => {
  ctx.response.body = "Hello World!";
  console.log(ctx);
});

export default app.handleRequest;
