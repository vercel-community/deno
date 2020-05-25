# Verecl Deno Runtime (`vercel-deno`)

The Deno Runtime compiles a TypeScript or JavaScript function into a serverless
function.


## Usage

```typescript
import { ServerRequest } from "https://deno.land/std@0.52.0/http/server.ts";

export default async (req: ServerRequest) => {
	req.respond({ body: `Hello, from Deno v${Deno.version.deno}!` });
}
```

And define the **vercel-bash** runtime in your `vercel.json` file:

```json
{
	"version": 2,
	"functions": {
		"api/*.sh": { "runtime": "vercel-bash@3.0.7" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello
