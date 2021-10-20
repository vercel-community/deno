[<img src="https://og-image.vercel.app/Vercel%20Plugin:%20**Deno**.png?theme=light&md=1&fontSize=100px&images=https%3A%2F%2Fassets.vercel.com%2Fimage%2Fupload%2Ffront%2Fassets%2Fdesign%2Fvercel-triangle-black.svg&images=https%3A%2F%2Fgithub.com%2Fdenolib%2Fhigh-res-deno-logo%2Fraw%2Fmaster%2Fdeno_hr_circle.svg&widths=184&widths=220&heights=160&heights=220">](https://github.com/vercel-community/deno)

This Vercel Plugin compiles TypeScript or JavaScript functions into Serverless
Functions powered by [Deno](https://deno.land), running on
[Vercel](https://vercel.com).

## Usage

Your serverless function file is expected to `export default` the HTTP handler
function, and then `vercel-plugin-deno` takes care of invoking that handler
function every time an HTTP request is received.

> **Note:** Check out the [`api`](./api) directory to see examples of using
> popular Deno web frameworks with `vercel-plugin-deno`. Feel free to send a
> pull request to add additional examples!

#### Example

Create a file called `api/hello.ts` with the following contents:

```typescript
export default () => new Response(`Hello, from Deno v${Deno.version.deno}!`);
```

Next, define the **vercel-deno** runtime within the "functions" object in your
`vercel.json` file:

```json
{
	"functions": {
		"api/**/*.[jt]s": { "runtime": "vercel-deno@1.1.0" }
	}
}
```

**Demo:** https://vercel-deno.vercel.app/api/hello

## Configuration

To configure which flags are passed to `deno run`, a [shebang](<https://wikipedia.org/wiki/Shebang_(Unix)>) needs to be defined in
the entrypoint of the Serverless Function containing the flags that will be used.

For example, to set the `window.location` object, and use a specific tsconfig file:

```typescript
#!/usr/bin/env deno run --location http://example.com/path --config other-tsconfig.json

export default async () => new Response(`Location is ${window.location.href}!`);
```

There are also a few flags that can be used that are specific to `vercel-deno`:

-   `--version` - Specify a specific version of Deno to use (can be any valid Deno [release tag](https://github.com/denoland/deno/releases) — e.g. `v1.2.3`).
-   `--include-files` - Glob pattern of static files to include within the Serverless Function. Can be specified more than once.

### Endpoint-specific Environment Variables

It's also possible to specify environment variables that will apply only to a specific API endpoint by utilizing the shebang. Just place the environment variables before the `deno` command in the shebang. For example:

```typescript
#!/usr/bin/env FOO=bar ANOTHER="spaces work too" deno run
```

In this example, the `FOO` environment variable will be set to "bar" and `ANOTHER` will be set to "spaces work too" for only this endpoint.

### Dynamic Imports

By default, dynamic imports (using the `import()` function during runtime) _**will fail**_. For most use-cases, this is fine since this feature is only necessary for rare use-cases.

However, when dynamic imports _are_ required for your endpoint, the `DENO_DIR` enviorment variable will need to be set to "/tmp". This is required because the file system is read-only, within the Serverless Function runtime environment, _except_ for the "/tmp" dir. Because dynamic imports will require compilation at runtime, the deno cache directory needs to be writable.

The recommended way of enabling this is to add an environment variable to the endpoint's shebang. For example:

```typescript
#!/usr/bin/env DENO_DIR=/tmp deno run

export default async () => {
	const mod = await import('http://example.com/mod.ts');
	return new Response(mod.default.doThing());
};
```

## Development

The `vercel dev` command is supported on Windows, macOS, and Linux:

-   Vercel CLI v19.1.0 or newer is required.
-   Uses the `deno` binary installed on the system (does not download `deno`).
-   Specifying a specific version of Deno via `--version` flag is ignored.
