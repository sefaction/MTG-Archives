"""Read a .NET single-file worker's inventory without executing it or extracting code.

Format: dotnet/runtime Microsoft.NET.HostModel/Bundle, manifest versions 2/6.
Only bounded deps/runtimeconfig JSON is decoded. No filesystem paths from the
executable are used as output paths. Output contains no local absolute paths.
"""
import argparse
import hashlib
import io
import json
import struct
import zlib
from pathlib import Path

SIGNATURE = bytes.fromhex("8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae")
MAX_JSON = 8 * 1024 * 1024


def inspect(path):
    blob = path.read_bytes()
    marker = blob.find(SIGNATURE)
    if marker < 8 or blob.find(SIGNATURE, marker + 1) >= 0:
        raise ValueError("Missing or ambiguous .NET bundle marker")
    header = struct.unpack_from("<q", blob, marker - 8)[0]
    if not 0 < header < len(blob) - 12:
        raise ValueError("Invalid bundle header offset")
    stream = io.BytesIO(blob)
    stream.seek(header)

    def read(count):
        data = stream.read(count)
        if len(data) != count:
            raise ValueError("Truncated bundle manifest")
        return data

    def string():
        length = 0
        for shift in range(0, 35, 7):
            byte = read(1)[0]
            length |= (byte & 127) << shift
            if byte < 128:
                if length > 4096:
                    raise ValueError("Oversized bundle string")
                return read(length).decode("utf-8")
        raise ValueError("Invalid bundle string length")

    major, minor, count = struct.unpack("<IIi", read(12))
    if major not in (2, 6) or not 1 <= count <= 10000:
        raise ValueError("Unsupported bundle format or file count")
    string()  # build identifier
    read(40)  # deps/runtimeconfig offsets and sizes, flags
    documents = {}
    for _ in range(count):
        offset, size = struct.unpack("<qq", read(16))
        compressed = struct.unpack("<q", read(8))[0] if major >= 6 else 0
        read(1)  # file type
        name = string()
        length = compressed or size
        if min(offset, size, compressed) < 0 or offset + length > len(blob):
            raise ValueError("Bundle entry outside executable")
        if name not in ("NAPS2.Worker.deps.json", "NAPS2.Worker.runtimeconfig.json"):
            continue
        if name in documents or size > MAX_JSON or length > MAX_JSON:
            raise ValueError("Duplicate or oversized worker metadata")
        data = blob[offset:offset + length]
        if compressed:
            decoder = zlib.decompressobj(-15)
            data = decoder.decompress(data, MAX_JSON + 1)
            if not decoder.eof or decoder.unconsumed_tail or decoder.unused_data:
                raise ValueError("Invalid or oversized compressed metadata")
        if len(data) != size:
            raise ValueError("Worker metadata size mismatch")
        documents[name] = json.loads(data)
    if len(documents) != 2:
        raise ValueError("Worker dependency or runtime configuration is missing")
    return {
        "file": "NAPS2.Worker.exe", "sha256": hashlib.sha256(blob).hexdigest(),
        "bundleFormat": f"{major}.{minor}", "bundledFileCount": count,
        "runtimeOptions": documents["NAPS2.Worker.runtimeconfig.json"]["runtimeOptions"],
        "libraries": documents["NAPS2.Worker.deps.json"]["libraries"],
        "scope": "Declared bundle dependencies; not proof every optional native DLL was loaded",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worker", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = inspect(args.worker)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Worker inventory: {len(result['libraries'])} declared libraries; {result['bundledFileCount']} bundled files")
