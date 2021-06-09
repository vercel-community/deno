#!/usr/bin/env deno run --config tsconfig.json --include-files myjson.json
import {
	MandarineCore,
	Controller,
	GET,
} from 'https://deno.land/x/mandarinets@v2.2.1/mod.ts';

@Controller()
export class MyController {
	public getFileMessage(): string {
		return JSON.parse(
			new TextDecoder().decode(Deno.readFileSync('./api/myjson.json'))
		).message;
	}

	@GET('/api/mandarine')
	public httpHandler() {
		return this.getFileMessage();
	}
}

export default new MandarineCore().MVC().handle;
