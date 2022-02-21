import { serve } from 'https://deno.land/std@0.126.0/http/server.ts';
import { writeAllSync } from 'https://deno.land/std@0.126.0/streams/conversion.ts';

function random(min: number, max: number): number {
	return Math.round(Math.random() * (max - min)) + min;
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
let port: number;

while (true) {
	port = random(10000, 65535);
	
	try {
		serve(handler, { hostname: '127.0.0.1', port });
		break
	} catch (err) {
		if (!(err instanceof Deno.errors.AddrInUse)) {
			throw err;
		}
	}
}

const portBytes = new TextEncoder().encode(String(port));

try {
	// Write the port number to FD 3
	const portFd = Deno.openSync('/dev/fd/3', { read: false, write: true });
	writeAllSync(portFd, portBytes);
	Deno.close(portFd.rid);
} catch (err) {
	// This fallback is necessary for Windows
	// See: https://github.com/denoland/deno/issues/6305
	const portFile = Deno.env.get('VERCEL_DEV_PORT_FILE');
	if (portFile) {
		await Deno.writeFile(portFile, portBytes);
	}
} finally {
	Deno.env.delete('VERCEL_DEV_PORT_FILE');
}
