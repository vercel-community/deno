import { Application } from 'https://deno.land/x/oak@v10.4.0/mod.ts';

const app = new Application();

app.use((ctx) => {
	ctx.response.body = 'Hello World!';
	console.log(ctx);
});

export default ({ request }: Deno.RequestEvent) => app.handle(request) as Promise<Response>;
