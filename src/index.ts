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
	shouldServe
} from '@vercel/build-utils';

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
	config = {}
}: BuildOptions) {
	//const { devCacheDir = join(workPath, '.vercel', 'cache') } = meta;
	//const distPath = join(devCacheDir, 'deno', entrypoint);

	await download(files, workPath, meta);

	let debug = false;

	if (typeof config.debug === 'boolean') {
		debug = config.debug;
	} else if (typeof config.debug === 'string' || typeof config.debug === 'number') {
		const d = yn(config.debug);
		if (typeof d === 'boolean') {
			debug = d;
		}
	}

	let denoVersion = process.env.DENO_VERSION || 'v1.0.2';
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
		DENO_VERSION: denoVersion
	};

	if (debug) {
		env.DEBUG = '1';
	}

	const builderPath = join(__dirname, 'build.sh');
	const cp = spawn(builderPath, [], {
		env,
		cwd: workPath,
		stdio: 'inherit'
	});
	const code = await once(cp, 'exit');
	if (code !== 0) {
		throw new Error(`Build script failed with exit code ${code}`);
	}

	const lambda = await createLambda({
		files: await glob('**', workPath),
		handler: entrypoint,
		runtime: 'provided'
	});

	return {
		output: lambda
	};
}
