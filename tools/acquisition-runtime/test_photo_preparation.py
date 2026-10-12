import contextlib
import io
import json
import sys
import types
import unittest
from unittest.mock import patch
import recognize

class PreparationTest(unittest.TestCase):
    def test_control_initializes_once_and_never_publishes_synthetic_ocr_as_photo_evidence(self):
        seen=[]
        engine=types.SimpleNamespace(predict=lambda image:seen.append(image.copy()) or [{'rec_texts':['startup only']}])
        output=io.StringIO()
        with patch.object(recognize,'descriptor',return_value={'digest':'a'*64}), \
             patch.object(recognize,'ocr_engine',return_value=engine), \
             patch.object(recognize,'_prepared',False), \
             patch.object(sys,'argv',['recognize.py','--stream','--prepare']), \
             patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(b'\0'*8))), \
             patch.object(sys,'__stdout__',output),contextlib.redirect_stdout(io.StringIO()):
            recognize.main()
        self.assertEqual([json.loads(line) for line in output.getvalue().splitlines()],
                         [{'prepared':True,'descriptor':'a'*64}]*2)
        self.assertEqual(len(seen),1)
        self.assertEqual(seen[0].shape,(457,1000,3))
        self.assertNotIn('startup only',output.getvalue())

    def test_legacy_zero_frame_and_describe_do_not_initialize_ocr(self):
        with patch.object(recognize,'descriptor',return_value={'digest':'a'*64}), \
             patch.object(recognize,'ocr_engine',side_effect=AssertionError('unexpected initialization')), \
             patch.object(sys,'argv',['recognize.py','--stream']), \
             patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(b'\0'*4))):
            with self.assertRaises(ValueError):recognize.main()
        output=io.StringIO()
        with patch.object(recognize,'descriptor',return_value={'digest':'a'*64}), \
             patch.object(recognize,'ocr_engine',side_effect=AssertionError('unexpected initialization')), \
             patch.object(sys,'argv',['recognize.py','--describe','--prepare']), \
             contextlib.redirect_stdout(output):recognize.main()
        self.assertEqual(json.loads(output.getvalue()),{'digest':'a'*64})

if __name__=='__main__':unittest.main()
