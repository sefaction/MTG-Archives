# Recognition model and source identity audit — October 5, 2026

This is bounded evidence for the source/version requirement in #307 and the
recognition work in #463. It records the installed public model inputs and their
binding to the active local DINOv2 index. It does not establish recognition
accuracy, independent validation, all-language coverage, reference-art rights,
or completion of either issue.

## Verified local inputs

The [machine-readable report](RECOGNITION_MODEL_SOURCES_20261005.json) contains
public identifiers, counts and hashes only. The audit read the model caches and
small published index manifest; it did not load models, run inference, download
anything, inspect private photographs or access the database.

| Input | Verified identity | Source declaration / limitation |
| --- | --- | --- |
| Paddle English mobile recognizer | `267c36e24c331595590fe7bd72bde2436fd286f2`, all six locked files | Hash-verified pinned model-card frontmatter declares `apache-2.0`. |
| Paddle mobile detector | `0d63e78e2b680928f6b1747d76a08db6e645efb7`, all six locked files | Hash-verified pinned model-card frontmatter declares `apache-2.0`; also checked on the official pinned card. |
| DINOv2 ViT-S/14 backbone | Official source `7764ea0f912e53c92e82eb78a2a1631e92725fc8`; 155 Python files; clean source/card/license checkout; exact cached weights | The pinned official README declares Apache 2.0 for DINOv2 code and model weights. This declaration applies to this DINOv2 backbone, not every other model family now mentioned by that repository. |
| VGG16 diagnostic encoder | Exact cached weights, 553,433,881 bytes | Torchvision v0.23.0 code has BSD 3-Clause terms. This audit did not establish a separate rights declaration for this exact weight artifact. The active index uses DINOv2. |

Official sources: [recognizer pinned card](https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec/blob/267c36e24c331595590fe7bd72bde2436fd286f2/README.md),
[detector pinned card](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det/blob/0d63e78e2b680928f6b1747d76a08db6e645efb7/README.md),
[DINOv2 pinned README](https://github.com/facebookresearch/dinov2/blob/7764ea0f912e53c92e82eb78a2a1631e92725fc8/README.md),
[official DINOv2 weight artifact](https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth),
[Torchvision v0.23.0 license](https://github.com/pytorch/vision/blob/v0.23.0/LICENSE).
The recognizer's upstream card fetch was unavailable in this session; its
declaration above comes from the cached README whose bytes match the committed
lock, not a claimed successful upstream fetch.

The OCR lock SHA-256 is
`ec23fa20628be45a6feba72e1a41c50a2e4721ed50aea358ebaba696e88c436d`;
canonical cache version is
`337c07ee8aef37bd550fe5978df26ad8bd31d8b9fffbdc3b05536b26f35ba5dd`.
Cached DINOv2 weights SHA-256 is
`b938bf1bc15cd2ec0feacfe3a1bb553fe8ea9ca46a7e1d8d00217f29aef60cd9`;
Python source fingerprint is
`c08a6d75280bafd0c32456f8b3e4044ae833c90384bd34545cc9ceeff58e3777`.
The report also records VGG16, README and LICENSE hashes.

The active manifest SHA-256 is
`ff2c4acf94273d5b76db0d7c37cac73006a936064f077f3444c1cb58ac3f7c63`.
It records 112,656 reference faces and `downloadComplete: true`. Its encoder
source, DINOv2 source and weight digests exactly match the audited inputs.
This check does not rehash the reference images or vector matrix, qualify
unavailable reference faces, or expand the frozen default-card snapshot to all
languages/newer printings. See [catalog evaluation](ACQUISITION_FULL_CATALOG_EVALUATION.md)
for the separate preparation, coverage and runtime integrity contracts.

## Reproduction and negative controls

Run the standard-library auditor with caller-selected existing cache paths:

```text
python tools/acquisition-eval/audit_model_sources.py --ocr-cache OCR_CACHE --visual-models VISUAL_MODELS --index INDEX_JSON --expected-dinov2-revision 7764ea0f912e53c92e82eb78a2a1631e92725fc8 --output REPORT_JSON
```

Without `--output`, it prints the report. It fails on changed locked OCR bytes,
model weights, missing source, changed index encoder bindings, incomplete
downloads, or a dirty source/card/license checkout when Git metadata exists.
Without Git metadata, source hashes remain checked, but revision/clean status
are null; the explicit expected-revision argument requires that metadata.
Git optional writes are disabled. Output inside a model cache or over the
selected index, encoder source or OCR lock is refused.

Final local qualification passed against the actual caches, repeated after the
October 6 interruption with the same model/source/index identities. A separately copied
OCR cache with a same-length change to the recognizer card's license declaration
failed on its SHA-256, both normally and under Python `-O`, with no report
published. A copied index with a changed source binding failed as well. An
attempt to select the existing index as report output also failed.
All 12 original OCR files still matched the lock afterwards. These are audit
integrity controls, not inference or physical-card accuracy tests.

## Remaining gates and maintenance

Public accessibility and model/software declarations do not establish reference
image/dataset rights. That separate #307 requirement remains unqualified here,
as do the VGG16 weight declaration and release approval. No Scryfall policy was
newly qualified: the official API/bulk documentation fetches were unavailable.

Rerun this audit when model locks, weights, source revisions, encoder code or
the selected index change. Preserve the previous report alongside the new one.
Do not rewrite a report to imply an old result used new inputs. Existing worker
generation and index compatibility guards still apply; this diagnostic does not
replace them. No lock, weights, references, worker policy, index or service was
changed by this batch, and neither #307 nor #463 should close from this evidence.
