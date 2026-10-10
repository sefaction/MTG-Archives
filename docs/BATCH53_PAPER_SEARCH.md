# Paper printing name search

Batch 53 on production could not find Krosan Vorine or Crashing Boars by name.
An actual authorized browser lookup reproduced no results for Crashing Boars.
Explicit PLST / EXO-108 and PLST / LGN-131 searches returned the correct paper
List editions. No review or Inventory addition was saved during diagnosis.

Live Scryfall named requests on October 10, 2026 return digital=true for
Krosan Vorine (VMA 219) and Crashing Boars (TPR 168). The provider previously
returned NOT_FOUND immediately for that first result, without enumerating its
paper editions. Regression coverage reproduces that rejection on unchanged code.

Name lookup now uses a digital first response only as canonical name metadata,
then requires complete, validated paper enumeration. The digital identity is
excluded from returned/imported cards and from the required paper membership
check. Explicit digital printing/ID requests remain unavailable. Digital-only
names remain NOT_FOUND after an empty paper lookup. Failed or invalid enumeration
remains unresolved and cannot establish checked coverage.

Name query keys advance to version 2 to bypass historical false-negative cache
entries immediately. Explicit printing and ID keys remain version 1. Existing
lease, bounded pagination, cooldown, language, exact name/face, duplicate and
advertised-count protections remain active.

Validation: all 13 provider/query tests pass; the three new behavior cases failed
on the unchanged provider. Full verification and cumulative Docker qualification
are pending. Production deployment and individual PR merge approval are separate.
