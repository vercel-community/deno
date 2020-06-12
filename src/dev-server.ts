import { ServerRequest, serve } from 'https://deno.land/std@0.56.0/http/server.ts';

function isNetAddr (v: any): v is Deno.NetAddr {
	return v && typeof v.port === 'number';
}

const portFd = Deno.openSync('/dev/fd/3', { read: false, write: true });
const s = serve({ port: 0 });

if (isNetAddr(s.listener.addr)) {
	const { port } = s.listener.addr;
	const portBytes = new TextEncoder().encode(String(port));
	Deno.writeAllSync(portFd, portBytes);
	Deno.close(portFd.rid);
}

const entrypoint = Deno.env.get('VERCEL_DEV_ENTRYPOINT');
const mod = await import(`file://${entrypoint}`);
const handler = mod.default;
if (!handler) {
	throw new Error('Failed to load handler function');
}

for await (const req of s) {
	await handler(req);
}
