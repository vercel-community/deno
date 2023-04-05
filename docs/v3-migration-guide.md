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

The more recently supported `ServerRequest` syntax requires very little changes. The request interface is very similar to the standardized `Request` type. However, if you were using the `.respond()` function, you'll want to instead return a `Response` instance.

```diff
-import { ServerRequest } from 'https://deno.land/std@0.106.0/http/server.ts';
-
-export default function (request: ServerRequest) {
+export default function (request: Request) {

   console.log(request.url);

-  request.respond({ body: '...' });
+  return new Response('...');
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

# Legacy Deno Configuration Methods Removed

The deprecated ways of configuring Deno flags (i.e. `--unstable`) have been removed. Now the only way to configure flags is via the shebang method, as [documented in the README](../README.md#configuration).

## Migrate from Environment Variables

If you were using the environment variables `DENO_UNSTABLE` or `DENO_TSCONFIG` (either via the Vercel project settings dashboard, or `vercel.json`), those options must now be passed via the shebang of the individual endpoint.

`vercel.json`:

```diff
 {
-  "build": {
-    "env": {
-      "DENO_UNSTABLE": "1"
-    }
-  },
   "functions": {
     "api/**/*.[jt]s": { "runtime": "vercel-deno@3.0.0" }
   }
 }
```

`api/endpoint.ts`

```diff
+#!/usr/bin/env deno run --unstable

 export default (req: Request) => {
   return new Response('...');
 };
```

## Migrate from `config` in `vercel.json`

If you were using the `config` object in `vercel.json` to specifiy `unstable` or `tsconfig`, those options must now be passed via the shebang of the individual endpoint.

`vercel.json`:

```diff
 {
   "functions": {
     "api/**/*.[jt]s": {
-      "config": {
-        "unstable": 1
-      },
       "runtime": "vercel-deno@3.0.0"
     }
   }
 }
```

`api/endpoint.ts`

```diff
+#!/usr/bin/env deno run --unstable

 export default (req: Request) => {
   return new Response('...');
 };
```

# Configuration File Paths Relative to `cwd`

Previously, any file paths referenced by configuration options in an endpoint's shebang were relative to the entrypoint file. This was confusing because it caused a dichotomy between the directory where `deno run` is invoked vs. the value of the flag in the shebang.

Now those file paths are relative to the `cwd` that `deno run` is invoked with. That is, the file paths are relative to the root directory of the Project.

```diff
-#!/usr/bin/env deno run --include-files ../data.json
+#!/usr/bin/env deno run --include-files data.json

 export default (req: Request) => {
   const data = Deno.readTextFile('./data.json');
   return new Response(data, {
     headers: { 'content-type': 'application/json' }
   });
 };
```
