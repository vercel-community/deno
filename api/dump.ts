import ms from 'https://denopkg.com/TooTallNate/ms';
import { decode } from 'https://deno.land/std@0.75.0/encoding/utf8.ts';
import { ServerRequest } from 'https://deno.land/std@0.75.0/http/server.ts';

// Importing relative files works as expected
import { foo } from '../src/foo.ts';

interface StringObject {
	[name: string]: string;
}

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

function urlToObject(url: URL): StringObject {
	const obj: HeadersObject = {};
	for (const name of Object.getOwnPropertyNames(URL.prototype)) {
		const val = (url as any)[name];
		if (typeof val === 'string') {
			obj[name] = val;
		}
	}
	return obj;
}

function sortObject<T extends HeadersObject>(obj: T): T {
	// @ts-ignore
	const sorted: T = Object.create(Object.getPrototypeOf(obj));
	const keys = Object.keys(obj).sort();
	for (const k of keys) {
		// @ts-ignore
		sorted[k] = obj[k];
	}
	return sorted;
}

export default async (req: ServerRequest) => {
	const now = new Date();
	const uptime = now.getTime() - startTime.getTime();
	const base = `${req.headers.get('x-forwarded-proto')}://${req.headers.get('x-forwarded-host')}`;
	const url = new URL(req.url, base);
	const status = parseInt(url.searchParams.get('statusCode') || '200', 10);
	const body = {
		now: now.getTime(),
		bootup: startTime.getTime(),
		uptime,
		nowHuman: now.toUTCString(),
		bootupHuman: startTime.toUTCString(),
		uptimeHuman: ms(uptime),
		request: {
			method: req.method,
			url: urlToObject(url),
			headers: sortObject(headersToObject(req.headers)),
			body: decode(await Deno.readAll(req.body)),
		},
		response: {
			status
		},
		deno: {
			pid: Deno.pid,
			cwd: Deno.cwd(),
			execPath: Deno.execPath(),
			version: Deno.version,
			build: Deno.build,
			env: sortObject(Deno.env.toObject()),
		},
		foo,
	};
	console.log(body);
	const headers = new Headers();
	headers.set('Content-Type', 'application/json; charset=utf8');
	req.respond({
		status,
		headers,
		body: JSON.stringify(body, null, 2),
	});
};
