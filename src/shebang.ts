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

	const args = arg(
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

	function* iterator(this: typeof args) {
		for (const key of keys(this)) {
			if (key === '_') continue;
			const val = this[key];
			if (typeof val === 'boolean' && val) {
				yield key;
			} else if (typeof val === 'string') {
				yield key;
				yield val;
			}
		}
		yield* this._;
	}

	Object.defineProperty(args, Symbol.iterator, {
		value: iterator,
	});

	return args as typeof args & {
		[Symbol.iterator]: typeof iterator;
	};
}
