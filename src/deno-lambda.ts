/**
 * The default version of Deno that will be downloaded at build-time.
 */
const DEFAULT_DENO_VERSION = 'v1.44.4';

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';
import {
	chmodSync,
	readFile,
	readFileSync,
	readJSON,
	statSync,
} from 'fs-extra';
import once from '@tootallnate/once';
import {
	type Env,
	type Files,
	FileBlob,
	FileFsRef,
	Lambda,
	glob,
	streamToBuffer,
} from '@vercel/build-utils';
import { bashShellQuote } from 'shell-args';
import * as shebang from './shebang';
import { isURL } from './util';
import { downloadDeno } from './download-deno';
import type { LambdaOptionsWithFiles } from '@vercel/build-utils/dist/lambda';

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

export interface DenoLambdaOptions
	extends Omit<LambdaOptionsWithFiles, 'runtime' | 'supportsWrapper'> {}

export interface DenoLambdaBuildOptions {
	entrypoint: string;
	cwd: string;
	cacheDir: string;
	defaultDenoVersion?: string;
	includeFiles?: string[];
}

export class DenoLambda extends Lambda {
	constructor(opts: DenoLambdaOptions) {
		super({
			...opts,
			runtime: 'provided.al2',
			supportsWrapper: true,
		});
	}

	static async build({
		entrypoint,
		cwd,
		defaultDenoVersion = DEFAULT_DENO_VERSION,
		includeFiles: _includeFiles = [],
		cacheDir,
	}: DenoLambdaBuildOptions): Promise<DenoLambda> {
		const absEntrypoint = join(cwd, entrypoint);
		const args = shebang.parse(await readFile(absEntrypoint, 'utf8'));

		let denoVersion = args['--version'] || defaultDenoVersion;
		delete args['--version'];

		if (!denoVersion.startsWith('v')) {
			denoVersion = `v${denoVersion}`;
		}

		const denoDir = join(cacheDir, 'deno');

		const env: Env = {
			...process.env,
			...args.env,
			DENO_DIR: denoDir,
			ENTRYPOINT: join(cwd, entrypoint),
		};

		const [runtimeDeno, buildTimeDeno] = await Promise.all([
			// For runtime, Linux 64-bit Deno binary will be downloaded
			downloadDeno(denoDir, denoVersion, 'linux', 'x64'),
			// If the build is being executed on a different OS/arch,
			// then also download Deno binary for the build host
			process.platform !== 'linux' || process.arch !== 'x64'
				? downloadDeno(
						denoDir,
						denoVersion,
						process.platform,
						process.arch
				  )
				: undefined,
		]);

		// Add build-time Deno version to $PATH
		const origPath = env.PATH;
		env.PATH = [buildTimeDeno?.dir || runtimeDeno.dir, origPath].join(':');

		// This flag is specific to `vercel-deno`, so it does not
		// get included in the args that are passed to `deno run`
		const includeFiles = args['--include-files'] || [];
		delete args['--include-files'];

		const argv = ['--allow-all', ...args];
		console.log('Caching imports…');
		console.log(`deno run ${argv.join(' ')} ${entrypoint}`);
		const cp = spawn(
			'deno',
			['run', ...argv, join(__dirname, 'runtime.ts')],
			{
				env,
				cwd: cwd,
				stdio: 'inherit',
			}
		);
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

		try {
			outputFiles['deno.lock'] = await FileFsRef.fromFsPath({
				fsPath: join(cwd, 'deno.lock'),
			});
		} catch {
			// Ignore if `deno.lock` does not exist.
		}

		await Promise.all([
			traceDenoInfo(
				outputFiles,
				env,
				denoDir,
				cwd,
				join(__dirname, 'runtime.ts'),
				'.vercel-deno-runtime.ts'
			),
			traceDenoInfo(
				outputFiles,
				env,
				denoDir,
				cwd,
				join(cwd, entrypoint)
			),
			glob('node_modules/.deno/**', {
				cwd,
				includeDirectories: true,
			}).then((files) => {
				Object.assign(outputFiles, files);
			}),
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
				fsPath: join(cwd, filename),
			});
		}

		// Add additional files that were referenced from
		// `--include-files` CLI flag or the `vercel.json` config
		includeFiles.push(..._includeFiles);
		for (const pattern of includeFiles) {
			const matches = await glob(pattern, cwd);
			for (const name of Object.keys(matches)) {
				if (!outputFiles[name]) {
					outputFiles[name] = matches[name];
				}
			}
		}

		return new DenoLambda({
			files: outputFiles,
			handler: entrypoint,
			environment: args.env,
		});
	}
}

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
			// NOTE: As of `deno` v1.23.0, `.buildinfo` files are no
			// longer created, so this logic can be removed eventually
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
