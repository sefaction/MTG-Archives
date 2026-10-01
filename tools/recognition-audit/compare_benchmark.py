"""Compare paired outcomes and timing by observed route and printing group."""
import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from summarize_benchmark import summarize


def compare(report, manifest):
    metrics = summarize(report)
    entries = {entry['sampleId']: entry for entry in manifest['entries']}
    variants = {variant: {row['sampleId']: row for row in report['rounds'] if row['variant'] == variant} for variant in report['variants']}
    if not all(set(rows) == set(entries) for rows in variants.values()):
        raise ValueError('Manifest and complete paired report must have identical sample IDs')
    for rows in variants.values():
        for identity, row in rows.items():
            entry = entries[identity]
            if row.get('sha256') != entry.get('sha256') or row.get('expectedScryfallIds') != entry.get('expectedScryfallIds'):
                raise ValueError('Frozen original or truth identity differs')
    baseline = variants.get('BASELINE')
    if baseline is None:
        raise ValueError('Paired baseline required')
    comparisons = {}
    for variant, rows in variants.items():
        identifiable = [identity for identity, entry in entries.items() if entry.get('expectedScryfallIds')]
        groups = defaultdict(list)
        for identity in identifiable:
            entry = entries[identity]
            # Do not invent independence: these are catalog printing groups,
            # not guaranteed different physical copies or independent draws.
            group = entry.get('conservativeGroup') or tuple(entry['expectedScryfallIds'])
            groups[group].append(rows[identity]['exactTop1'] is True)
        deltas = [rows[identity]['totalMilliseconds'] - baseline[identity]['totalMilliseconds'] for identity in rows]
        routes = {}
        for route in sorted(set(row['route'] for row in rows.values())):
            selected = [row for row in rows.values() if row['route'] == route]
            front = [row for row in selected if row.get('expectedScryfallIds')]
            routes[route] = {
                'images': len(selected),
                'identifiable': len(front),
                'exactFirst': sum(row['exactTop1'] is True for row in front),
                'medianMs': statistics.median(row['totalMilliseconds'] for row in selected),
            }
        comparisons[variant] = {
            'printingGroups': len(groups),
            'groupsWithEveryImageCorrect': sum(all(values) for values in groups.values()),
            'groupsWithAnyWrongImage': sum(not all(values) for values in groups.values()),
            'pairedAccuracyWins': sum(rows[identity]['exactTop1'] is True and baseline[identity]['exactTop1'] is not True for identity in identifiable),
            'pairedAccuracyLosses': sum(rows[identity]['exactTop1'] is not True and baseline[identity]['exactTop1'] is True for identity in identifiable),
            'pairedTimingWins': sum(delta < 0 for delta in deltas),
            'pairedTimingLosses': sum(delta > 0 for delta in deltas),
            'medianPairedDeltaMs': statistics.median(deltas),
            'routes': routes,
        }
    return {'metrics': metrics, 'comparisons': comparisons, 'limits': ['Printing-group counts describe dependence; they do not establish random independent sampling', 'Paired wall-time differences retain shared-cache order and background-load confounding']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = compare(json.loads(args.report.read_text(encoding='utf-8-sig')), json.loads(args.manifest.read_text(encoding='utf-8-sig')))
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result['comparisons'], indent=2))
