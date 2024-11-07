const initStart = Date.now();

import type {
	Handler,
	ConnInfo,
} from 'https://deno.land/std@0.177.0/http/server.ts';

const { _HANDLER, ENTRYPOINT, VERCEL_IPC_FD } = Deno.env.toObject();

function isNetAddr(v: any): v is Deno.NetAddr {
	return v && typeof v.port === 'number';
}

if (_HANDLER) {

	const mod = await import(`./${_HANDLER}`);
	const handler: Handler = mod.default;
	if (typeof handler !== 'function') {
		throw new Error('Failed to load handler function');
	}

	// Spawn HTTP server on ephemeral port
	const listener = Deno.listen({ port: 3030 /* 0 */ });

	if (!isNetAddr(listener.addr)) {
		throw new Error('Server not listening on TCP port');
	}
	const { port } = listener.addr;
	console.log({ port });
	console.log({ VERCEL_IPC_FD });

	const ipcSock = await Deno.connect({ path: `/dev/fd/${VERCEL_IPC_FD}`, transport: "unix" });
	ipcSock.write(new TextEncoder().encode(`${JSON.stringify({
		"type": "server-started",
		"payload": {
			"initDuration": Date.now() - initStart, // duration to init the process, connect to the unix domain socket & start the HTTP server in milliseconds
			"httpPort": port // the port of the HTTP server
		}
	})}\0`));

	// Serve HTTP requests to handler function
	const conn = await listener.accept();
	const s = Deno.serveHttp(conn);
	for await (const req of s) {
		const connInfo: ConnInfo = {
			// @ts-ignore - `rid` is not on the `ConnInfo` interface, but it's required by Oak
			rid: conn.rid,
			localAddr: conn.localAddr,
			remoteAddr: conn.remoteAddr,
		};
		const requestId = req.headers.get('x-vercel-internal-request-id');
		const invocationId = req.headers.get('x-vercel-internal-invocation-id');
		Promise.resolve(handler(req.request, connInfo)).then((res: Response) => {
			req.respondWith(res);
			// TODO: figure out how to wait for HTTP request to complete
			setTimeout(() => {
				const endPayload = {
					"type": "end",
					"payload": {
						"context": {
							invocationId, // invocation-id from the http request
							requestId // request-id from the http request
						},
						"error": "" // optional
					}
				};
				ipcSock.write(new TextEncoder().encode(`${JSON.stringify(endPayload)}\0`));
			}, 1000);
		});
	}
} else {
	// Build - import the entrypoint so that it gets cached
	await import(ENTRYPOINT);
}
