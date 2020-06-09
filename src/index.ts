import fs from 'fs';
import yn from 'yn';
import { join } from 'path';
import { spawn } from 'child_process';
import once from '@tootallnate/once';
import {
	AnalyzeOptions,
	BuildOptions,
	Env,
	glob,
	download,
	createLambda,
	shouldServe,
} from '@vercel/build-utils';

const { stat, readdir, readFile, writeFile } = fs.promises;

const DEFAULT_DENO_VERSION = 'v1.0.5';

interface Graph {
	deps: string[];
	version_hash: string;
}

export const version = 3;

export { shouldServe };

export function analyze({ files, entrypoint }: AnalyzeOptions) {
	return files[entrypoint].digest;
}

export async function build({
	workPath,
	files,
	entrypoint,
	meta = {},
	config = {},
}: BuildOptions) {
	//const { devCacheDir = join(workPath, '.vercel', 'cache') } = meta;
	//const distPath = join(devCacheDir, 'deno', entrypoint);

	await download(files, workPath, meta);

	let debug = false;

	if (typeof config.debug === 'boolean') {
		debug = config.debug;
	} else if (
		typeof config.debug === 'string' ||
		typeof config.debug === 'number'
	) {
		const d = yn(config.debug);
		if (typeof d === 'boolean') {
			debug = d;
		}
	} else {
		const debugEnv = process.env.DEBUG;
		if (typeof debugEnv === 'string') {
			const d = yn(debugEnv);
			if (typeof d === 'boolean') {
				debug = d;
			}
		}
	}

	let denoVersion = process.env.DENO_VERSION || DEFAULT_DENO_VERSION;
	if (typeof config.denoVersion === 'string') {
		denoVersion = config.denoVersion;
	}

	if (!denoVersion.startsWith('v')) {
		denoVersion = `v${denoVersion}`;
	}

	const env: typeof process.env = {
		...process.env,
		BUILDER: __dirname,
		ENTRYPOINT: entrypoint,
		DENO_VERSION: denoVersion,
	};

	if (debug) {
		env.DEBUG = '1';
	}

	const builderPath = join(__dirname, 'build.sh');
	const cp = spawn(builderPath, [], {
		env,
		cwd: workPath,
		stdio: 'inherit',
	});
	const code = await once(cp, 'exit');
	if (code !== 0) {
		throw new Error(`Build script failed with exit code ${code}`);
	}

	// Patch the `.graph` files to use file paths beginning with `/var/task`
	// to hot-fix a Deno issue (https://github.com/denoland/deno/issues/6080).
	const workPathUri = `file://${workPath}`;
	for await (const file of getGraphFiles(join(workPath, '.deno/gen/file'))) {
		const graph: Graph = JSON.parse(await readFile(file, 'utf8'));
		for (let i = 0; i < graph.deps.length; i++) {
			const dep = graph.deps[i];
			if (dep.startsWith(workPathUri)) {
				const updated = `file:///var/task${dep.substring(
					workPathUri.length
				)}`;
				graph.deps[i] = updated;
			}
		}
		await writeFile(file, JSON.stringify(graph));
	}

	const lambda = await createLambda({
		files: await glob('**', workPath),
		handler: entrypoint,
		runtime: 'provided',
	});

	return {
		output: lambda,
	};
}

async function* getGraphFiles(dir: string): AsyncIterable<string> {
	const files = await readdir(dir);
	for (const file of files) {
		const absolutePath = join(dir, file);
		if (file.endsWith('.graph')) {
			yield absolutePath;
		} else {
			const s = await stat(absolutePath);
			if (s.isDirectory()) {
				yield* getGraphFiles(absolutePath);
			}
		}
	}
}
