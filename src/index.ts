import fs from 'fs';
import yn from 'yn';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import once from '@tootallnate/once';
import {
	AnalyzeOptions,
	BuildOptions,
	Config,
	Files,
	FileFsRef,
	StartDevServerOptions,
	StartDevServerResult,
	createLambda,
	download,
	glob,
	shouldServe,
} from '@vercel/build-utils';

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
	fileInfos: { [name: string]: FileInfo };
	referencedMap: { [name: string]: string[] };
	exportedModulesMap: { [name: string]: string[] };
	semanticDiagnosticsPerFile: string[];
}

interface BuildInfo {
	program: Program;
	version: string;
}

const DEFAULT_DENO_VERSION = 'v1.1.2';

// `chmod()` is required for usage with `vercel-dev-runtime` since
// file mode is not preserved in Vercel deployments from the CLI.
fs.chmodSync(join(__dirname, 'build.sh'), 0o755);
fs.chmodSync(join(__dirname, 'bootstrap'), 0o755);

function configBool(
	config: Config,
	configName: string,
	env: Env,
	envName: string
): boolean | void {
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
): string | void {
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

	const debug = configBool(config, 'debug', process.env, 'DEBUG') || false;
	const unstable =
		configBool(config, 'denoUnstable', process.env, 'DENO_UNSTABLE') ||
		false;
	let denoVersion =
		configString(config, 'denoVersion', process.env, 'DENO_VERSION') ||
		DEFAULT_DENO_VERSION;

	if (!denoVersion.startsWith('v')) {
		denoVersion = `v${denoVersion}`;
	}

	const env: Env = {
		...process.env,
		BUILDER: __dirname,
		ENTRYPOINT: entrypoint,
		DENO_VERSION: denoVersion,
	};

	if (debug) {
		env.DEBUG = '1';
	}

	if (unstable) {
		env.DENO_UNSTABLE = '1';
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
			if (dep.startsWith(workPathUri)) {
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
			fileInfos,
			referencedMap,
			exportedModulesMap,
			semanticDiagnosticsPerFile,
		} = buildInfo.program;

		for (const filename of Object.keys(fileInfos)) {
			if (filename.startsWith(workPathUri)) {
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
				if (ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file:///var/task/${relative}`;
					refs[i] = updated;
					sourceFiles.add(relative);
					needsWrite = true;
				}
			}

			if (filename.startsWith(workPathUri)) {
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
				if (ref.startsWith(workPathUri)) {
					const relative = ref.substring(workPathUri.length + 1);
					const updated = `file:///var/task/${relative}`;
					refs[i] = updated;
					sourceFiles.add(relative);
					needsWrite = true;
				}
			}

			if (filename.startsWith(workPathUri)) {
				const relative = filename.substring(workPathUri.length + 1);
				const updated = `file:///var/task/${relative}`;
				exportedModulesMap[updated] = refs;
				delete exportedModulesMap[filename];
				sourceFiles.add(relative);
				needsWrite = true;
			}
		}

		for (let i = 0; i < semanticDiagnosticsPerFile.length; i++) {
			const ref = semanticDiagnosticsPerFile[i];
			if (ref.startsWith(workPathUri)) {
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

	const outputFiles: Files = {
		bootstrap: await FileFsRef.fromFsPath({
			fsPath: join(workPath, 'bootstrap'),
		}),
		...(await glob('.deno/**/*', workPath)),
	};

	console.log('Detected source files:');
	for (const filename of Array.from(sourceFiles).sort()) {
		console.log(` - ${filename}`);
		outputFiles[filename] = await FileFsRef.fromFsPath({
			fsPath: join(workPath, filename),
		});
	}

	const lambdaEnv: { [name: string]: string } = {};

	if (unstable) {
		lambdaEnv.DENO_UNSTABLE = '1';
	}

	const output = await createLambda({
		files: outputFiles,
		handler: entrypoint,
		runtime: 'provided',
		environment: lambdaEnv,
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
	const unstable =
		configBool(
			config,
			'denoUnstable',
			meta.buildEnv || {},
			'DENO_UNSTABLE'
		) || false;

	const portFile = join(
		tmpdir(),
		`vercel-deno-port-${Math.random().toString(32).substring(2)}`
	);

	const env: Env = {
		...process.env,
		...meta.env,
		VERCEL_DEV_ENTRYPOINT: join(workPath, entrypoint),
		VERCEL_DEV_PORT_FILE: portFile,
	};

	const args: string[] = ['run'];

	if (unstable) {
		args.push('--unstable');
	}

	args.push(
		'--allow-env',
		'--allow-net',
		'--allow-read',
		'--allow-write',
		join(__dirname, 'dev-server.ts')
	);

	const child = spawn('deno', args, {
		cwd: workPath,
		env,
		stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
	});

	const portPipe = child.stdio[3];
	if (!isReadable(portPipe)) {
		throw new Error('Not readable');
	}

	const onPort = new Promise<PortInfo>((resolve) => {
		portPipe.setEncoding('utf8');
		portPipe.once('data', (d) => {
			resolve({ port: Number(d) });
		});
	});
	const onPortFile = waitForPortFile(portFile);
	const onExit = once.spread<[number, string | null]>(child, 'exit');
	const result = await Promise.race([onPort, onPortFile, onExit]);
	onExit.cancel();
	onPortFile.cancel();

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
}

export interface CancelablePromise<T> extends Promise<T> {
	cancel: () => void;
}

function waitForPortFile(portFile: string) {
	const opts = { portFile, canceled: false };
	const promise = waitForPortFile_(
		opts
	) as CancelablePromise<PortInfo | void>;
	promise.cancel = () => {
		opts.canceled = true;
	};
	return promise;
}

async function waitForPortFile_(opts: {
	portFile: string;
	canceled: boolean;
}): Promise<PortInfo | void> {
	while (!opts.canceled) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			const port = Number(await readFile(opts.portFile, 'ascii'));
			unlink(opts.portFile).catch((err) => {
				console.error('Could not delete port file: %j', opts.portFile);
			});
			return { port };
		} catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
	}
}
