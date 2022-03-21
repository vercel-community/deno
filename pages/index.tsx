import fs from 'fs';
import Link from 'next/link';
import { basename, extname, join } from 'path';

export async function getStaticProps() {
	const sha = process.env.VERCEL_GIT_COMMIT_SHA || 'master';
	const apiDir = join(process.cwd(), 'api');
	const apiFiles = await fs.promises.readdir(apiDir);
	const examples = apiFiles
		.filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
	return { props: { sha, examples } };
}

export default function Index ({ sha, examples }) {
	return (
		<div>
			<p>Hello from Deno, powered by Vercel!</p>
			<div>
				<h3>Examples:</h3>
				<ul>
					{examples.map((example) => (
						<li key={example}>
							<Link href={`/api/${basename(example, extname(example))}`}>
								<a>{example}</a>
							</Link>
							{' '}
							(
								<Link href={`https://github.com/vercel-community/deno/blob/${sha}/api/${example}`}>
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
