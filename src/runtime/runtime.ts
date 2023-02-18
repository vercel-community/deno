import * as base64 from 'https://deno.land/std@0.177.0/encoding/base64.ts';

export interface VercelRequestPayload {
	method: string;
	path: string;
	headers: Record<string, string>;
	body: string;
}

export interface VercelResponsePayload {
	statusCode: number;
	headers: Record<string, string>;
	encoding: 'base64';
	body: string;
}

export type Handler = (request: Request) => Response | Promise<Response>;

const RUNTIME_PATH = '2018-06-01/runtime';

const { _HANDLER, ENTRYPOINT, AWS_LAMBDA_RUNTIME_API } = Deno.env.toObject();

Deno.env.delete('SHLVL');

function fromVercelRequest(payload: VercelRequestPayload): Request {
	const headers = new Headers(payload.headers);
	const base = `${headers.get('x-forwarded-proto')}://${headers.get(
		'x-forwarded-host'
	)}`;
	const url = new URL(payload.path, base);
	return new Request(url.href, {
		headers,
		method: payload.method,
		body: base64.decode(payload.body || ''),
	});
}

async function toVercelResponse(res: Response): Promise<VercelResponsePayload> {
	let body = '';
	const bodyBuffer = await res.arrayBuffer();
	if (bodyBuffer.byteLength > 0) {
		const bytes = new Uint8Array(bodyBuffer);
		body = base64.encode(bytes);
	}

	return {
		statusCode: res.status,
		headers: Object.fromEntries(res.headers),
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

			// Run user code
			const res = await handler(req);
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
