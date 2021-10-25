export const config = {
	runtime: 'deno',
	memory: 128,
};

export default () => new Response(`Hello, from Deno v${{}}!`);
