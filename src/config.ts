import yn from 'yn';
import { Config, Env } from '@vercel/build-utils';

export function configBool(
	config: Config,
	configName: string,
	env: Env,
	envName: string
): boolean | undefined {
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

export function configString(
	config: Config,
	configName: string,
	env: Env,
	envName: string
): string | undefined {
	const configVal = config[configName];
	if (typeof configVal === 'string') {
		return configVal;
	}

	const envVal = env[envName];
	if (typeof envVal === 'string') {
		return envVal;
	}
}
