import fs from 'fs';
import arg from 'arg';
import { keys } from 'ramda';
import { bashShellParse } from 'shell-args';

export async function parse(filePath: string) {
	let argv: string[] = [];
	const data = await fs.promises.readFile(filePath, 'utf8');
	const firstLine = data.split('\n', 1)[0];

	if (firstLine.startsWith('#!')) {
		const shebang = firstLine.replace(/^\#\!/, '');
		const args = bashShellParse(shebang);

		// Slice off the beginning args until an option is found
		let start = 0;
		for (; start < args.length; start++) {
			if (args[start][0] === '-') break;
		}
		argv = args.slice(start);
	}

	return arg(
		{
			'--cert': String,
			'--config': String,
			'-c': '--config',
			'--import-map': String,
			'--lock': String,
			'--unstable': Boolean,

			// `vercel-deno` specific flags
			'--include-files': [String],
		},
		{ argv, permissive: true }
	);
}

export type Then<T> = T extends PromiseLike<infer U> ? U : never;

export function toArray(args: Then<ReturnType<typeof parse>>) {
	const arr: string[] = [];
	for (const key of keys(args)) {
		if (key === '_') continue;
		const val = args[key];
		if (typeof val === 'boolean' && val) {
			arr.push(key);
		} else if (typeof val === 'string') {
			arr.push(key, val);
		}
	}
	return arr.concat(args._);
}
