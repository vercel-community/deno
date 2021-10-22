/**
 * The default version of Deno that will be downloaded at build-time.
 */
const DEFAULT_DENO_VERSION = 'v1.15.2';

import fs from 'fs';
import yn from 'yn';
import globby from 'globby';
import { join, dirname, relative, resolve, parse as pathParse } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { bashShellQuote } from 'shell-args';
import { AbortController, AbortSignal } from 'abort-controller';
import once from '@tootallnate/once';
import {
	StartDevServerOptions,
	StartDevServerResult,
	shouldServe,
} from '@vercel/build-utils';
import * as shebang from './shebang';
import { isURL } from './util';
import { Env, Graph, BuildInfo, FunctionsManifest } from './types';

const {
	copyFile,
	mkdir,
	stat,
	readdir,
	rmdir,
	readFile,
	writeFile,
	rename,
	unlink,
} = fs.promises;

const TMP = tmpdir();

// `chmod()` is required for usage with `vercel-dev-runtime` since
// file mode is not preserved in Vercel deployments from the CLI.
fs.chmodSync(join(__dirname, 'build.sh'), 0o755);
fs.chmodSync(join(__dirname, 'bootstrap'), 0o755);

export { shouldServe };

export async function build() {
	const entrypoints = await globby('api/**/*.[jt]s');
	for (const entrypoint of entrypoints) {
		await buildEntrypoint(entrypoint);
	}
}

export async function buildEntrypoint(entrypoint: string) {
	const cwd = process.cwd();
	const outputPath = join(cwd, '.output');
	const { dir, name } = pathParse(entrypoint);
	const entrypointWithoutExt = join(
		dir,
		name,
		// "index" is enforced as a suffix so that nesting works properly
		// i.e. "api/foo.ts"     -> "api/foo/index"
		//      "api/foo/bar.ts" -> "api/foo/bar/index"
		name === 'index' ? '' : 'index'
	);
	const workPath = join(outputPath, 'server/pages', entrypointWithoutExt);
	console.log(`Compiling ${entrypoint} to ${workPath}`);
	await mkdir(workPath, { recursive: true });

	const absEntrypoint = resolve(entrypoint);
	const absEntrypointDir = dirname(absEntrypoint);
	const args = shebang.parse(await readFile(absEntrypoint, 'utf8'));

	const debug = yn(process.env.DEBUG) || false;

	let denoVersion = args['--version'] || DEFAULT_DENO_VERSION;
	delete args['--version'];

	if (!denoVersion.startsWith('v')) {
		denoVersion = `v${denoVersion}`;
	}

	const env: Env = {
		...process.env,
		...args.env,
		BUILDER: __dirname,
		ROOT_DIR: workPath,
		ENTRYPOINT: entrypoint,
		DENO_VERSION: denoVersion,
	};

	if (debug) {
		env.DEBUG = '1';
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
			args[flag] = relative(cwd, resolve(absEntrypointDir, val));
		}
	}

	// This flag is specific to `vercel-deno`, so it does not
	// get included in the args that are passed to `deno run`
	const includeFiles = (args['--include-files'] || []).map((f) => {
		return relative(cwd, join(absEntrypointDir, f));
	});
	delete args['--include-files'];

	const argv = ['--allow-all', ...args];
	const builderPath = join(__dirname, 'build.sh');
	const cp = spawn(builderPath, argv, {
		env,
		stdio: 'inherit',
	});
	const [code] = await once(cp, 'exit');
	if (code !== 0) {
		throw new Error(`Build script failed with exit code ${code}`);
	}

	const sourceFiles = new Set<string>();
	sourceFiles.add(entrypoint);

	// Patch the `.graph` files to use file paths beginning with `/var/task`
	// to hot-fix a Deno issue (https://github.com/denoland/deno/issues/6080).
	const genFileDir = join(workPath, '.deno/gen/file');
	await moveCacheFiles(genFileDir, cwd, '/var/task', sourceFiles);
	await moveCacheFiles(genFileDir, __dirname, '/var/task');

	// Write the generated `bootstrap` file
	const origBootstrapPath = join(__dirname, 'bootstrap');
	const origBootstrapData = await readFile(origBootstrapPath, 'utf8');
	const bootstrapData = origBootstrapData.replace(
		'$args',
		bashShellQuote(argv)
	);
	await writeFile(join(workPath, 'bootstrap'), bootstrapData, {
		mode: fs.statSync(origBootstrapPath).mode,
	});

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

	// Copy the necessary source files into the output work path
	console.log('Detected source files:');
	for (const filename of Array.from(sourceFiles).sort()) {
		console.log(` - ${filename}`);
		const dest = join(workPath, filename);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(filename, dest);
	}

	if (includeFiles.length > 0) {
		console.log('Including additional files:');
		for (const pattern of includeFiles) {
			const matches = await globby(pattern);
			for (const filename of matches) {
				console.log(` - ${filename}`);
				const dest = join(workPath, filename);
				await mkdir(dirname(dest), { recursive: true });
				await copyFile(filename, dest);
				//outputFiles[name] = matches[name];
			}
		}
	}

	const functionsManifestPath = join(outputPath, 'functions-manifest.json');
	let functionsManifest: FunctionsManifest = {};
	try {
		functionsManifest = JSON.parse(
			await readFile(functionsManifestPath, 'utf8')
		);
	} catch (_err) {
		// ignore...
	}
	if (!functionsManifest.pages) functionsManifest.pages = {};
	functionsManifest.pages[entrypointWithoutExt] = {
		handler: entrypoint,
		runtime: 'provided.al2',
		//	environment: args.env,
	};
	await writeFile(
		functionsManifestPath,
		JSON.stringify(functionsManifest, null, 2)
	);
}

async function moveCacheFiles(
	genFileDir: string,
	oldPath: string,
	newPath: string,
	sourceFiles?: Set<string>
) {
	const workPathUri = `file://${oldPath}`;

	for await (const file of getFilesWithExtension(genFileDir, '.graph')) {
		let needsWrite = false;
		const graph: Graph = JSON.parse(await readFile(file, 'utf8'));
		for (let i = 0; i < graph.deps.length; i++) {
			const dep = graph.deps[i];
			if (typeof dep === 'string' && dep.startsWith(workPathUri)) {
				const relative = dep.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				graph.deps[i] = updated;
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}
		if (needsWrite) {
			console.log('Patched %j', file);
			await writeFile(file, JSON.stringify(graph, null, 2));
		}
	}

	for await (const file of getFilesWithExtension(genFileDir, '.buildinfo')) {
		let needsWrite = false;
		const buildInfo: BuildInfo = JSON.parse(await readFile(file, 'utf8'));
		const {
			fileNames = [],
			fileInfos,
			referencedMap,
			exportedModulesMap,
			semanticDiagnosticsPerFile = [],
		} = buildInfo.program;

		for (const filename of Object.keys(fileInfos)) {
			if (
				typeof filename === 'string' &&
				filename.startsWith(workPathUri)
			) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				fileInfos[updated] = fileInfos[filename];
				delete fileInfos[filename];
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}

		for (const [filename, refs] of Object.entries(referencedMap)) {
			for (let i = 0; i < refs.length; i++) {
				const ref = refs[i];
				if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file://${newPath}/${relative}`;
					refs[i] = updated;
					sourceFiles?.add(relative);
					needsWrite = true;
				}
			}

			if (
				typeof filename === 'string' &&
				filename.startsWith(workPathUri)
			) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				referencedMap[updated] = refs;
				delete referencedMap[filename];
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}

		for (const [filename, refs] of Object.entries(exportedModulesMap)) {
			for (let i = 0; i < refs.length; i++) {
				const ref = refs[i];
				if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file://${newPath}/${relative}`;
					refs[i] = updated;
					sourceFiles?.add(relative);
					needsWrite = true;
				}
			}

			if (
				typeof filename === 'string' &&
				filename.startsWith(workPathUri)
			) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				exportedModulesMap[updated] = refs;
				delete exportedModulesMap[filename];
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}

		for (let i = 0; i < fileNames.length; i++) {
			const ref = fileNames[i];
			if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
				const relative = ref.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				fileNames[i] = updated;
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}

		for (let i = 0; i < semanticDiagnosticsPerFile.length; i++) {
			const ref = semanticDiagnosticsPerFile[i];
			if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
				const relative = ref.substring(workPathUri.length + 1);
				const updated = `file://${newPath}/${relative}`;
				semanticDiagnosticsPerFile[i] = updated;
				sourceFiles?.add(relative);
				needsWrite = true;
			}
		}

		if (needsWrite) {
			console.log('Patched %j', file.substring(genFileDir.length));
			await writeFile(file, JSON.stringify(buildInfo, null, 2));
		}
	}

	const oldPathAbs = join(genFileDir, oldPath);
	const newPathAbs = join(genFileDir, newPath);

	// Ensure the new dir exists
	await mkdir(newPathAbs, { recursive: true });

	// Move all the files within the old path to the new dir
	for (const f of await readdir(oldPathAbs)) {
		await rename(join(oldPathAbs, f), join(newPathAbs, f));
	}

	// Delete any empty directories in old path
	await deleteEmptyDirs(oldPathAbs);
}

async function deleteEmptyDirs(dir: string): Promise<void> {
	const files = await readdir(dir);
	if (files.length !== 0) return;
	//console.log('Deleting', dir)
	await rmdir(dir);
	return deleteEmptyDirs(dirname(dir));
}

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

interface PortInfo {
	port: number;
}

function isPortInfo(v: any): v is PortInfo {
	return v && typeof v.port === 'number';
}

function isReadable(v: any): v is Readable {
	return v && v.readable === true;
}

export async function startDevServer({
	entrypoint,
	workPath,
	meta = {},
}: StartDevServerOptions): Promise<StartDevServerResult> {
	const portFile = join(
		TMP,
		`vercel-deno-port-${Math.random().toString(32).substring(2)}`
	);

	const absEntrypoint = join(workPath, entrypoint);
	const absEntrypointDir = dirname(absEntrypoint);

	const env: Env = {
		...process.env,
		...meta.env,
		VERCEL_DEV_ENTRYPOINT: absEntrypoint,
		VERCEL_DEV_PORT_FILE: portFile,
	};

	const args = shebang.parse(absEntrypoint);

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

	const argv = [
		'run',
		'--allow-all',
		...args,
		join(__dirname, 'dev-server.ts'),
	];
	const child = spawn('deno', argv, {
		cwd: workPath,
		env,
		stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
	});

	const portPipe = child.stdio[3];
	if (!isReadable(portPipe)) {
		throw new Error('Not readable');
	}

	const controller = new AbortController();
	const { signal } = controller;
	const onPort = new Promise<PortInfo>((resolve) => {
		portPipe.setEncoding('utf8');
		portPipe.once('data', (d) => {
			resolve({ port: Number(d) });
		});
	});
	const onPortFile = waitForPortFile({ portFile, signal });
	const onExit = once(child, 'exit', { signal });
	try {
		const result = await Promise.race([onPort, onPortFile, onExit]);

		if (isPortInfo(result)) {
			return {
				port: result.port,
				pid: child.pid,
			};
		} else if (Array.isArray(result)) {
			// Got "exit" event from child process
			throw new Error(
				`Failed to start dev server for "${entrypoint}" (code=${result[0]}, signal=${result[1]})`
			);
		} else {
			throw new Error('Unexpected error');
		}
	} finally {
		controller.abort();
	}
}

async function waitForPortFile(opts: {
	portFile: string;
	signal: AbortSignal;
}): Promise<PortInfo | void> {
	while (!opts.signal.aborted) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			const port = Number(await readFile(opts.portFile, 'ascii'));
			unlink(opts.portFile).catch((_) => {
				console.error('Could not delete port file: %j', opts.portFile);
			});
			return { port };
		} catch (err: any) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
	}
}
