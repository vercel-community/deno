import {
	MandarineCore,
	Controller,
	GET,
} from 'https://deno.land/x/mandarinets@v1.3.0/mod.ts';

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
