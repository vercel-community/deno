import * as base64 from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import type {
	Handler,
	ConnInfo,
} from 'https://deno.land/std@0.177.0/http/server.ts';

interface VercelRequestPayload {
	method: string;
	path: string;
	headers: Record<string, string>;
	body: string;
}

type VercelResponseHeaders = Record<string, string | string[]>;

interface VercelResponsePayload {
	statusCode: number;
	headers: VercelResponseHeaders;
	encoding: 'base64';
	body: string;
}

const RUNTIME_PATH = '2018-06-01/runtime';

const { _HANDLER, ENTRYPOINT, AWS_LAMBDA_RUNTIME_API } = Deno.env.toObject();

Deno.env.delete('SHLVL');

function fromVercelRequest(payload: VercelRequestPayload): Request {
	const headers = new Headers(payload.headers);
	const base = `${headers.get('x-forwarded-proto')}://${headers.get(
		'x-forwarded-host'
	)}`;
	const url = new URL(payload.path, base);
	const body = payload.body ? base64.decode(payload.body) : undefined;
	return new Request(url.href, {
		method: payload.method,
		headers,
		body,
	});
}

function headersToVercelHeaders(headers: Headers): VercelResponseHeaders {
	const h: VercelResponseHeaders = {};
	for (const [name, value] of headers) {
		const cur = h[name];
		if (typeof cur === 'string') {
			h[name] = [cur, value];
		} else if (Array.isArray(cur)) {
			cur.push(value);
		} else {
			h[name] = value;
		}
	}
	return h;
}

async function toVercelResponse(res: Response): Promise<VercelResponsePayload> {
	let body = '';
	const bodyBuffer = await res.arrayBuffer();
	if (bodyBuffer.byteLength > 0) {
		body = base64.encode(bodyBuffer);
	}

	return {
		statusCode: res.status,
		headers: headersToVercelHeaders(res.headers),
		encoding: 'base64',
		body,
	};
}

async function processEvents(): Promise<void> {
	let handler: Handler | null = null;

	while (true) {
		const { event, awsRequestId } = await nextInvocation();
		let result: VercelResponsePayload;
		try {
			if (!handler) {
				const mod = await import(`./${_HANDLER}`);
				handler = mod.default;
				if (typeof handler !== 'function') {
					throw new Error('Failed to load handler function');
				}
			}

			const payload = JSON.parse(event.body) as VercelRequestPayload;
			const req = fromVercelRequest(payload);

			const connInfo: ConnInfo = {
				// TODO: how to properly calculate these?
				// @ts-ignore - `rid` is not on the `ConnInfo` interface, but it's required by Oak
				rid: 0,
				localAddr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' },
				remoteAddr: {
					hostname: '127.0.0.1',
					port: 0,
					transport: 'tcp',
				},
			};

			// Run user code
			const res = await handler(req, connInfo);
			result = await toVercelResponse(res);
		} catch (e: unknown) {
			const err = e instanceof Error ? e : new Error(String(e));
			console.error(err);
			await invokeError(err, awsRequestId);
			continue;
		}
		await invokeResponse(result, awsRequestId);
	}
}

async function nextInvocation() {
	const res = await request('invocation/next');

	if (res.status !== 200) {
		throw new Error(
			`Unexpected "/invocation/next" response: ${JSON.stringify(res)}`
		);
	}

	const traceId = res.headers.get('lambda-runtime-trace-id');
	if (typeof traceId === 'string') {
		Deno.env.set('_X_AMZN_TRACE_ID', traceId);
	} else {
		Deno.env.delete('_X_AMZN_TRACE_ID');
	}

	const awsRequestId = res.headers.get('lambda-runtime-aws-request-id');
	if (typeof awsRequestId !== 'string') {
		throw new Error(
			'Did not receive "lambda-runtime-aws-request-id" header'
		);
	}

	const event = JSON.parse(res.body);
	return { event, awsRequestId };
}

async function invokeResponse(
	result: VercelResponsePayload,
	awsRequestId: string
) {
	const res = await request(`invocation/${awsRequestId}/response`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(result),
	});
	if (res.status !== 202) {
		throw new Error(
			`Unexpected "/invocation/response" response: ${JSON.stringify(res)}`
		);
	}
}

function invokeError(err: Error, awsRequestId: string) {
	return postError(`invocation/${awsRequestId}/error`, err);
}

async function postError(path: string, err: Error): Promise<void> {
	const lambdaErr = toLambdaErr(err);
	const res = await request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Lambda-Runtime-Function-Error-Type': 'Unhandled',
		},
		body: JSON.stringify(lambdaErr),
	});
	if (res.status !== 202) {
		throw new Error(
			`Unexpected "${path}" response: ${JSON.stringify(res)}`
		);
	}
}

async function request(path: string, options?: RequestInit) {
	const url = `http://${AWS_LAMBDA_RUNTIME_API}/${RUNTIME_PATH}/${path}`;
	const res = await fetch(url, options);
	const body = await res.text();
	return {
		status: res.status,
		headers: res.headers,
		body,
	};
}

function toLambdaErr({ name, message, stack }: Error) {
	return {
		errorType: name,
		errorMessage: message,
		stackTrace: (stack || '').split('\n').slice(1),
	};
}

if (_HANDLER) {
	// Runtime - execute the runtime loop
	processEvents().catch((err) => {
		console.error(err);
		Deno.exit(1);
	});
} else {
	// Build - import the entrypoint so that it gets cached
	await import(ENTRYPOINT);
}
