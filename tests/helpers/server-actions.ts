import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

/** Execute the actual server module with request/runtime boundaries supplied by
 * the test. All other dependencies (including the write fence) are unchanged. */
export function loadServerActions(path: string, dependencies: Record<string, unknown>) {
  const filename = resolve(path);
  const require = createRequire(filename);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  const module = { exports: {} as Record<string, (fd: FormData) => Promise<void>> };
  const load = (name: string) => name in dependencies ? dependencies[name]
    : require(name.startsWith("@/") ? resolve(name.slice(2)) : name);
  new Function("require", "module", "exports", compiled.outputText)(load, module, module.exports);
  return module.exports;
}
