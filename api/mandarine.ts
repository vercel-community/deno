// myFile.ts

import {
	MandarineCore,
	Controller,
	GET,
} from 'https://deno.land/x/mandarinets@master/mod.ts';

@Controller()
export class MyController {
	@GET('/api/mandarine/')
	public httpHandler() {
		return 'Welcome to MandarineTS Framework!';
	}

	@GET('/api/mandarine')
	public httpHandler2() {
		return 'Welcome to MandarineTS Framework!';
	}
}

let deploymentContext = new MandarineCore().MVC();
export default deploymentContext.handle;
