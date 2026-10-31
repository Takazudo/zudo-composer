//#region src/content/editorial/types.ts
var EditorialError = class extends Error {
	code;
	diagnostics;
	name = "EditorialError";
	constructor(code, message, diagnostics = []) {
		super(message);
		this.code = code;
		this.diagnostics = diagnostics;
	}
};
//#endregion
export { EditorialError as t };
