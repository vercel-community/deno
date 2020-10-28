import { ServerRequest } from 'https://deno.land/std@0.75.0/http/server.ts';

export default async (req: ServerRequest) => {
	const body = new Date().toISOString();
	console.log({ body });
	req.respond({ body });
};
