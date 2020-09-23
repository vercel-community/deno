import { opine } from "https://deno.land/x/opine@0.22.2/mod.ts";

const app = opine();

app.use((req, res) => {
  res.send("Hello World");
});

export default app;
