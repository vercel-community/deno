[<img src="https://assets.vercel.com/image/upload/v1588805858/repositories/vercel/logo.png" height="96"><img src="https://raw.githubusercontent.com/denolib/high-res-deno-logo/master/deno_hr_circle.svg" height="104" />](https://github.com/TooTallNate/vercel-deno)

# Vercel Deno Runtime (`vercel-deno`)

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
		"api/**/*.[jt]s": { "runtime": "vercel-bash@0.0.2" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello
