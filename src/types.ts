export type Env = typeof process.env;

export interface Graph {
	deps: string[];
	version_hash: string;
}

export interface FileInfo {
	version: string;
	signature: string;
	affectsGlobalScope: boolean;
}

export interface Program {
	fileNames?: string[];
	fileInfos: { [name: string]: FileInfo };
	referencedMap: { [name: string]: string[] };
	exportedModulesMap: { [name: string]: string[] };
	semanticDiagnosticsPerFile?: string[];
}

export interface BuildInfo {
	program: Program;
	version: string;
}
