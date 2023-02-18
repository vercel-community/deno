import { glob, PrepareCache } from '@vercel/build-utils';

export const prepareCache: PrepareCache = async ({ workPath }) => {
	return await glob('.vercel/cache/deno/**', workPath);
};
