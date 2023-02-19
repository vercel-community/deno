import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import once from '@tootallnate/once';
import { Env, shouldServe, StartDevServer } from '@vercel/build-utils';
import { AbortController, AbortSignal } from 'abort-controller';
import * as shebang from './shebang';

export { shouldServe };

const { readFile, unlink } = fs.promises;

const TMP = tmpdir();

interface PortInfo {
	port: number;
}

function isPortInfo(v: any): v is PortInfo {
	return v && typeof v.port === 'number';
}

function isReadable(v: any): v is Readable {
	return v && v.readable === true;
}

export const startDevServer: StartDevServer = async ({
	entrypoint,
	workPath,
	meta = {},
}) => {
	const portFile = join(
		TMP,
		`vercel-deno-port-${Math.random().toString(32).substring(2)}`
	);

	const absEntrypoint = join(workPath, entrypoint);

	const env: Env = {
		...process.env,
		...meta.env,
		VERCEL_DEV_ENTRYPOINT: absEntrypoint,
		VERCEL_DEV_PORT_FILE: portFile,
	};

	const args = shebang.parse(await readFile(absEntrypoint, 'utf8'));

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
};

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
