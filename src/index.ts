/**
 * The default version of Deno that will be downloaded at build-time.
 */
const DEFAULT_DENO_VERSION = 'v1.20.1';

import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { dirname, join, relative, resolve } from 'path';
import {
	chmodSync,
	readFileSync,
	statSync,
	readFile,
	readdir,
	stat,
	readJSON,
} from 'fs-extra';
import once from '@tootallnate/once';
import {
	Env,
	Files,
	FileBlob,
	FileFsRef,
	Lambda,
	download,
	glob,
	BuildV3,
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
		traceDenoDir(
			outputFiles,
			denoDir,
			join(__dirname, 'runtime.ts'),
			workPath,
			'.vercel-deno-runtime.ts'
		),
		traceDenoDir(
			outputFiles,
			denoDir,
			join(workPath, entrypoint),
			workPath
		),
	]);

	const sourceFiles = new Set<string>();
	for (const flag of [
		'--cert',
		'--config',
		'--import-map',
		'--lock',
	] as const) {
		const val = args[flag];
		if (typeof val === 'string' && !isURL(val)) {
			sourceFiles.add(val);
		}
	}

	for (const filename of Array.from(sourceFiles).sort()) {
		console.log(` - ${filename}`);
		outputFiles[filename] = await FileFsRef.fromFsPath({
			fsPath: join(workPath, filename),
		});
	}

	if (config.includeFiles) {
		if (typeof config.includeFiles === 'string') {
			includeFiles.push(config.includeFiles);
		} else {
			includeFiles.push(...config.includeFiles);
		}
	}

	if (includeFiles.length > 0) {
		console.log('Including additional files:');
		for (const pattern of includeFiles) {
			const matches = await glob(pattern, workPath);
			for (const name of Object.keys(matches)) {
				if (!outputFiles[name]) {
					console.log(` - ${name}`);
					outputFiles[name] = matches[name];
				}
			}
		}
	}

	//console.log(outputFiles);

	const output = new Lambda({
		files: outputFiles,
		handler: entrypoint,
		runtime: 'provided.al2',
		environment: args.env,
	});

	return { output };
};

async function* getFilesWithExtension(
	dir: string,
	ext: string
): AsyncIterable<string> {
	const files = await readdir(dir);
	for (const file of files) {
		const absolutePath = join(dir, file);
		if (file.endsWith(ext)) {
			yield absolutePath;
		} else {
			const s = await stat(absolutePath);
			if (s.isDirectory()) {
				yield* getFilesWithExtension(absolutePath, ext);
			}
		}
	}
}

async function traceDenoDir(
	files: Files,
	denoDir: string,
	entrypoint: string,
	cwd: string,
	renameFile = '',
	renameDir = '/var/task'
) {
	const buildInfoPath = join(denoDir, 'gen/file', `${entrypoint}.buildinfo`);
	const buildInfo: BuildInfo = await readJSON(buildInfoPath);
	const fileNames = buildInfo.program.fileNames;
	if (!fileNames) {
		console.log(`No buildinfo files detected for: "${entrypoint}"`);
		return;
	}
	const outputDenoDir = relative(cwd, denoDir);
	const renamedDenoDir = join(outputDenoDir, 'gen/file', renameDir);

	// TODO: is there a more optimal way to calculate the
	// hash rather than a reverse lookup?
	const depsUrlToHash = new Map<string, string>();
	const denoDirDeps = join(denoDir, 'deps');
	const metadataExt = '.metadata.json';
	for await (const file of getFilesWithExtension(denoDirDeps, metadataExt)) {
		const metadata = await readJSON(file);
		depsUrlToHash.set(
			metadata.url,
			relative(denoDirDeps, file.slice(0, -metadataExt.length))
		);
	}
	//console.log(depsUrlToHash)

	for (let i = 0; i < fileNames.length; i++) {
		const fileName = fileNames[i];
		if (fileName.startsWith('file://')) {
			const filePath = fileURLToPath(fileName);
			const outputPath = renameFile || relative(cwd, filePath);
			const outputURL = pathToFileURL(join(renameDir, outputPath));

			// Update `.buildinfo` with renamed source file URL
			fileNames[i] = outputURL.href;

			// Add source file to output files
			files[outputPath] = await FileFsRef.fromFsPath({
				fsPath: filePath,
			});

			// Add gen `.meta` file to output files
			const metaPath = join(denoDir, 'gen/file', `${filePath}.meta`);
			const metaOutputPath = join(renamedDenoDir, `${outputPath}.meta`);
			files[metaOutputPath] = await FileFsRef.fromFsPath({
				fsPath: metaPath,
			});

			// Add gen compiled source file to output files
			const compiledPath = join(denoDir, 'gen/file', `${filePath}.js`);
			const compiledOutputPath = join(renamedDenoDir, `${outputPath}.js`);
			files[compiledOutputPath] = await FileFsRef.fromFsPath({
				fsPath: compiledPath,
			});
		} else if (fileName.startsWith('https://')) {
			const depPath = depsUrlToHash.get(fileName);
			if (!depPath) {
				throw new Error(`Could not find dependency: "${fileName}"`);
			}

			// Add deps source file to output files
			const depOutputPath = join(outputDenoDir, 'deps', depPath);
			files[depOutputPath] = await FileFsRef.fromFsPath({
				fsPath: join(denoDir, 'deps', depPath),
			});

			// Add deps `.metadata.json` file to output files
			const metadataPath = `${depPath}${metadataExt}`;
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
		} else if (fileName.startsWith('asset://')) {
			// Ignore
		} else {
			throw new Error(`Unsupported file protocol: ${fileName}`);
		}
	}

	// Output updated `.buildinfo` file for the entrypoint
	const buildInfoOutputName = renameFile || relative(cwd, entrypoint);
	const buildInfoOutputPath = join(
		renamedDenoDir,
		`${buildInfoOutputName}.buildinfo`
	);
	files[buildInfoOutputPath] = new FileBlob({
		data: JSON.stringify(buildInfo, null, 2),
	});
}
