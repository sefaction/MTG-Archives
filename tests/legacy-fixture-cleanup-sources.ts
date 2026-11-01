import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {cleanupCorrectionFixture} from "./ui/correction-fixture";
import {cleanupOwnedPhotoFixtureFiles,cleanupOwnedScannerStartFiles,cleanupOwnedScannerStateFiles} from "./ui/owned-fixture-files";

// Finite remaining file phases from the original #692/PR700 audit. The separately
// delivered native, counted/storage/series and photo-intake fixes stay excluded.
export const legacyFixtureFiles = [
  "acquisition-draft-status", "acquisition-footer-identifiers", "acquisition-large-batch",
  "acquisition-library-batch", "acquisition-live-recovery", "acquisition-photo-text-streaming",
  "acquisition-photo-text", "acquisition-printing", "acquisition-processing-recovery",
  "acquisition-quick-finish", "acquisition-review-navigation", "acquisition-scan-retention",
  "acquisition-scanner-background", "acquisition-scanner-crop", "acquisition-scanner-framing",
  "acquisition-scroll-targets", "acquisition-stamp-expectations", "acquisition-stamp-visibility",
  "acquisition-successive-batches", "acquisition-upload-recovery", "scanner-native-authorization",
  "scanner-preflight", "scanner-rejected-start", "scanner-start-replay",
] as const;

export const reviewFixtureFiles = [
  "acquisition-capacity-handoff", "acquisition-correction-focus", "acquisition-save-focus",
] as const;

export function loadReviewFixtureCleanups(root = process.cwd()) {
  return loadLegacyFixtureCleanups(root, reviewFixtureFiles);
}

export function loadLegacyFixtureCleanups(root = process.cwd(), files: readonly string[] = legacyFixtureFiles) {
  return files.flatMap(name => {
    const file = `tests/ui/${name}.spec.ts`;
    const source = ts.createSourceFile(file,readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true);
    const expressions: string[] = [];
    function visit(node: ts.Node) {
      if(ts.isCallExpression(node) && ["database","db"].includes(node.expression.getText(source))) {
        const expression = node.arguments[0]?.getText(source);
        if(expression && (expression.includes("cleanupOwned") || expression.includes("fs.unlink("))) expressions.push(expression);
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
    assert.equal(expressions.length,name === "scanner-rejected-start" ? 2 : 1,`${file}: exact file phase count`);
    return expressions.map((expression,index) => ({
      file,index,kind:name.startsWith("acquisition-") ? "photo" as const : "scanner" as const,
      suffixes:name.startsWith("acquisition-") ? [".original",".preview.jpg"] : name === "scanner-rejected-start" ? [".start.json",".retired.json"] : [".start.json"],
      script(owner: string,requestKeys: readonly string[] = []) {
        const printing={id:owner+"-printing"};
        return new Function("tag","cleanupCorrectionFixture","printing","scope","original","alternative","printings","requests","cleanupOwnedPhotoFixtureFiles","cleanupOwnedScannerStartFiles","cleanupOwnedScannerStateFiles","owner","return ("+expression+");")(
          owner,cleanupCorrectionFixture,printing,`run:{session:{createdByUserId:${JSON.stringify(owner)}}}`,
          {id:owner+"-original"},{id:owner+"-alternative"},[printing],requestKeys.map(requestKey=>({requestKey})),
          cleanupOwnedPhotoFixtureFiles,cleanupOwnedScannerStartFiles,cleanupOwnedScannerStateFiles,{tag:owner},
        ) as string;
      },
    }));
  });
}
