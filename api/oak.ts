import { Application } from 'https://deno.land/x/oak@v9.0.0/mod.ts';

const app = new Application();

app.use((ctx) => {
	ctx.response.body = 'Hello World!';
	console.log(ctx);
});

export default app.handle;
