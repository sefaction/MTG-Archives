import test from 'node:test';
import assert from 'node:assert/strict';
import { acquisitionFooterIdentifiers, acquisitionFooterObservations } from '../lib/acquisition-footer';
import { createAcquisitionRecognitionIndex, proposeAcquisitionPrintings } from '../lib/acquisition-recognition';
import { acquisitionCatalogQueries } from '../lib/acquisition-catalog-queries';

test('fragmented rarity and fraction numbers never support a partial collector', () => {
  for (const line of ['C 3 0 2', 'R 33 6', 'C0 0 1 7a', 'C 17 18', 'U 1 7 8 / 3 0 2',
    'C 17 / 3 0 2', '1 7 / 302', 'C 3 0/302', '17 / 3 0 2', 'C 17\t18', 'C 17\u00a018']) {
    const parsed = acquisitionFooterIdentifiers([line, 'ABC EN']);
    assert.deepEqual(parsed.collectors, [], line);
    assert.equal(parsed.recoveredLayout, true, 'a discarded fragment preserves uncertainty: '+line);
    const text = {title: ['Fragment test'], footer: [line, 'ABC EN']};
    assert.deepEqual(acquisitionCatalogQueries([{rotationDegrees: 0, text}]).printings, [], line);
  }
});

test('discarding a fragment cannot turn another clear identifier into automatic acceptance', () => {
  const card = {id: 'right', name: 'Fragment test', setCode: 'abc', collectorNumber: '17', lang: 'en'};
  const index = createAcquisitionRecognitionIndex([card]);
  for (const line of ['C 3 0 2', 'C 1 7', '17 / 3 0 2']) {
    const result = proposeAcquisitionPrintings(index, {title: [card.name], footer: ['ABC EN', 'C 17', line]});
    assert.deepEqual(result.evidence.collectors, ['17']);
    assert(result.proposals[0].reasons.includes('SET_AND_COLLECTOR_TEXT'));
    assert(result.proposals[0].reasons.includes('RECOVERED_FOOTER_LAYOUT'));
    assert.equal(result.automaticAcceptance, false, line);
    const combined = acquisitionFooterObservations(['ABC EN', 'C 17'], [line]);
    assert.equal(combined.recoveredLayout, true);
  }
  const wrong = {...card, id: 'wrong', collectorNumber: '3'};
  const result = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([wrong]),
    {title: [card.name], footer: ['ABC EN', 'C 3 0 2']});
  assert(!result.proposals.some(p => p.reasons.includes('SET_AND_COLLECTOR_TEXT')));
  assert.equal(result.automaticAcceptance, false);
});

test('clear collectors preserve padding, suffixes, fractions and unrelated numbers', () => {
  for (const [line, expected] of [
    ['C 0017', ['17']], ['R0017a', ['17a']], ['0017★ / 302', ['17★']],
    ['C 17 / 302', ['17']], ['C 17 Artist', ['17']], ['C 17 © 2025', ['17']],
    ['C1993-2008 Wizards 203/301', ['203']], ['Artist 19 20; 017/302', ['17']],
    ['17/302 18/302', ['17', '18']],
    ['C17/302 18/302', ['18', '17']],
    ['C 1\nR 7', ['1', '7']], ['R 0021', ['21']],
  ] as const) assert.deepEqual(acquisitionFooterIdentifiers([line, 'ABC EN']).collectors, expected, line);
  const parsed = acquisitionFooterIdentifiers(['ABC EN', 'C 1', '7']);
  assert.deepEqual(parsed.collectors, ['1', '7'], 'distinct observations are never joined');
  assert.deepEqual(acquisitionFooterIdentifiers(['C 3 0 2', 'R 17', 'ABC EN']).collectors, ['17']);
});
