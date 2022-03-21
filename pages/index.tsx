import fs from 'fs';
import Link from 'next/link';
import { basename, extname, join } from 'path';

export async function getStaticProps() {
	const apiDir = join(process.cwd(), 'api');
	const apiFiles = await fs.promises.readdir(apiDir);
	const examples = apiFiles
		.filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
		.map((f) => basename(f, extname(f)));
	return { props: { examples } };
}

export default function Index ({ examples }) {
	return (
		<div>
			<p>Hello from Deno, powered by Vercel!</p>
			<div>
				<h3>Examples:</h3>
				<ul>
					{examples.map((example) => (
						<li key={example}>
							<Link href={`/api/${example}`}>
								<a>{example}</a>
							</Link>
							{' '}
							(
								<Link href={`https://github.com/vercel-community/deno/blob/master/api/${example}.ts`}>
									<a target="_blank" rel="noopener noreferrer">Source</a>
								</Link>
							)
						</li>
					))}
				</ul>
			</div>
		</div>
	);
};
