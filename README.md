[<img src="https://assets.vercel.com/image/upload/v1588805858/repositories/vercel/logo.png" height="96"><img src="https://raw.githubusercontent.com/denolib/high-res-deno-logo/master/deno_hr_circle.svg" height="104" />](https://github.com/TooTallNate/vercel-deno)

# Vercel Deno Runtime (`vercel-deno`)

The Deno Runtime compiles a TypeScript or JavaScript function into a serverless
function powered by [Deno](https://deno.land), running on
[Vercel](https://vercel.com).

## Usage

Create a file called `api/hello.ts` with the following contents:

```typescript
import { ServerRequest } from 'https://deno.land/std@0.61.0/http/server.ts';

export default async (req: ServerRequest) => {
	req.respond({ body: `Hello, from Deno v${Deno.version.deno}!` });
};
```

Next, define the **vercel-deno** runtime within the "functions" object in your
`vercel.json` file:

```json
{
	"version": 2,
	"functions": {
		"api/**/*.[jt]s": { "runtime": "vercel-deno@0.5.0" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello

> **Note:** Be sure to place the `vercel.json` file in the _root_ directory of
> your project.

## Configuration

There are a few [build environment
variables](https://vercel.com/docs/configuration#project/build-env) that you
may configure for your serverless functions:

| Name            | Description                                                                                                                                                                              | Default |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `DEBUG`         | Enables additional logging during build-time.                                                                                                                                            | `false` |
| `DENO_TSCONFIG` | Passes the [`--config`](https://deno.land/manual/getting_started/command_line_interface#cache-and-compilation-flags) flag to specify a `tsconfig.json` file that Deno will use.          | None    |
| `DENO_UNSTABLE` | Passes the [`--unstable`](https://deno.land/manual/getting_started/command_line_interface#cache-and-compilation-flags) flag to `deno cache` (at build-time) and `deno run` (at runtime). | `false` |
| `DENO_VERSION`  | Version of `deno` that the serverless function will use.                                                                                                                                 | `1.2.0` |

## Development

The `vercel dev` command is supported on Windows, macOS, and Linux:

-   Vercel CLI v19.1.0 or newer is required.
-   Uses the `deno` binary installed on the system (does not download `deno`).
-   Specifying a specific version of Deno via `DENO_VERSION` env var is not supported.
