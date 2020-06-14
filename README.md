[<img src="https://assets.vercel.com/image/upload/v1588805858/repositories/vercel/logo.png" height="96"><img src="https://raw.githubusercontent.com/denolib/high-res-deno-logo/master/deno_hr_circle.svg" height="104" />](https://github.com/TooTallNate/vercel-deno)

# Vercel Deno Runtime (`vercel-deno`)

The Deno Runtime compiles a TypeScript or JavaScript function into a serverless
function powered by [`deno`](https://deno.land).


## Usage

```typescript
import { ServerRequest } from "https://deno.land/std@0.52.0/http/server.ts";

export default async (req: ServerRequest) => {
	req.respond({ body: `Hello, from Deno v${Deno.version.deno}!` });
}
```

And define the **vercel-deno** runtime in your `vercel.json` file:

```json
{
	"version": 2,
	"functions": {
		"api/**/*.{j,t}s": { "runtime": "vercel-deno@0.2.1" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello


## Development

The `vercel dev` command is supported, with some caveats:

 - Vercel CLI v19.1.0 or newer is required.
 - Currently supports Linux and macOS. Windows support will be coming soon.
 - Uses the `deno` binary installed on the system (does not download `deno`).
 - Specifying a specific version of Deno via `DENO_VERSION` env var is not supported.
