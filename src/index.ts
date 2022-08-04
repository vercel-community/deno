/**
 * The default version of Deno that will be downloaded at build-time.
 */
const DEFAULT_DENO_VERSION = 'v1.22.3';

import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { dirname, join, relative, resolve } from 'path';
import {
	chmodSync,
	readFile,
	readFileSync,
	readJSON,
	statSync,
} from 'fs-extra';
import once from '@tootallnate/once';
import {
	BuildV3,
	Env,
	Files,
	FileBlob,
	FileFsRef,
	Lambda,
	PrepareCache,
	download,
	glob,
	streamToBuffer,
} from '@vercel/build-utils';
import * as shebang from './shebang';
import { isURL } from './util';
import { configBool, configString } from './config';
import { downloadDeno } from './download-deno';
import { bashShellQuote } from 'shell-args';

export * from './start-dev-server';

interface Program {
	fileNames?: string[];
}

interface BuildInfo {
	program: Program;
}

const bootstrapPath = join(__dirname, 'bootstrap');

// `chmod()` is required for usage with `vercel-dev-runtime` since
// file mode is not preserved in Vercel deployments from the CLI.
chmodSync(bootstrapPath, 0o755);

const bootstrapData = readFileSync(bootstrapPath, 'utf8');
const bootstrapMode = statSync(bootstrapPath).mode;

export const version = 3;

export const build: BuildV3 = async ({
	workPath,
	files,
	entrypoint,
	meta = {},
	config = {},
}) => {
	await download(files, workPath, meta);

	const absEntrypoint = join(workPath, entrypoint);
	const absEntrypointDir = dirname(absEntrypoint);
	const args = shebang.parse(await readFile(absEntrypoint, 'utf8'));

	// @deprecated
	const unstable =
		configBool(config, 'denoUnstable', process.env, 'DENO_UNSTABLE') ||
		false;

	// @deprecated
	const denoTsConfig = configString(
		config,
		'tsconfig',
		process.env,
		'DENO_TSCONFIG'
	);

	let denoVersion = args['--version'];
	delete args['--version'];

	// @deprecated
	if (!denoVersion) {
		denoVersion = configString(
			config,
			'denoVersion',
			process.env,
			'DENO_VERSION'
		);
		if (denoVersion) {
			console.log('DENO_VERSION env var is deprecated');
		}
	}

	if (!denoVersion) {
		denoVersion = DEFAULT_DENO_VERSION;
	}

	if (!denoVersion.startsWith('v')) {
		denoVersion = `v${denoVersion}`;
	}

	const { devCacheDir = join(workPath, '.vercel', 'cache') } = meta;
	const denoDir = join(devCacheDir, 'deno');

	const env: Env = {
		...process.env,
		...args.env,
		DENO_DIR: denoDir,
		ENTRYPOINT: join(workPath, entrypoint),
	};

	const [runtimeDeno, buildTimeDeno] = await Promise.all([
		// For runtime, Linux 64-bit Deno binary will be downloaded
		downloadDeno(denoDir, denoVersion, 'linux', 'x64'),
		// If the build is being executed on a different OS/arch,
		// then also download Deno binary for the build host
		process.platform !== 'linux' || process.arch !== 'x64'
			? downloadDeno(denoDir, denoVersion, process.platform, process.arch)
			: undefined,
	]);

	// Add build-time Deno version to $PATH
	const origPath = env.PATH;
	env.PATH = [buildTimeDeno?.dir || runtimeDeno.dir, origPath].join(':');

	// @deprecated
	if (unstable) {
		console.log('DENO_UNSTABLE env var is deprecated');
		args['--unstable'] = true;
	}

	// Flags that accept file paths are relative to the entrypoint in
	// the source file, but `deno run` is executed at the root directory
	// of the project, so the arguments need to be relativized to the root
	for (const flag of [
		'--cert',
		'--config',
		'--import-map',
		'--lock',
	] as const) {
		const val = args[flag];
		if (typeof val === 'string' && !isURL(val)) {
			args[flag] = relative(workPath, resolve(absEntrypointDir, val));
		}
	}

	// @deprecated
	if (denoTsConfig && !args['--config']) {
		console.log('DENO_TSCONFIG env var is deprecated');
		args['--config'] = denoTsConfig;
	}

	// This flag is specific to `vercel-deno`, so it does not
	// get included in the args that are passed to `deno run`
	const includeFiles = (args['--include-files'] || []).map((f) => {
		return relative(workPath, join(absEntrypointDir, f));
	});
	delete args['--include-files'];

	const argv = ['--allow-all', ...args];
	console.log(`Caching imports…`);
	console.log(`deno run ${argv.join(' ')} ${entrypoint}`);
	const cp = spawn('deno', ['run', ...argv, join(__dirname, 'runtime.ts')], {
		env,
		cwd: workPath,
		stdio: 'inherit',
	});
	const [code] = await once(cp, 'exit');
	if (code !== 0) {
		throw new Error(`Build script failed with exit code ${code}`);
	}

	const bootstrapDataWithArgs = bootstrapData.replace(
		'$args',
		bashShellQuote(argv)
	);

	const outputFiles: Files = {
		bootstrap: new FileBlob({
			data: bootstrapDataWithArgs,
			mode: bootstrapMode,
		}),
		'bin/deno': await FileFsRef.fromFsPath({
			fsPath: join(runtimeDeno.dir, 'deno'),
		}),
	};

	await Promise.all([
		traceDenoInfo(
			outputFiles,
			env,
			denoDir,
			workPath,
			join(__dirname, 'runtime.ts'),
			'.vercel-deno-runtime.ts'
		),
		traceDenoInfo(
			outputFiles,
			env,
			denoDir,
			workPath,
			join(workPath, entrypoint)
		),
	]);

	// Add additional files that were referenced from
	// Deno CLI flags in the shebang
	const additionalFiles = new Set<string>();
	for (const flag of [
		'--cert',
		'--config',
		'--import-map',
		'--lock',
	] as const) {
		const val = args[flag];
		if (typeof val === 'string' && !isURL(val)) {
			additionalFiles.add(val);
		}
	}
	for (const filename of Array.from(additionalFiles).sort()) {
		outputFiles[filename] = await FileFsRef.fromFsPath({
			fsPath: join(workPath, filename),
		});
	}

	// Add additional files that were referenced from
	// `--include-files` CLI flag or the `vercel.json` config
	if (config.includeFiles) {
		if (typeof config.includeFiles === 'string') {
			includeFiles.push(config.includeFiles);
		} else {
			includeFiles.push(...config.includeFiles);
		}
	}
	if (includeFiles.length > 0) {
		for (const pattern of includeFiles) {
			const matches = await glob(pattern, workPath);
			for (const name of Object.keys(matches)) {
				if (!outputFiles[name]) {
					outputFiles[name] = matches[name];
				}
			}
		}
	}

	const output = new Lambda({
		files: outputFiles,
		handler: entrypoint,
		runtime: 'provided.al2',
		environment: args.env,
		supportsWrapper: true,
	});

	return { output };
};

async function traceDenoInfo(
	files: Files,
	env: Env,
	denoDir: string,
	cwd: string,
	entrypoint: string,
	renameFile = '',
	renameDir = '/var/task'
) {
	const cp = spawn('deno', ['info', '--json', entrypoint], {
		env,
		cwd,
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	const [stdout, [code]] = await Promise.all([
		streamToBuffer(cp.stdout),
		once(cp, 'exit'),
	]);
	if (code !== 0) {
		throw new Error(`Build script failed with exit code ${code}`);
	}
	const info = JSON.parse(stdout.toString('utf8'));
	const root = info.roots[0];

	const outputDenoDir = relative(cwd, denoDir);
	const renamedDenoDir = join(outputDenoDir, 'gen/file', renameDir);

	for (const mod of info.modules) {
		if (mod.specifier.startsWith('file://')) {
			const outputPath =
				(root === mod.specifier && renameFile) ||
				relative(cwd, mod.local);

			// Add source file to output files
			files[outputPath] = await FileFsRef.fromFsPath({
				fsPath: mod.local,
			});

			// Add gen `.meta` file to output files
			const metaPath = join(denoDir, 'gen/file', `${mod.local}.meta`);
			const metaOutputPath = join(renamedDenoDir, `${outputPath}.meta`);
			await FileFsRef.fromFsPath({
				fsPath: metaPath,
			}).then(
				(ref) => {
					files[metaOutputPath] = ref;
				},
				(err) => {
					// Won't exist for "JavaScript" mediaType so "ENOENT" is ok
					if (err.code !== 'ENOENT') throw err;
				}
			);

			// Add gen compiled source file to output files
			const compiledPath = join(denoDir, 'gen/file', `${mod.local}.js`);
			const compiledOutputPath = join(renamedDenoDir, `${outputPath}.js`);
			await FileFsRef.fromFsPath({
				fsPath: compiledPath,
			}).then(
				(ref) => {
					files[compiledOutputPath] = ref;
				},
				(err) => {
					// Won't exist for "JavaScript" mediaType so "ENOENT" is ok
					if (err.code !== 'ENOENT') throw err;
				}
			);

			// Patch `.buildinfo` file with updated Deno dir file references
			const buildInfoPath = join(
				denoDir,
				'gen/file',
				`${mod.local}.buildinfo`
			);
			const buildInfoOutputPath = join(
				renamedDenoDir,
				`${outputPath}.buildinfo`
			);
			await readJSON(buildInfoPath).then(
				(buildInfo: BuildInfo) => {
					const fileNames = buildInfo.program.fileNames;
					if (!fileNames) {
						console.log(
							`No buildinfo files detected for: "${buildInfoPath}"`
						);
						return;
					}
					for (let i = 0; i < fileNames.length; i++) {
						const fileName = fileNames[i];
						if (fileName.startsWith('file://')) {
							const filePath = fileURLToPath(fileName);
							const outputPath =
								(root === fileName && renameFile) ||
								relative(cwd, filePath);
							const outputURL = pathToFileURL(
								join(renameDir, outputPath)
							);
							fileNames[i] = outputURL.href;
						}
					}
					files[buildInfoOutputPath] = new FileBlob({
						data: JSON.stringify(buildInfo, null, 2),
					});
				},
				(err) => {
					if (err.code !== 'ENOENT') throw err;
				}
			);
		} else if (mod.specifier.startsWith('https://')) {
			const depPath = relative(join(denoDir, 'deps'), mod.local);

			// Add deps source file to output files
			const depOutputPath = join(outputDenoDir, 'deps', depPath);
			files[depOutputPath] = await FileFsRef.fromFsPath({
				fsPath: join(denoDir, 'deps', depPath),
			});

			// Add deps `.metadata.json` file to output files
			const metadataPath = `${depPath}.metadata.json`;
			const metadataOutputPath = join(
				outputDenoDir,
				'deps',
				metadataPath
			);
			files[metadataOutputPath] = await FileFsRef.fromFsPath({
				fsPath: join(denoDir, 'deps', metadataPath),
			});

			try {
				// Add gen `.meta` file to output files
				const metaPath = `${depPath}.meta`;
				const metaOutputPath = join(outputDenoDir, 'gen', metaPath);
				files[metaOutputPath] = await FileFsRef.fromFsPath({
					fsPath: join(denoDir, 'gen', metaPath),
				});

				// Add gen compiled source file to output files
				const compiledPath = `${depPath}.js`;
				const compiledOutputPath = join(
					outputDenoDir,
					'gen',
					compiledPath
				);
				files[compiledOutputPath] = await FileFsRef.fromFsPath({
					fsPath: join(denoDir, 'gen', compiledPath),
				});
			} catch (err: any) {
				// "ENOENT" is ok because `.d.ts` files will not have compiled files
				if (err.code !== 'ENOENT') throw err;
			}
		} else {
			throw new Error(`Unsupported file protocol: ${mod.specifier}`);
		}
	}
}

export const prepareCache: PrepareCache = async ({ workPath }) => {
	return await glob('.vercel/cache/deno/**', workPath);
};
