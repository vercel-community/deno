import { decode } from 'https://deno.land/std@0.58.0/encoding/utf8.ts';
import { ServerRequest } from 'https://deno.land/std@0.58.0/http/server.ts';
import { ms } from 'https://raw.githubusercontent.com/denolib/ms/151c90aacba29ca0780fdc3b9f157c1baeac0ee1/ms.ts';

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
	const headers = new Headers();
	headers.set('Content-Type', 'application/json; charset=utf8');
	const now = new Date();
	const uptime = now.getTime() - startTime.getTime();
	const body = {
		now: now.getTime(),
		bootup: startTime.getTime(),
		uptime,
		nowHuman: now.toUTCString(),
		bootupHuman: startTime.toUTCString(),
		uptimeHuman: ms(uptime),
		request: {
			method: req.method,
			url: req.url,
			headers: sortObject(headersToObject(req.headers)),
			body: decode(await Deno.readAll(req.body)),
		},
		deno: {
			pid: Deno.pid,
			cwd: Deno.cwd(),
			execPath: Deno.execPath(),
			version: Deno.version,
			build: Deno.build,
			env: sortObject(Deno.env.toObject()),
		},
	};
	req.respond({
		status: 200,
		headers,
		body: JSON.stringify(body),
	});
};
