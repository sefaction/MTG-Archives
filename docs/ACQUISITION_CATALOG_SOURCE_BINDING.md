# Catalogue import source binding

Catalogue inspection and import now parse a private compressed snapshot whose
byte count and SHA-256 match the declared source before any record is yielded.
The parser reads the same open descriptor used to capture those bytes.

Independent checks of the original path could previously both see source A,
while the parser consumed source B between them. With bounded batches, those
unverified rows could already have advanced the durable import cursor.
The importer now supplies the inspected source identity to the reader, so a
different source is rejected before it can enter a committed batch.

Expanded JSONL remains streamed. The compressed snapshot uses at most the
existing 1 GiB source limit in temporary disk space, with bounded copy buffers.
The descriptor, temporary file and directory are retired on completion, early
consumer return and parsing failure. Capture/parsing and cleanup failures retain
their separate causes. The original source file is preserved.

The regression uses two valid same-size gzip files, restores the original path
after the old reader yields a changed record, and verifies both independent
path checks agree. The old reader fails this control; the bound reader rejects
the changed source before yielding any record. Existing UTF-8, duplicate,
truncation and expanded-line controls remain.

Bulk-derived offline printing-family coverage remains separate work under the
existing #307/#310 requirements.
