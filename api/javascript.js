export const config = {
	runtime: 'deno',
};

export default (req) => {
	req.respond({ body: 'Hello from JavaScript in Deno!' });
};
