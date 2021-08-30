#!/usr/bin/env DENO_DIR=/tmp deno run --include-files ../util/**/*

export default async ({ request }: Deno.RequestEvent) => {
	const name = new URL(request.url).searchParams.get('name') ?? 'a';
	const mod = await import(`../util/${name}`);
	return new Response(mod);
};
