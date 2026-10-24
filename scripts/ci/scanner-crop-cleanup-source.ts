import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { cancelAndCleanCorrectionFixture } from "../../tests/ui/correction-fixture";

// Execute the actual browser fixture wrappers without importing Playwright or
// running its optical workflow. Database calls remain explicit caller adapters.
export function scannerCropCleanupSource() {
  const file = ts.createSourceFile("crop", readFileSync("tests/ui/acquisition-scanner-crop.spec.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const helper = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "cleanupScannerOwner");
  const wrappers: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node) && node.body.getText(file).includes("await use(owner)") && node.body.getText(file).includes("cleanupScannerOwner(owner.tag")) wrappers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(helper); assert.equal(wrappers.length, 1);
  const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return {
    cleanup(database: (sql: string) => unknown) {
      return new Function("database", "cancelAndCleanCorrectionFixture", compile(helper.getText(file) + ";return cleanupScannerOwner;"))(database, cancelAndCleanCorrectionFixture) as (tag: string, primaryFailed?: boolean, primaryError?: unknown) => void;
    },
    workflow(cleanup: (tag: string, primaryFailed?: boolean, primaryError?: unknown) => void, uuid: () => string) {
      return new Function("cleanupScannerOwner", "randomUUID", compile("return (" + wrappers[0].getText(file) + ");"))(cleanup, uuid) as (context: object, use: (owner: { tag: string; needsCleanup: boolean }) => Promise<void>) => Promise<void>;
    },
  };
}
