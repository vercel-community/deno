import { Application } from 'https://deno.land/x/oak@v11.1.0/mod.ts';

const app = new Application();

app.use((ctx) => {
	ctx.response.body = 'Hello World from Oak!';
});

export default app.handle;
