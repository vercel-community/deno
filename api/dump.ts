#!/usr/bin/env deno run --location https://example.com/page
import ms from 'https://esm.sh/ms';
import { readerFromStreamReader } from 'https://deno.land/std@0.107.0/io/streams.ts';

interface HeadersObject {
	[name: string]: any;
}

const startTime = new Date();

function headersToObject(headers: Headers): HeadersObject {
	const obj: HeadersObject = {};
	for (const [name, value] of headers.entries()) {
		obj[name] = value;
	}
	return obj;
}

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

function sortObject<T extends object>(obj: T): T {
	const sorted: T = Object.create(Object.getPrototypeOf(obj));
	const keys = Object.keys(obj).sort() as (keyof T)[];
	for (const k of keys) {
		sorted[k] = obj[k];
	}
	return sorted;
}

export default async ({ request }: Deno.RequestEvent) => {
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
			headers: sortObject(headersToObject(request.headers)),
			body: request.body
				? new TextDecoder().decode(
						await Deno.readAll(
							readerFromStreamReader(request.body.getReader())
						)
				  )
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
