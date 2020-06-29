import { Response, serve } from 'https://deno.land/std@0.58.0/http/server.ts';

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
const s = serve({ port: 0 });

// Write the port number to FD 3
if (isNetAddr(s.listener.addr)) {
	const { port } = s.listener.addr;
	const portBytes = new TextEncoder().encode(String(port));

	try {
		// Open FD 3, which is where the port number needs to be written
		const portFd = Deno.openSync('/dev/fd/3', { read: false, write: true });
		Deno.writeAllSync(portFd, portBytes);
		Deno.close(portFd.rid);
	} catch (err) {
		console.log(err);
		const portFile = Deno.env.get('VERCEL_DEV_PORT_FILE');
		if (portFile) {
			await Deno.writeFile(portFile, portBytes);
			console.log('wrote', port, 'to', portFile);
		}
	}
}

// Serve HTTP requests to handler function
for await (const req of s) {
	handler(req).then((res: Response | void) => {
		if (res) {
			return req.respond(res);
		}
	});
}
