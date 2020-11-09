[<img src="https://og-image.vercel.app/**vercel-deno**.png?theme=light&md=1&fontSize=100px&images=https%3A%2F%2Fassets.vercel.com%2Fimage%2Fupload%2Ffront%2Fassets%2Fdesign%2Fvercel-triangle-black.svg&images=https%3A%2F%2Fgithub.com%2Fdenolib%2Fhigh-res-deno-logo%2Fraw%2Fmaster%2Fdeno_hr_circle.svg&widths=184&widths=220&heights=160&heights=220">](https://github.com/TooTallNate/vercel-deno)

The Deno Runtime compiles a TypeScript or JavaScript function into a serverless
function powered by [Deno](https://deno.land), running on
[Vercel](https://vercel.com).

## Usage

Your serverless function file is expected to `export default` the HTTP handler
function, and then `vercel-deno` takes care of invoking that handler function
every time an HTTP request is received.

> **Note:** Check out the [`api`](./api) directory to see examples of using
> popular Deno web frameworks with `vercel-deno`. Feel free to send a pull request
> to add additional examples!

#### Example

Create a file called `api/hello.ts` with the following contents:

```typescript
import { ServerRequest } from 'https://deno.land/std@0.74.0/http/server.ts';

export default async (req: ServerRequest) => {
	req.respond({ body: `Hello, from Deno v${Deno.version.deno}!` });
};
```

Next, define the **vercel-deno** runtime within the "functions" object in your
`vercel.json` file:

```json
{
	"functions": {
		"api/**/*.[jt]s": { "runtime": "vercel-deno@0.7.1" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello

## Configuration

There are a few [build environment
variables](https://vercel.com/docs/configuration#project/build-env) that you
may configure for your serverless functions:

| Name            | Description                                                                                                                                                                              | Default |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `DEBUG`         | Enables additional logging during build-time.                                                                                                                                            | `false` |
| `DENO_TSCONFIG` | Passes the [`--config`](https://deno.land/manual/getting_started/command_line_interface#cache-and-compilation-flags) flag to specify a `tsconfig.json` file that Deno will use.          | None    |
| `DENO_UNSTABLE` | Passes the [`--unstable`](https://deno.land/manual/getting_started/command_line_interface#cache-and-compilation-flags) flag to `deno cache` (at build-time) and `deno run` (at runtime). | `false` |
| `DENO_VERSION`  | Version of `deno` that the serverless function will use.                                                                                                                                 | `1.5.2` |

## Development

The `vercel dev` command is supported on Windows, macOS, and Linux:

-   Vercel CLI v19.1.0 or newer is required.
-   Uses the `deno` binary installed on the system (does not download `deno`).
-   Specifying a specific version of Deno via `DENO_VERSION` env var is not supported.
