import * as base64 from 'https://deno.land/x/base64/mod.ts';
import { TextProtoReader } from 'https://deno.land/std@0.95.0/textproto/mod.ts';
import { BufReader, BufWriter } from 'https://deno.land/std@0.95.0/io/bufio.ts';
import {
	ServerRequest,
	Response,
} from 'https://deno.land/std@0.95.0/http/server.ts';
import { Context } from 'https://denopkg.com/DefinitelyTyped/DefinitelyTyped/types/aws-lambda/handler.d.ts';

type Handler = (req: ServerRequest) => Promise<Response | void>;

const RUNTIME_PATH = '2018-06-01/runtime';

const {
	AWS_LAMBDA_FUNCTION_NAME,
	AWS_LAMBDA_FUNCTION_VERSION,
	AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
	AWS_LAMBDA_LOG_GROUP_NAME,
	AWS_LAMBDA_LOG_STREAM_NAME,
	LAMBDA_TASK_ROOT,
	_HANDLER,
	AWS_LAMBDA_RUNTIME_API,
} = Deno.env.toObject();

Deno.env.delete('SHLVL');

async function start(): Promise<void> {
	try {
		await processEvents();
	} catch (err) {
		console.error(err);
		Deno.exit(1);
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
			const input = new Deno.Buffer(base64.toUint8Array(data.body || ''));
			const output = new Deno.Buffer(new Uint8Array(6000000)); // 6 MB

			const req = new ServerRequest();
			// req.conn
			req.r = new BufReader(input, input.length);
			req.method = data.method;
			req.url = data.path;
			req.proto = 'HTTP/1.1';
			req.protoMinor = 1;
			req.protoMajor = 1;
			req.headers = new Headers();
			for (const [name, value] of Object.entries(data.headers)) {
				if (typeof value === 'string') {
					req.headers.set(name, value);
				}
				// TODO: handle multi-headers?
			}
			req.w = new BufWriter(output);

			// Run user code
			const res = await handler(req);
			if (res) {
				req.respond(res);
			}

			const responseError = await req.done;
			if (responseError) {
				throw responseError;
			}

			const bufr = new BufReader(output, output.length);
			const tp = new TextProtoReader(bufr);
			const firstLine = await tp.readLine(); // e.g. "HTTP/1.1 200 OK"
			if (firstLine === null) throw new Deno.errors.UnexpectedEof();

			const headers = await tp.readMIMEHeader();
			if (headers === null) throw new Deno.errors.UnexpectedEof();

			const headersObj: { [name: string]: string } = {};
			for (const [name, value] of headers.entries()) {
				headersObj[name] = value;
			}

			const body = await bufr.readFull(new Uint8Array(bufr.buffered()));
			if (!body) throw new Deno.errors.UnexpectedEof();

			await req.finalize();

			result = {
				statusCode: parseInt(firstLine.split(' ', 2)[1], 10),
				headers: headersObj,
				encoding: 'base64',
				body: base64.fromUint8Array(body),
			};
		} catch (e) {
			console.error('Invoke Error:', e);
			await invokeError(e, context);
			continue;
		}
		await invokeResponse(result, context);
	}
}

async function initError(err: Error) {
	return postError('init/error', err);
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

start().catch((err) => {
	console.error(err);
	Deno.exit(1);
});
