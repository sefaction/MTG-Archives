# Review build input coverage (#842)

The manifest records the exact bytes of the supported local Docker web build
inputs. It binds middleware and root declarations, Prisma and ESLint settings,
Docker context exclusions, and the test/tool trees included by TypeScript, in
addition to the existing application, asset, dependency-lock and build roots.
The explicit roots remain an allowlist. A regression checks the current
TypeScript source set and audited build configuration against that allowlist so
new uncovered inputs fail visibly.

`Dockerfile` copies the context into the builder, verifies the bundled scanner
release, writes this manifest, generates Prisma and runs Next plus the client
manifest verifier. `tsconfig.json` includes root declarations and every TS/TSX
file, including tests and tools. `prisma.config.ts` selects the schema; ESLint
settings participate in Next's build validation. The scanner installer payload,
when injected by CI, is bound by the existing `scanner-installer` root. Tool
support files are conservatively bound along with tool TypeScript inputs.

Native scanner `bin`/`obj` output and recursive Python caches/`.pyc` files are
ignored just as they are in `.dockerignore`; they do not enter Docker's builder.
Keep those exclusions synchronized if the Docker context policy changes.
Root private/environment, Git, dependency and generated-output trees remain
outside the allowlist. Included environment files and symlinks are refused.
File paths are sorted deterministically; hashes preserve raw bytes, including
line endings. Manifest schema version 1 and its verifier remain compatible.

## Qualification and limits

The focused suite covers individual middleware/declaration/configuration/tool
mutations and removals, actual current TypeScript/configuration coverage,
creation-order independence, exact line-ending identity, environment/private
exclusions, nested Docker artifact exclusions and symlink rejection. The tests
fail against the original main implementation and pass with the repair. Windows
uses a directory junction for the symlink guard; Linux additionally checks a file
symlink.

The same source function and a separately TypeScript-compiled CommonJS manifest
writer produce exactly equal manifests on the host. This verifies the manifest
writer, not a complete Next/Linux image build. Exact run counts, hashes, failures
and remaining gates are recorded in `WORK_CHECKPOINT.md` and private delivery
evidence, not inferred from this design description.

A source digest is not a compiled-output digest or runtime identity. It does not
bind the resolved base-image identity, runtime environment, database contents,
native models, independent scanner image or deployed service state. Generated
Next/Prisma output is produced after manifest capture; it requires separate
compiled-output/image verification. Local CRLF bytes and Docker/Linux LF bytes
may have different honest digests. This change does not reconstruct historical
builds or establish source drift, release invalidity, deployment or acceptance.
Broader release evidence remains under #310.
