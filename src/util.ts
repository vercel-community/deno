import { URL } from 'url';

export function isURL(v: string) {
	try {
		new URL(v);
		return true;
	} catch {
		return false;
	}
}
