import { ServerRequest } from 'https://deno.land/std@0.90.0/http/server.ts';

export default async (req: ServerRequest) => {
	req.respond({ body: `Hello, from Deno v${Deno.version.deno}!` });
};
