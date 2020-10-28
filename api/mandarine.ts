import {
	MandarineCore,
	Controller,
	GET,
} from 'https://deno.land/x/mandarinets@v2.1.6/mod.ts';

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
