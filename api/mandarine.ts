// myFile.ts

import {
	MandarineCore,
	Controller,
	GET,
} from 'https://deno.land/x/mandarinets@master/mod.ts';

@Controller()
export class MyController {

	public getFileMessage(): string {
		return JSON.parse(new TextDecoder().decode(Deno.readFileSync('./api/myjson.json'))).message;
	}

	@GET('/api/mandarine/')
	public httpHandler() {
		return this.getFileMessage();
	}

	@GET('/api/mandarine')
	public httpHandler2() {
		return this.getFileMessage();
	}
}

let deploymentContext = new MandarineCore().MVC();
export default deploymentContext.handle;
