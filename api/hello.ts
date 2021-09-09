const handler = () => new Response(`Hello, from Deno v${Deno.version.deno}!`);
export default handler;
