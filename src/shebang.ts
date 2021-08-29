import arg from 'arg';
import { keys } from 'ramda';
import { bashShellParse } from 'shell-args';

export function parse(data: string) {
	let argv: string[] = [];
	const env: { [name: string]: string } = {};
	const firstLine = data.split('\n', 1)[0];

	if (firstLine.startsWith('#!')) {
		const shebang = firstLine.substring(2);
		const args = bashShellParse(shebang);

		// Slice off the beginning args until an option is found
		let start = 0;
		for (; start < args.length; start++) {
			const arg = args[start];

			if (arg.startsWith('-')) {
				// Found an option, so stop searching
				break;
			}

			const eqIndex = arg.indexOf('=');
			if (eqIndex !== -1) {
				// Found an env var, so add it to the map
				const name = arg.slice(0, eqIndex);
				const value = arg.slice(eqIndex + 1);
				env[name] = value;
			}
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
			'--version': String,
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

	Object.defineProperty(args, "env", {
		value: env,
		enumerable: true,
	});

	return args as typeof args & {
		env: typeof env;
		[Symbol.iterator]: typeof iterator;
	};
}
