import { Application } from 'https://deno.land/x/oak/mod.ts';

const app = new Application();

app.use((ctx) => {
	ctx.response.body = 'Hello World!';
	console.log(ctx);
});

export default app.handle.bind(app);
