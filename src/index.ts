/**
 * The default version of Deno that will be downloaded at build-time.
 */
const DEFAULT_DENO_VERSION = 'v1.20.1';

import fs from 'fs';
import yn from 'yn';
import { dirname, join, relative, resolve } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import once from '@tootallnate/once';
import {
	BuildOptions,
	Config,
	Files,
	FileBlob,
	FileFsRef,
	StartDevServerOptions,
	StartDevServerResult,
	createLambda,
	download,
	glob,
	shouldServe,
} from '@vercel/build-utils';
import * as shebang from './shebang';
import { isURL } from './util';
import { bashShellQuote } from 'shell-args';
import { AbortController, AbortSignal } from 'abort-controller';

const { stat, readdir, readFile, writeFile, unlink } = fs.promises;

type Env = typeof process.env;

interface Graph {
	deps: string[];
	version_hash: string;
}

interface FileInfo {
	version: string;
	signature: string;
	affectsGlobalScope: boolean;
}

interface Program {
	fileNames?: string[];
	fileInfos: { [name: string]: FileInfo };
	referencedMap: { [name: string]: string[] };
	exportedModulesMap: { [name: string]: string[] };
	semanticDiagnosticsPerFile?: string[];
}

interface BuildInfo {
	program: Program;
	version: string;
}

const TMP = tmpdir();

// `chmod()` is required for usage with `vercel-dev-runtime` since
// file mode is not preserved in Vercel deployments from the CLI.
fs.chmodSync(join(__dirname, 'build.sh'), 0o755);
fs.chmodSync(join(__dirname, 'bootstrap'), 0o755);

function configBool(
	config: Config,
	configName: string,
	env: Env,
	envName: string
): boolean | undefined {
	const configVal = config[configName];
	if (typeof configVal === 'boolean') {
		return configVal;
	}

	if (typeof configVal === 'string' || typeof configVal === 'number') {
		const d = yn(configVal);
		if (typeof d === 'boolean') {
			return d;
		}
	}

	const envVal = env[envName];
	if (typeof envVal === 'string') {
		const d = yn(envVal);
		if (typeof d === 'boolean') {
			return d;
		}
	}
}

function configString(
	config: Config,
	configName: string,
	env: Env,
	envName: string
): string | undefined {
	const configVal = config[configName];
	if (typeof configVal === 'string') {
		return configVal;
	}

	const envVal = env[envName];
	if (typeof envVal === 'string') {
		return envVal;
	}
}

export const version = 3;

export { shouldServe };

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

	const absEntrypoint = join(workPath, entrypoint);
	const absEntrypointDir = dirname(absEntrypoint);
	const args = shebang.parse(
		await readFile(absEntrypoint, 'utf8')
	);

	const debug = configBool(config, 'debug', process.env, 'DEBUG') || false;

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

	if (denoVersion && !denoVersion.startsWith('v')) {
		denoVersion = `v${denoVersion}`;
	}

	const env: Env = {
		...process.env,
		...args.env,
		BUILDER: __dirname,
		ENTRYPOINT: entrypoint,
		DENO_VERSION: denoVersion || DEFAULT_DENO_VERSION,
	};

	if (debug) {
		env.DEBUG = '1';
	}

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
	const builderPath = join(__dirname, 'build.sh');
	const cp = spawn(builderPath, argv, {
		env,
		cwd: workPath,
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
	const workPathUri = `file://${workPath}`;
	const genFileDir = join(workPath, '.deno/gen/file');
	for await (const file of getFilesWithExtension(genFileDir, '.graph')) {
		let needsWrite = false;
		const graph: Graph = JSON.parse(await readFile(file, 'utf8'));
		for (let i = 0; i < graph.deps.length; i++) {
			const dep = graph.deps[i];
			if (typeof dep === 'string' && dep.startsWith(workPathUri)) {
				const relative = dep.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				graph.deps[i] = updated;
				sourceFiles.add(relative);
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
				const updated = `file:///var/task/${relative}`;
				fileInfos[updated] = fileInfos[filename];
				delete fileInfos[filename];
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		for (const [filename, refs] of Object.entries(referencedMap)) {
			for (let i = 0; i < refs.length; i++) {
				const ref = refs[i];
				if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file:///var/task/${relative}`;
					refs[i] = updated;
					sourceFiles.add(relative);
					needsWrite = true;
				}
			}

			if (
				typeof filename === 'string' &&
				filename.startsWith(workPathUri)
			) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				referencedMap[updated] = refs;
				delete referencedMap[filename];
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		for (const [filename, refs] of Object.entries(exportedModulesMap)) {
			for (let i = 0; i < refs.length; i++) {
				const ref = refs[i];
				if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file:///var/task/${relative}`;
					refs[i] = updated;
					sourceFiles.add(relative);
					needsWrite = true;
				}
			}

			if (
				typeof filename === 'string' &&
				filename.startsWith(workPathUri)
			) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				exportedModulesMap[updated] = refs;
				delete exportedModulesMap[filename];
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		for (let i = 0; i < fileNames.length; i++) {
			const ref = fileNames[i];
			if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
				const relative = ref.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				fileNames[i] = updated;
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		for (let i = 0; i < semanticDiagnosticsPerFile.length; i++) {
			const ref = semanticDiagnosticsPerFile[i];
			if (typeof ref === 'string' && ref.startsWith(workPathUri)) {
				const relative = ref.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				semanticDiagnosticsPerFile[i] = updated;
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		if (needsWrite) {
			console.log('Patched %j', file);
			await writeFile(file, JSON.stringify(buildInfo, null, 2));
		}
	}

	const bootstrapData = (
		await readFile(join(workPath, 'bootstrap'), 'utf8')
	).replace('$args', bashShellQuote(argv));

	const outputFiles: Files = {
		bootstrap: new FileBlob({
			data: bootstrapData,
			mode: fs.statSync(join(workPath, 'bootstrap')).mode,
		}),
		...(await glob('.deno/**/*', workPath)),
	};

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

	console.log('Detected source files:');
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

	const output = await createLambda({
		files: outputFiles,
		handler: entrypoint,
		runtime: 'provided.al2',
		environment: args.env,
	});

	return { output };
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
	config,
	meta = {},
}: StartDevServerOptions): Promise<StartDevServerResult> {
	// @deprecated
	const unstable =
		configBool(
			config,
			'denoUnstable',
			meta.buildEnv || {},
			'DENO_UNSTABLE'
		) || false;

	// @deprecated
	const denoTsConfig = configString(
		config,
		'tsconfig',
		meta.buildEnv || {},
		'DENO_TSCONFIG'
	);

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

	const args = shebang.parse(await readFile(absEntrypoint, "utf8"));

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
