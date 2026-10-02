import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Only tracked native Python inputs; models, indexes, photos and application
// state are outside this checkout operation. Validate every change before writing.
export function nativeSourceCheckout(root = process.cwd(), refresh = false) {
  const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const names = git("ls-files", "-z", "--", "tools/acquisition-eval", "tools/acquisition-runtime")
    .toString("utf8").split("\0").filter(name => name.endsWith(".py"));
  if (!names.length) throw new Error("Native source files unavailable in this Git checkout");
  const inputs = names.map(name => {
    const target = path.resolve(root, name);
    if (!name.startsWith("tools/acquisition-eval/") && !name.startsWith("tools/acquisition-runtime/"))
      throw new Error("Native source path outside expected directories");
    if (lstatSync(target).isSymbolicLink()) throw new Error("Native source symlink requires review");
    const original = readFileSync(target);
    const canonical = Buffer.from(original.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    const changed = !original.equals(canonical);
    if (changed && !refresh) throw new Error(`Native source ${name} uses CRLF; run node scripts/verify-native-source.mjs --refresh on a clean/staged checkout`);
    if (changed && !canonical.equals(git("show", `:${name}`)))
      throw new Error(`Preserve unstaged native code edits in ${name} before refreshing its checkout`);
    return { name, target, canonical, changed };
  });
  if (refresh) for (const input of inputs) if (input.changed) writeFileSync(input.target, input.canonical);
  return { files: Object.fromEntries(inputs.map(input => [input.name,
    createHash("sha256").update(input.canonical).digest("hex")])),
    refreshed: inputs.filter(input => input.changed).map(input => input.name) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args[0] && args[0] !== "--refresh")) throw new Error("Only --refresh is supported");
    console.log(JSON.stringify(nativeSourceCheckout(process.cwd(), args[0] === "--refresh"), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}