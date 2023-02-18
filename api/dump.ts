#!/usr/bin/env deno run --location https://example.com/page
import ms from 'https://esm.sh/ms@2.1.3';
import type { Handler } from 'https://deno.land/std@0.177.0/http/server.ts';

const startTime = new Date();

function urlToObject(url: URL) {
	return {
		href: url.href || undefined,
		origin: url.origin || undefined,
		protocol: url.protocol || undefined,
		username: url.username || undefined,
		password: url.password || undefined,
		host: url.host || undefined,
		hostname: url.hostname || undefined,
		port: url.port || undefined,
		pathname: url.pathname || undefined,
		search: url.search || undefined,
		hash: url.hash || undefined,
	};
}

function sortObject<T extends Record<string, unknown>>(obj: T): T {
	const sorted: T = Object.create(Object.getPrototypeOf(obj));
	const keys = Object.keys(obj).sort() as (keyof T)[];
	for (const k of keys) {
		sorted[k] = obj[k];
	}
	return sorted;
}

const handler: Handler = async (request) => {
	const now = new Date();
	const uptime = now.getTime() - startTime.getTime();
	const url = new URL(request.url);
	const status =
		parseInt(url.searchParams.get('statusCode') ?? '', 10) || 200;

	const env = Deno.env.toObject();
	for (const key of Object.keys(env)) {
		if (/^_?AWS/.test(key)) {
			delete env[key];
		}
	}

	const reqBody = await request.arrayBuffer();

	const body = {
		now: now.getTime(),
		bootup: startTime.getTime(),
		uptime,
		nowHuman: now.toUTCString(),
		bootupHuman: startTime.toUTCString(),
		uptimeHuman: ms(uptime),
		request: {
			method: request.method,
			url: urlToObject(url),
			headers: sortObject(Object.fromEntries(request.headers)),
			body:
				reqBody.byteLength > 0
					? new TextDecoder().decode(reqBody)
					: null,
		},
		response: {
			status,
		},
		deno: {
			pid: Deno.pid,
			cwd: Deno.cwd(),
			execPath: Deno.execPath(),
			version: Deno.version,
			build: Deno.build,
			env: sortObject(env),
		},
		location: window.location,
	};
	console.log(body);
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf8',
		},
	});
};

export default handler;
