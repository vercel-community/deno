Version 3 of `vercel-deno` includes some breaking changes compared to previous versions. Read below to see how to update your code to be compatible.

# Unified Request Handler Signature

Version 3 uses a request handler syntax that more closely matches the Vercel style. In fact, it's the same interface that the Edge runtime uses:

```ts
export default async function (request: Request): Promise<Response> {
  console.log(request.url);
  return new Response('...');
}
```

## Migrate from `ServerRequest`

The more recently supported `ServerRequest` syntax requires very little changes. The request interface is very similar to the standardized `Request` type. However, you were using the `.respond()` function, you'll want to instead return a `Response` instance.

```diff
-import { ServerRequest } from 'https://deno.land/std@0.106.0/http/server.ts';
-
-export default function (request: ServerRequest) {
+export default function (request: Request) {
  console.log(request.url);
- request.respond({ body: '...' });
+ return new Response('...');
}
```

## Migrate from `Deno.RequestEvent`

The other syntax that was previously supported is `Deno.RequestEvent`. In this syntax, the `Request` instance was available on the `.request` property of the event parameter. Instead you'll want to access the `Request` instance as the top-level parameter provided to the function. Instead of using the `.respondWith()` function, you must directly return the `Response` instance.

```diff
-export default function (event: Deno.RequestEvent) {
+export default function (request: Request) {

-  console.log(event.request.url);
+  console.log(request.url);

-  event.respondWith(new Response('...'));
+  return new Response('...');
}
```