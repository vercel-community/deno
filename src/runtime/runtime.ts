import * as base64 from 'https://deno.land/x/base64@v0.2.1/mod.ts';
import * as stdHttpServer from 'https://deno.land/std@0.105.0/http/server.ts';
import { TextProtoReader } from 'https://deno.land/std@0.105.0/textproto/mod.ts';
import {
	BufReader,
	BufWriter,
} from 'https://deno.land/std@0.105.0/io/bufio.ts';
import { readerFromStreamReader } from 'https://deno.land/std@0.105.0/io/streams.ts';
import { Context } from 'https://denopkg.com/DefinitelyTyped/DefinitelyTyped/types/aws-lambda/handler.d.ts';

export interface HeadersObj {
	[name: string]: string;
}

export interface RequestEvent {
	readonly request: Request;
	respondWith(r: Response | Promise<Response>): Promise<void>;
}

export interface VercelRequestPayload {
	method: string;
	path: string;
	headers: HeadersObj;
	body: string;
}

export interface VercelResponsePayload {
	statusCode: number;
	headers: HeadersObj;
	encoding: 'base64';
	body: string;
}

export type StdHandler = (
	req: stdHttpServer.ServerRequest
) => Promise<stdHttpServer.Response | void>;
export type NativeHandler = (event: RequestEvent) => Promise<Response | void>;
export type Handler = StdHandler | NativeHandler;

const RUNTIME_PATH = '2018-06-01/runtime';

const {
	AWS_LAMBDA_FUNCTION_NAME,
	AWS_LAMBDA_FUNCTION_VERSION,
	AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
	AWS_LAMBDA_LOG_GROUP_NAME,
	AWS_LAMBDA_LOG_STREAM_NAME,
	_HANDLER,
	ENTRYPOINT,
	AWS_LAMBDA_RUNTIME_API,
} = Deno.env.toObject();

Deno.env.delete('SHLVL');

function headersToObject(headers: Headers): HeadersObj {
	const obj: HeadersObj = {};
	for (const [name, value] of headers.entries()) {
		obj[name] = value;
	}
	return obj;
}

class Deferred<T> {
	promise: Promise<T>;
	resolve!: (v: T) => void;
	reject!: (v: any) => void;

	constructor() {
		this.promise = new Promise<T>((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

class VercelRequest
	extends stdHttpServer.ServerRequest
	implements RequestEvent {
	readonly request: Request;
	#response: Deferred<Response>;
	#output: Deno.Buffer;

	constructor(data: VercelRequestPayload) {
		super();

		this.#response = new Deferred();

		// Request headers
		const headers = new Headers();
		for (const [name, value] of Object.entries(data.headers)) {
			if (typeof value === 'string') {
				headers.set(name, value);
			}
			// TODO: handle multi-headers?
		}

		const base = `${headers.get('x-forwarded-proto')}://${headers.get(
			'x-forwarded-host'
		)}`;
		const url = new URL(data.path, base);

		// Native HTTP server interface
		this.request = new Request(url.href, {
			headers,
			method: data.method,
		});

		// Legacy `std` HTTP server interface
		const input = new Deno.Buffer(base64.toUint8Array(data.body || ''));
		this.#output = new Deno.Buffer(new Uint8Array(6000000)); // 6 MB

		// req.conn
		this.r = new BufReader(input, input.length);
		this.method = data.method;
		this.url = data.path;
		this.proto = 'HTTP/1.1';
		this.protoMinor = 1;
		this.protoMajor = 1;
		this.headers = headers;
		this.w = new BufWriter(this.#output);
	}

	respondWith = async (r: Response | Promise<Response>): Promise<void> => {
		const response = await r;
		this.#response.resolve(response);
	};

	async waitForStdResponse(): Promise<VercelResponsePayload> {
		const responseError = await this.done;
		if (responseError) {
			throw responseError;
		}

		const bufr = new BufReader(this.#output, this.#output.length);
		const tp = new TextProtoReader(bufr);
		const firstLine = await tp.readLine(); // e.g. "HTTP/1.1 200 OK"
		if (firstLine === null) throw new Deno.errors.UnexpectedEof();

		const resHeaders = await tp.readMIMEHeader();
		if (resHeaders === null) throw new Deno.errors.UnexpectedEof();

		const body = await bufr.readFull(new Uint8Array(bufr.buffered()));
		if (!body) throw new Deno.errors.UnexpectedEof();

		await this.finalize();

		return {
			statusCode: parseInt(firstLine.split(' ', 2)[1], 10),
			headers: headersToObject(resHeaders),
			encoding: 'base64',
			body: base64.fromUint8Array(body),
		};
	}

	async waitForNativeResponse(): Promise<VercelResponsePayload> {
		const res = await this.#response.promise;

		const reader = res.body?.getReader();
		let body = '';
		if (reader) {
			const bytes = await Deno.readAll(readerFromStreamReader(reader));
			body = base64.fromUint8Array(bytes);
		}

		return {
			statusCode: res.status,
			headers: headersToObject(res.headers),
			encoding: 'base64',
			body,
		};
	}

	waitForResult(): Promise<VercelResponsePayload> {
		return Promise.race([
			this.waitForStdResponse(),
			this.waitForNativeResponse(),
		]);
	}
}

async function processEvents(): Promise<void> {
	let handler: Handler | null = null;

	while (true) {
		const { event, context } = await nextInvocation();
		let result;
		try {
			if (!handler) {
				const mod = await import(`./${_HANDLER}`);
				handler = mod.default;
				if (typeof handler !== 'function') {
					throw new Error('Failed to load handler function');
				}
			}

			const data = JSON.parse(event.body);
			const req = new VercelRequest(data);

			// Run user code
			const res = await handler(req);
			if (res) {
				if (res instanceof Response) {
					req.respondWith(res);
				} else {
					req.respond(res);
				}
			}

			result = await req.waitForResult();
		} catch (e) {
			console.error('Invoke Error:', e);
			await invokeError(e, context);
			continue;
		}
		await invokeResponse(result, context);
	}
}

async function nextInvocation() {
	const res = await request('invocation/next');

	if (res.status !== 200) {
		throw new Error(
			`Unexpected "/invocation/next" response: ${JSON.stringify(res)}`
		);
	}

	const deadlineMs = Number(res.headers.get('lambda-runtime-deadline-ms'));

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

	const invokedFunctionArn = res.headers.get(
		'lambda-runtime-invoked-function-arn'
	);
	if (typeof invokedFunctionArn !== 'string') {
		throw new Error(
			'Did not receive "lambda-runtime-invoked-function-arn" header'
		);
	}

	const context: Context = {
		callbackWaitsForEmptyEventLoop: false,
		logGroupName: AWS_LAMBDA_LOG_GROUP_NAME,
		logStreamName: AWS_LAMBDA_LOG_STREAM_NAME,
		functionName: AWS_LAMBDA_FUNCTION_NAME,
		memoryLimitInMB: AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
		functionVersion: AWS_LAMBDA_FUNCTION_VERSION,
		awsRequestId,
		invokedFunctionArn,
		getRemainingTimeInMillis: () => deadlineMs - Date.now(),
		done: (error?: Error, result?: any): void => {},
		fail: (error: Error | string): void => {},
		succeed: (messageOrObject: any, obj?: any): void => {},
	};

	const clientContext = res.headers.get('lambda-runtime-client-context');
	if (clientContext) {
		context.clientContext = JSON.parse(clientContext);
	}

	const cognitoIdentity = res.headers.get('lambda-runtime-cognito-identity');
	if (cognitoIdentity) {
		context.identity = JSON.parse(cognitoIdentity);
	}

	const event = JSON.parse(res.body);

	return { event, context };
}

async function invokeResponse(result: any, context: Context) {
	const res = await request(`invocation/${context.awsRequestId}/response`, {
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

async function invokeError(err: Error, context: Context) {
	return postError(`invocation/${context.awsRequestId}/error`, err);
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
	await import(`./${ENTRYPOINT}`);
}
