import { writeAllSync } from 'https://deno.land/std@0.130.0/streams/conversion.ts';

// deno-lint-ignore no-explicit-any
function isNetAddr(v: any): v is Deno.NetAddr {
	return v && typeof v.port === 'number';
}

// Load the entrypoint handler function
const entrypoint = Deno.env.get('VERCEL_DEV_ENTRYPOINT');
Deno.env.delete('VERCEL_DEV_ENTRYPOINT');

const mod = await import(`file://${entrypoint}`);
const handler = mod.default;
if (typeof handler !== 'function') {
	throw new Error('Failed to load handler function');
}

// Spawn HTTP server on ephemeral port
const conn = Deno.listen({ port: 0 });

if (isNetAddr(conn.addr)) {
	const { port } = conn.addr;
	const portBytes = new TextEncoder().encode(String(port));

	try {
		// Write the port number to FD 3
		const portFd = Deno.openSync('/dev/fd/3', { read: false, write: true });
		writeAllSync(portFd, portBytes);
		Deno.close(portFd.rid);
	} catch (_err) {
		// This fallback is necessary for Windows
		// See: https://github.com/denoland/deno/issues/6305
		const portFile = Deno.env.get('VERCEL_DEV_PORT_FILE');
		if (portFile) {
			await Deno.writeFile(portFile, portBytes);
		}
	} finally {
		Deno.env.delete('VERCEL_DEV_PORT_FILE');
	}
}

// Serve HTTP requests to handler function
const s = Deno.serveHttp(await conn.accept());
for await (const req of s) {
	Promise.resolve(handler(req.request)).then((res: Response) =>
		req.respondWith(res)
	);
}
