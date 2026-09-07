// eslint-disable-next-line @typescript-eslint/no-require-imports -- Webpack loader is a CommonJS entry point.
const ts = require('typescript');
module.exports = function(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: this.resourcePath }).outputText;
};
