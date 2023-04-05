const sleep = (n) => new Promise((r) => setTimeout(r, n));

export default (_req) => {
	return new Response('Hello from JavaScript in Deno!', {
		headers: { foo: 'bar' },
	});
	//const { readable, writable } = new TransformStream();
	//const encoder = new TextEncoder();
	//const writer = writable.getWriter();
	//(async () => {
	//	for (let i = 0; i < 150; i++) {
	//		writer.write(encoder.encode(`${i}\n`));
	//		await sleep(10000);
	//	}
	//	writer.close();
	//})();
	//return new Response(readable);
};
