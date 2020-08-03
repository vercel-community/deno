import { Application } from 'https://deno.land/x/oak@v6.0.1/mod.ts';

const app = new Application();

app.use((ctx) => {
	ctx.response.body = 'Hello World!';
	console.log(ctx);
});

export default app.handle;
