import fs from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { unzip } from './unzip';

const { mkdir, stat } = fs.promises;

const PLATFORM_MAP = new Map([
	['darwin', 'apple-darwin'],
	['linux', 'unknown-linux-gnu'],
	['win32', 'pc-windows-msvc'],
]);

const ARCH_MAP = new Map([
	['x64', 'x86_64'],
	['arm64', 'aarch64'],
]);

export async function downloadDeno(
	denoDir: string,
	version: string,
	nodePlatform: string,
	nodeArch: string
) {
	const platform = PLATFORM_MAP.get(nodePlatform);
	if (!platform) {
		throw new Error(`Unsupported operating system: "${nodePlatform}"`);
	}
	const arch = ARCH_MAP.get(nodeArch);
	if (!arch) {
		throw new Error(`Unsupported CPU architecture: "${nodeArch}"`);
	}
	const ext = platform === 'win32' ? '.exe' : '';
	const dir = join(denoDir, `bin-${arch}-${platform}-${version}`);
	const bin = join(dir, `deno${ext}`);
	try {
		// If the Deno binary exists then it's already been downloaded,
		// so no need to download again. TODO: shasum verification
		const s = await stat(bin);
		console.log(s);
	} catch (err: any) {
		if (err.code !== 'ENOENT') throw err;
		const url = `https://github.com/denoland/deno/releases/download/${version}/deno-${arch}-${platform}.zip`;
		await mkdir(dir, { recursive: true });
		console.log(`Downloading Deno ${version} (${arch}-${platform})…`);
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(
				`Failed to download Deno from ${url}: ${res.status}`
			);
		}
		const zipBuffer = await res.buffer();
		await unzip(zipBuffer, dir);
	}
	return { dir };
}
