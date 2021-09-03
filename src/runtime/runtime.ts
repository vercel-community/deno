import * as base64 from 'https://deno.land/std@0.106.0/encoding/base64.ts';
import * as stdHttpServer from 'https://deno.land/std@0.106.0/http/server.ts';
import { TextProtoReader } from 'https://deno.land/std@0.106.0/textproto/mod.ts';
import { readerFromStreamReader } from 'https://deno.land/std@0.106.0/io/streams.ts';
import {
	BufReader,
	BufWriter,
} from 'https://deno.land/std@0.106.0/io/bufio.ts';

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
		const input = new Deno.Buffer(base64.decode(data.body || ''));
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
			body: base64.encode(body),
		};
	}

	async waitForNativeResponse(): Promise<VercelResponsePayload> {
		const res = await this.#response.promise;

		const reader = res.body?.getReader();
		let body = '';
		if (reader) {
			const bytes = await Deno.readAll(readerFromStreamReader(reader));
			body = base64.encode(bytes);
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
		const { event, awsRequestId } = await nextInvocation();
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
			await invokeError(e, awsRequestId);
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

async function invokeError(err: Error, awsRequestId: string) {
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
	await import(`./${ENTRYPOINT}`);
}
