#!/usr/bin/env DENO_DIR=/tmp deno run --include-files ../util/**/*

export default async (request: Request) => {
	const name = new URL(request.url).searchParams.get('name') ?? 'a';
	const mod = await import(`../util/${name}.ts`);
	console.log({ name, mod });
	return new Response(mod.default);
};
