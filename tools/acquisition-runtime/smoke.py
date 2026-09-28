"""Run persistent CPU models offline after recreating the container."""
import numpy as np
from paddleocr import PaddleOCR
from recognize import ROOT, MODEL_NAMES, descriptor

assert descriptor()['execution'] == 'CPU'
ocr = PaddleOCR(
    text_detection_model_name=MODEL_NAMES[0], text_recognition_model_name=MODEL_NAMES[1],
    text_detection_model_dir=str(ROOT / MODEL_NAMES[0]),
    text_recognition_model_dir=str(ROOT / MODEL_NAMES[1]),
    use_doc_orientation_classify=False, use_doc_unwarping=False,
    use_textline_orientation=False, device='cpu', cpu_threads=1, enable_mkldnn=False,
)
assert len(list(ocr.predict(np.full((320, 240, 3), 255, dtype=np.uint8)))) == 1
print('PASS: persistent CPU models load and infer offline as the native user')
