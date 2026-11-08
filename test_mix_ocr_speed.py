import unittest
from unittest.mock import Mock, patch
import numpy as np
from ocr_labels import read_mix_code_fast, recognize_label_image


class MixFastOCRTests(unittest.TestCase):
    def engine(self, results):
        engine = Mock(return_value=([[None, 'FALLBACK', .95]], None))
        engine.use_angle_cls = False
        engine.text_recognizer = Mock(side_effect=results)
        return engine

    def test_agreeing_crops_skip_full_detection_without_code_format_rules(self):
        for code in ('7', 'AB/12-X', 'D30001260'):
            engine = self.engine([([(code, .9), (code, .92)], .01)])
            with patch('ocr_labels.find_mix_code_crops', return_value=[np.full((48, 200), 255, np.uint8)]):
                result, raw = recognize_label_image(np.zeros((200, 200, 3), np.uint8), 'mix', engine)
            self.assertEqual(result['cell'], code)
            engine.assert_not_called()
            self.assertEqual(engine.text_recognizer.call_count, 1)

    def test_disagreement_or_low_confidence_uses_existing_fallback(self):
        for values in ([('A', .95), ('B', .95)], [('A', .74), ('A', .74)]):
            engine = self.engine([(values, .01)])
            with patch('ocr_labels.find_mix_code_crops', return_value=[np.full((48, 200), 255, np.uint8)]):
                result, raw = recognize_label_image(np.zeros((200, 200, 3), np.uint8), 'mix', engine)
            self.assertEqual(result['cell'], 'FALLBACK')
            self.assertEqual(engine.call_count, 2)

    def test_two_distinct_labels_are_not_arbitrarily_selected(self):
        engine = self.engine([([('A', .95), ('A', .96)], .01),
                              ([('B', .95), ('B', .96)], .01)])
        with patch('ocr_labels.find_mix_code_crops', return_value=[np.ones((48, 200), np.uint8)] * 2):
            code, raw = read_mix_code_fast(np.zeros((200, 200, 3), np.uint8), engine)
        self.assertIsNone(code)

    def test_no_label_does_not_invoke_recognizer(self):
        engine = self.engine([])
        code, _ = read_mix_code_fast(np.zeros((200, 200, 3), np.uint8), engine)
        self.assertIsNone(code)
        engine.text_recognizer.assert_not_called()
