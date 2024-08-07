import { join } from 'path';
import { DenoLambda } from './deno-lambda';
import { type BuildV3, download, getProvidedRuntime } from '@vercel/build-utils';

export const build: BuildV3 = async ({
	workPath,
	files,
	entrypoint,
	meta = {},
	config = {},
}) => {
	await download(files, workPath, meta);
	const { includeFiles } = config;
	const { devCacheDir = join(workPath, '.vercel', 'cache') } = meta;
	const output = await DenoLambda.build({
		entrypoint,
		cwd: workPath,
		includeFiles:
			typeof includeFiles === 'string' ? [includeFiles] : includeFiles,
		cacheDir: devCacheDir,
	});
	output.runtime = await getProvidedRuntime();
	return { output };
};
