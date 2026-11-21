import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import * as typescript from 'monaco-editor/languages/features/typescript/register.js';
import 'monaco-editor/languages/features/json/register.js';
import 'monaco-editor/languages/features/css/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';

// Bundle every worker on this origin; authoring never depends on a CDN or AMD loader.
globalThis.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css') return new CssWorker();
    if (label === 'javascript' || label === 'typescript') return new TsWorker();
    return new EditorWorker();
  },
};
for (const defaults of [typescript.javascriptDefaults, typescript.typescriptDefaults]) {
  defaults.setCompilerOptions({
    target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext,
    jsx: typescript.JsxEmit.React,
    allowNonTsExtensions: true,
    allowJs: true,
    noEmit: true,
  });
  // Runtime contracts own semantic diagnostics; editor syntax hints are advisory.
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
}

export { monaco };
