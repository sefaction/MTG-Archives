import unittest
import cv2
import numpy as np
from printing_evidence import SIZE, stamp_evidence
from evaluate_printing_candidates import selected_candidates, candidate_relation


class PrintingEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((SIZE[1], SIZE[0], 3), 40, np.uint8)
        # Distinct adjacent printing evidence. A blank or blurred photo cannot
        # establish stamp absence merely because the symbol was not found.
        for x in range(120, 840, 12):
            cv2.putText(self.image, '1', (x, 1310), cv2.FONT_HERSHEY_SIMPLEX, .8, (220,)*3, 1)
        self.template = np.zeros((50, 35), np.uint8)
        cv2.fillPoly(self.template, [np.int32([[3, 6], [11, 21], [17, 0], [22, 21], [31, 7], [27, 35], [17, 47], [7, 35]])], 230)
        self.alignment = {'status': 'ALIGNED', 'stampVisible': True, 'footerVisible': True, 'sourceCardWidth': 900}

    def evidence(self, image=None, alignment=None, reference=None, reference_state='ABSENT'):
        return stamp_evidence(self.image if image is None else image,
                              self.alignment if alignment is None else alignment,
                              self.template, self.image if reference is None else reference, reference_state)

    def test_missing_alignment_visibility_or_resolution_never_means_absent(self):
        self.assertEqual(stamp_evidence(None, {}, self.template, self.image)['status'], 'UNREADABLE')
        for key, value in [('stampVisible', False), ('footerVisible', False), ('sourceCardWidth', 100)]:
            self.assertEqual(self.evidence(alignment={**self.alignment, key: value})['status'], 'UNREADABLE')
        for state in ['UNKNOWN', 'PRESENT']:
            self.assertEqual(self.evidence(reference_state=state)['status'], 'UNREADABLE')

    def test_blur_is_unreadable_and_clear_blank_requires_reference_agreement(self):
        self.assertEqual(self.evidence()['status'], 'ABSENT')
        blurred = cv2.GaussianBlur(self.image, (41, 41), 15)
        self.assertEqual(self.evidence(blurred)['status'], 'UNREADABLE')
        stamped = self.image.copy()
        stamped[1303:1353, 35:70] = cv2.cvtColor(self.template, cv2.COLOR_GRAY2BGR)
        self.assertEqual(self.evidence(stamped, reference=stamped)['status'], 'PRESENT')
        self.assertEqual(self.evidence(reference=stamped)['status'], 'UNREADABLE')

    def test_glare_or_unrecognized_mark_is_not_absence(self):
        glare = self.image.copy()
        glare[1260:1375, 15:100] = 255
        self.assertEqual(self.evidence(glare)['status'], 'UNREADABLE')
        marked = self.image.copy()
        cv2.rectangle(marked, (38, 1310), (66, 1346), (200,)*3, -1)
        self.assertEqual(self.evidence(marked)['status'], 'UNREADABLE')

    def test_adjacent_printing_handles_small_offset_and_exposure(self):
        shifted = cv2.warpAffine(self.image, np.float32([[1, 0, 3], [0, 1, -2]]), SIZE,
                                borderMode=cv2.BORDER_REPLICATE)
        shifted = np.clip(shifted.astype(np.float32)*.7+20, 0, 255).astype(np.uint8)
        self.assertEqual(self.evidence(shifted)['status'], 'ABSENT')

    def test_actual_candidates_do_not_depend_on_expected_printing(self):
        identity = '00000000-0000-0000-0000-000000000001'
        top = [{'cardId': identity, 'referenceId': identity+':0'}]
        report = {'version': {'manifestSha256': 'digest'}, 'results': [
            {'file': 'a.jpg', 'expected': 'deliberately-wrong-label', 'methods': {'visual': {'top': top}}}]}
        manifest = {'entries': [{'file': 'a.jpg', 'scryfallId': 'another-wrong-label'}]}
        self.assertEqual(selected_candidates(report, manifest, 'visual', 'digest')['a.jpg'], top)
        with self.assertRaises(ValueError):
            selected_candidates(report, manifest, 'visual', 'changed')
        report['results'].append(report['results'][0])
        with self.assertRaises(ValueError):
            selected_candidates(report, manifest, 'visual', 'digest')

    def test_unknown_stamp_or_reference_cannot_resolve_a_printing(self):
        self.assertEqual(candidate_relation('UNREADABLE', 'PRESENT'), 'UNRESOLVED')
        self.assertEqual(candidate_relation('ABSENT', 'UNKNOWN'), 'UNRESOLVED')
        self.assertEqual(candidate_relation('ABSENT', 'PRESENT'), 'CONTRADICTS_STAMP_STATE')
        self.assertEqual(candidate_relation('PRESENT', 'PRESENT'), 'AGREES_WITH_STAMP_STATE')


if __name__ == '__main__':
    unittest.main()
