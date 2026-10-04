# Recognition native cache isolation

The supervised website scanner test retained two original fronts, but both OCR jobs failed three times. Read-only replay exposed a permissions failure in Paddle's temporary cache: root Prisma caches had created the same HOME used by the restricted native child.

The recognition image now gives the application `/tmp/mtg-acquisition-worker` and initializes `/tmp/mtg-acquisition-native` for uid/gid65534 with mode700. Native privilege separation, model verification, read-only photos, job publication fences and human review remain intact. No automatic card acceptance or Inventory change is introduced.

## Validation — October 3, 2026

- The real Linux regression first failed on the previous image with PermissionError, then passed with the repaired cache ownership/home separation. It exercises root application-cache creation followed by a restricted Python scratch write.
- The complete recognition Docker recipe built and passed that regression. The five native environment/protocol tests and TypeScript check passed.
- Local review uses a cache-only layer over the exact prior runtime image `e12539cdb58b12402de639d5f1d6335b26b1011ca3e66513fc763a35619fb35a`, preserving installed native dependencies and model generation. Its image is `35993b1ceeeeda5732139e204834592a6e42d0e42903a68a4424bacdc331a32b`. It separates HOME and transfers ownership of only the existing disposable native scratch directory. The rebuilt complete recipe is separately validated; this avoids an unrelated native dependency/model-version refresh in the ongoing scanner test.
- Only the local recognition worker was replaced. Its model descriptor remains `7284e774f0c60a590b5e01ec77005fff755e0f17335cbd3f3c2ead80693f64cd`. Website, canonical, visual, printing, catalog and reference-maintenance container identities were conserved.
- Read-only replay of the retained first scan succeeded. Exactly the two failed qualification jobs were then retried, under immutable photo, revision, unreviewed/uncommitted candidate and exact local batch guards. Both completed on their first attempt and published review suggestions: Merchant of Secrets (LGN44 first) and Marauding Blight-Priest (ZNR112 first). These are suggestions requiring review, not automatic exact-printing acceptance.
- Actual browser review displays the recovered first suggestion and printing evidence. Inventory remains10280 rows/12482 copies, full-row hash `742d2fa870de453d80f151c6368e4f82`.

The separate website two-card physical observation remains pending. No additional scanner acquisition was initiated during this repair. Section progression, refill and larger logical-batch hardware qualification remain unfinished. Existing failures and original photos are retained. No production deployment or PR merge occurred.

Related: [issue618](https://github.com/sefaction/MTG-Archives/issues/618), stacked on [PR617](https://github.com/sefaction/MTG-Archives/pull/617). Temporary diagnostics and exact local review layers are retained in the checkpoint and ignored local evidence.

Run the regression inside the recognition image:

```sh
docker run --rm --network none --entrypoint node IMAGE node_modules/tsx/dist/cli.mjs scripts/verify-acquisition-native-cache.ts
```