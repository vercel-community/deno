export const config = {
	runtime: 'deno',
	env: {
		DENO_DIR: '/tmp'
	},
	includeFiles: ['../util/**/*']
};

export default async ({ request }: Deno.RequestEvent) => {
	const name = new URL(request.url).searchParams.get('name') ?? 'a';
	const mod = await import(`../util/${name}.ts`);
	console.log({ name, mod });
	return new Response(mod.default);
};
