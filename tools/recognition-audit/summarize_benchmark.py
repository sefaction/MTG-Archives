"""Summarize complete paired trials without treating suggestions as accepts."""
import argparse
import hashlib
import json
import math
import statistics
from collections import Counter
from pathlib import Path


def percentile(values, probability):
    values = sorted(values)
    return values[max(0, math.ceil(probability * len(values)) - 1)] if values else None


def wilson(successes, count):
    if not count:
        return None
    z = 1.959963984540054
    proportion = successes / count
    denominator = 1 + z * z / count
    center = (proportion + z * z / (2 * count)) / denominator
    radius = z * math.sqrt(proportion * (1 - proportion) / count + z * z / (4 * count * count)) / denominator
    return [center - radius, center + radius]


def timings(values):
    return {
        'median': statistics.median(values) if values else None,
        'p95': percentile(values, .95),
        'max': max(values) if values else None,
    }


def summarize_variant(rows):
    identifiable = [row for row in rows if row.get('expectedScryfallIds')]
    unknown = [row for row in rows if not row.get('expectedScryfallIds')]
    automatic = [row for row in rows if row.get('offlineAutomaticDecision')]
    strong = [row for row in rows if row['result'].get('status') == 'STRONG_MATCH']
    first_two = [row for row in identifiable if row['route'] in ['EXACT_IDENTIFIER', 'PARTIAL_SCOPED_IMAGE']]
    warm = [row['totalMilliseconds'] for row in rows if not row.get('coldNativeStages')]
    correct = sum(row['exactTop1'] is True for row in identifiable)
    wrong_automatic = sum(row['offlineAutomaticDecision'] not in (row.get('expectedScryfallIds') or []) for row in automatic)
    operation_counts = Counter()
    for row in rows:
        operation_counts.update(row.get('counts', {}))
    return {
        'images': len(rows),
        'identifiableFronts': len(identifiable),
        'unobservableTargets': len(unknown),
        'exactTop1': correct,
        'exactTop12': sum(row['exactRank'] is not None for row in identifiable),
        'exactTop1Rate': correct / len(identifiable) if identifiable else None,
        'descriptiveImageWilson95': wilson(correct, len(identifiable)),
        'wrongFirstSuggestionsNeedingCorrection': len(identifiable) - correct,
        'allRequireApplicationReview': len(rows),
        'strongSuggestions': len(strong),
        'wrongStrongSuggestions': sum(row['exactTop1'] is not True for row in strong),
        'offlineAutomaticDecisions': len(automatic),
        'offlineWrongAutomatic': wrong_automatic,
        'offlineAutomaticCoverage': len(automatic) / len(rows) if rows else None,
        'offlineAcceptancePrecision': 1 - wrong_automatic / len(automatic) if automatic else None,
        'descriptiveAcceptanceWilson95': wilson(len(automatic) - wrong_automatic, len(automatic)),
        'unobservableTargetsWithSuggestions': sum(bool(row['result']['proposals']) for row in unknown),
        'firstTwoCorrectFirstSuggestions': sum(row['exactTop1'] is True for row in first_two),
        'firstTwoRoutes': len(first_two),
        'firstTwoRouteCoverage': len(first_two) / len(identifiable) if identifiable else None,
        'descriptiveRouteCoverageWilson95': wilson(len(first_two), len(identifiable)),
        'routeCounts': dict(Counter(row['route'] for row in rows)),
        'stampObservationCounts': dict(Counter(row.get('nativePrinting', {}).get('observedStamp', 'NOT_RUN') for row in rows)),
        'allTimingMs': timings([row['totalMilliseconds'] for row in rows]),
        'warmTimingMs': {'n': len(warm), **timings(warm)},
        'coldStageCalls': sum(len(row.get('coldNativeStages', [])) for row in rows),
        'expensiveCounts': dict(operation_counts),
        'operationsPerImage': {key: value / len(rows) for key, value in operation_counts.items()},
        'interruptedCountLowerBoundImages': sum(bool(row.get('incompleteOperationCounts')) for row in rows),
        'failureSampleIds': [row['sampleId'] for row in identifiable if row['exactTop1'] is not True],
    }


def summarize(report):
    if report.get('complete') is not True:
        raise ValueError('Complete trial required')
    groups = {variant: [row for row in report['rounds'] if row['variant'] == variant] for variant in report['variants']}
    sample_sets = [set(row['sampleId'] for row in rows) for rows in groups.values()]
    if not sample_sets or not sample_sets[0] or any(samples != sample_sets[0] for samples in sample_sets):
        raise ValueError('Variants must contain identical nonempty sample sets')
    if any(len(rows) != len(sample_sets[0]) for rows in groups.values()):
        raise ValueError('Duplicate sample/variant observation')
    if sum(map(len, groups.values())) != len(report['rounds']):
        raise ValueError('Unexpected variant observation')
    return {
        'version': 1,
        'scope': report['scope'],
        'pairedImages': len(sample_sets[0]),
        'variants': {variant: summarize_variant(rows) for variant, rows in groups.items()},
        'limits': report['limits'] + [
            'Wilson intervals describe sampled image outcomes only; correlated copies, printing-group overlap and biased strata prevent population accuracy claims',
            'Manual correction metric is wrong first suggestion versus verified truth; actual user review actions were not performed',
            'Offline stop-rule decisions are not saved app confirmations; zero-decision precision is undefined',
        ],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    raw = args.report.read_bytes()
    result = summarize(json.loads(raw.decode('utf-8-sig')))
    result['sourceReportSha256'] = hashlib.sha256(raw).hexdigest()
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
