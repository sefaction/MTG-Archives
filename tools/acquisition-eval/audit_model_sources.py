"""Read-only identity audit of caller-selected local model caches and index.

Uses only the standard library. Does not load models, run inference, download
files, inspect private photos, or access the application database. Licence
declarations are evidence, not a release approval or a grant for reference art.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def contained(root, relative):
    target = (root / relative).resolve()
    require(target.is_relative_to(root.resolve()), "Input path escapes selected cache")
    return target


def audit(repo, ocr_cache, visual_models, index_path, expected_revision=None):
    lock_path = repo / "tools/acquisition-runtime/models.lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    version = hashlib.sha256(json.dumps(
        lock, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    ocr = []
    for model in lock["models"]:
        folder = contained(ocr_cache, f"versions/{version}/official_models/{model['name']}")
        for name, expected in model["files"].items():
            target = contained(folder, name)
            require(target.stat().st_size == expected["bytes"],
                    f"OCR byte count mismatch: {model['name']}/{name}")
            require(digest(target) == expected["sha256"],
                    f"OCR digest mismatch: {model['name']}/{name}")
        card = (folder / "README.md").read_text(encoding="utf-8")
        frontmatter = re.match(r"\A---\s*\n(.*?)\n---(?:\s|$)", card, re.DOTALL)
        require(frontmatter is not None, "OCR model card frontmatter missing")
        declaration = re.search(r"(?mi)^license:\s*([^\r\n]+)", frontmatter.group(1))
        require(declaration is not None, "OCR model card licence declaration missing")
        ocr.append({"name": model["name"], "repository": model["repository"],
                    "revision": model["revision"], "verifiedFiles": len(model["files"]),
                    "cardSha256": model["files"]["README.md"]["sha256"],
                    "declaredLicense": declaration.group(1).strip()})

    encoder_path = repo / "tools/acquisition-eval/image_encoder.py"
    tree = ast.parse(encoder_path.read_text(encoding="utf-8"))
    assignments = [node.value for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "WEIGHTS"
                           for target in node.targets)]
    require(len(assignments) == 1, "Expected one literal encoder weight declaration")
    weights = ast.literal_eval(assignments[0])
    models = []
    for name, (relative, expected) in weights.items():
        target = contained(visual_models, relative)
        actual = digest(target)
        require(actual == expected, f"Visual weight digest mismatch: {name}")
        models.append({"name": name, "weightsSha256": actual, "bytes": target.stat().st_size})

    source = visual_models / "dinov2-source"
    files = sorted((source / "dinov2").rglob("*.py"))
    require(bool(files), "DINOv2 Python source missing")
    source_hash = hashlib.sha256(json.dumps(
        [(file.relative_to(source).as_posix(), digest(file)) for file in files],
        separators=(",", ":")).encode()).hexdigest()
    index = json.loads(index_path.read_text(encoding="utf-8"))
    require(index["encoder"]["name"] == "dinov2", "Expected a DINOv2 index")
    require(index["encoder"]["weightsSha256"] == weights["dinov2"][1], "Index weight binding mismatch")
    require(index["encoder"]["sourceSha256"] == source_hash, "Index source binding mismatch")
    require(index["encoder"]["encoderSha256"] == digest(encoder_path), "Index encoder binding mismatch")
    require(index["downloadComplete"] is True, "Index downloads incomplete")
    revision = None
    clean = None
    if (source / ".git").exists():
        revision = subprocess.run(["git", "--no-optional-locks", "-C", str(source), "rev-parse", "HEAD"],
                                  capture_output=True, text=True, check=True).stdout.strip()
        status = subprocess.run(["git", "--no-optional-locks", "-C", str(source), "status", "--porcelain",
                                 "--untracked-files=all", "--", "dinov2", "README.md", "LICENSE"],
                                capture_output=True, text=True, check=True).stdout
        clean = not status.strip()
        require(clean, "DINOv2 source/model card/licence differs from Git checkout")
    if expected_revision is not None:
        require(revision == expected_revision, "DINOv2 Git revision missing or unexpected")

    return {"identityAuditComplete": True, "readOnlyInputs": True, "network": False,
            "privatePhotos": False, "databaseAccess": False,
            "scope": "Model bytes, source and index encoder bindings; no vector or accuracy qualification",
            "licenseScope": "Recorded declarations; reference-image rights and release approval excluded",
            "lockSha256": digest(lock_path), "ocrCacheVersion": version, "ocr": ocr,
            "visualWeights": models, "dinov2Source": {"gitRevision": revision,
            "gitSourceCardLicenseClean": clean, "pythonFiles": len(files), "pythonSourceSha256": source_hash,
            "licenseSha256": digest(source / "LICENSE"), "readmeSha256": digest(source / "README.md")},
            "activeIndex": {"manifestSha256": digest(index_path), "name": index["encoder"]["name"],
            "referenceCount": index["referenceCount"], "downloadComplete": index["downloadComplete"],
            "sourceAndWeightBindingsVerified": True}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--ocr-cache", type=Path, required=True)
    parser.add_argument("--visual-models", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--expected-dinov2-revision")
    parser.add_argument("--output", type=Path, help="Optional report file; defaults to stdout")
    args = parser.parse_args()
    try:
        if args.output:
            # A report must never overwrite an input or anything inside a cache.
            output = args.output.resolve()
            require(not any(output.is_relative_to(root.resolve())
                            for root in (args.ocr_cache, args.visual_models)),
                    "Report output must be outside model caches")
            require(output not in (args.index.resolve(),
                                  (args.repo / "tools/acquisition-runtime/models.lock.json").resolve(),
                                  (args.repo / "tools/acquisition-eval/image_encoder.py").resolve()),
                    "Report output must not overwrite audit inputs")
        report = audit(args.repo, args.ocr_cache, args.visual_models, args.index,
                       args.expected_dinov2_revision)
        serialized = json.dumps(report, indent=2) + "\n"
        if args.output:
            args.output.write_text(serialized, encoding="utf-8")
        else:
            print(serialized, end="")
    except (ValueError, KeyError, OSError, SyntaxError, subprocess.CalledProcessError) as error:
        # Do not echo caller-selected absolute paths or subprocess diagnostics.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(f"Model source audit failed: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
