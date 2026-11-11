# Curated fi-7160 Cards presets

`MTG-Cards-7160-v1.pav` contains only `MTG Cards 600 DPI` and
`MTG Cards 300 DPI`. SHA-256:
`e0d1ab56ccce8c4b8531da433a41e9b469c08462dea71d2f24864f8b03da781c`
(54,123 bytes). These are project configuration data, not a manufacturer driver
or a claim of an official profile-generation API.

Both derive from Brian's accepted fi-7160 Cards 600 DPI baseline, exported by
PaperStream IP 3.40.2. The 300 preset changes only both occurrences of standard
ICAP_XRESOLUTION/ICAP_YRESOLUTION, from 600 to 300. The scanner model remains
fi-7160 in both. The sole nonempty string capability, 41112 (a machine-specific
Documents path), is cleared in both. No unknown capture capability is guessed,
deleted or changed. The source private archive is deliberately not distributed.

The native container's entry lengths were updated for those explicit XML edits;
entry descriptors, version records, allocation data and footer were preserved.
The public bundle has two capability XMLs, numeric Id.bin allocation metadata,
and a SettingInfo.ini naming just these two profiles. It has no document samples,
thumbnails, automatic-selection data, personal paths or credentials.

On November 11, 2026 the installed manufacturer's 3.40.2 TWAIN importer accepted
this exact bundle using **Add profiles**, without a connected scanner. It assigned
new IDs 000006/000007, retained all original profile XMLs byte for byte, and read
back the fi-7160 model, four 600/300 resolution values and empty string metadata.
Only the allocation/name indexes changed. This establishes native import on the
existing installation, not fresh-host or connected-helper acceptance.

`Fi7160Profiles` verifies the complete embedded hash, bounded native entries and
the installed profile capability contents. It never writes the live profile
store. Repeat setup skips import when both matching presets exist. The vendor's
import dialog requires **Add profiles**; do not use its destructive default.
The wizard backs up the existing store and verifies preservation after import.
Effective helper configuration is a separate settings-only step under the
actual counted companion identity. No physical 300 DPI comparison is required.
