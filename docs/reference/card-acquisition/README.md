# Card acquisition source archive

These are user-supplied planning inputs, preserved verbatim for future reference:

- [Planning prompt](planning-prompt.md) — scope/invariants and planning-only instruction.
- [Research report](research-report.md) — design suggestions, example code/schema and estimates; **not an implementation specification**.

The report contains opaque citation markers from its originating conversation. Those markers cannot be resolved here and are not evidence of verification. Current accepted design is [the roadmap](../../CARD_ACQUISITION_PLAN.md) and its linked architecture/milestones/validation. User answers in this conversation supersede report suggestions: image release first, mostly English loose cards, typical batches up to 100, Windows USB host with separate server, explicit capacity override allowed, implementation deferred.

No report schema, proposed filename, library, confidence number, estimate, old repository assertion or device-compatibility claim was adopted solely because it appears here. Repository findings were checked at `bfb7be8`; notable differences are documented in the architecture. Preserve private photos/test assets outside this archive.

## Primary-source checks during planning

Checked September 22, 2026 local / September 23 UTC. Revalidate compatibility and dependency versions before their implementation phases.

| Source | Verified point and limitation |
| --- | --- |
| [TWAIN Working Group samples](https://github.com/twain/twain-samples) | Official sample includes a software-only virtual scanner. README describes an older Windows/Qt build environment; installability and capabilities on the intended host remain P10 tests. |
| [TWAIN DSM](https://github.com/twain/twain-dsm) | Native manager between app and data sources; 32/64-bit implementations. Does not by itself prove PaperStream or card boundary support. |
| [Ricoh application bitness FAQ](https://fi-faq.pfu.ricoh.com/hc/en-us/articles/13322763972121-Is-there-the-PaperStream-IP-for-64-bit-Windows) | Driver variant follows application architecture; this does not justify requiring x86 in advance. |
| [PaperStream IP](https://www.pfu.ricoh.com/global/scanners/fi/psip/) | Driver product/reference entry point checked. Current landing-page text did not substantiate the report's exact legacy model/OS support matrix; check the actual download compatibility before P11. |
| [Archived fi-6130Z specifications](https://www.pfu.ricoh.com/global/scanners/fi/discontinued/fi6130z/fi6130z.html) | Duplex, sensor/card handling and consumable information. Archived specifications are not current Windows support or a guarantee of MTG surface safety/bulk feeding. |
| [Scryfall request guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17) | Bulk data recommended for large repetitive lookup workloads. |
| [Scryfall bulk metadata API](https://api.scryfall.com/bulk-data) / [bulk documentation](https://scryfall.com/docs/api/bulk-data) | Documentation fetch returned 403 in browser research. Read-only metadata API succeeded via PowerShell: default_cards covers English/default-language objects, all_cards covers all languages. No bulk payload downloaded. Do not use oracle/unique-art data as exact-printing completeness. |
| [Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) | Orientation/segmentation and input quality affect OCR; candidate technology only. No engine installed or selected. |
| [OpenCV geometric transforms](https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html) | Perspective/geometry primitives available; candidate only, not proof of reliable multi-card detection. |

The report's community projects are optional inspiration, not core dependencies or verified operational guarantees. Primary documentation plus this repository and future measurements govern implementation.
