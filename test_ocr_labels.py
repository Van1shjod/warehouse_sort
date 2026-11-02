import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from ocr_labels import extract_from_variants, parse_label_text, parse_mix_text


ROOT = Path(__file__).resolve().parent


class LabelParsingTests(unittest.TestCase):
    def test_complete_panel_skips_full_image_ocr(self):
        import numpy as np
        from ocr_labels import recognize_label_image
        engine = Mock()
        expected = {'cell': '1213', 'qtyPack': 10, 'prefix': 'OH', 'zone': 'A'}
        with patch('ocr_labels.read_label_panel', return_value=(expected, {'panel_0_cell': '1213'})):
            result, raw = recognize_label_image(np.zeros((20, 20, 3), dtype=np.uint8), 'single', engine)
        self.assertEqual(result, expected)
        engine.assert_not_called()

    def test_incomplete_panel_keeps_full_image_fallback(self):
        import numpy as np
        from ocr_labels import recognize_label_image
        engine = Mock(return_value=([[None, '1213 10 PACK OH-A', .9]], None))
        panel = {'cell': '1213', 'qtyPack': 10, 'prefix': 'OH', 'zone': None}
        with patch('ocr_labels.read_label_panel', return_value=(panel, {})):
            result, raw = recognize_label_image(np.zeros((20, 20, 3), dtype=np.uint8), 'single', engine)
        self.assertEqual(result['zone'], 'A')
        self.assertEqual(engine.call_count, 4)
        self.assertIsInstance(engine.call_args.args[0], bytes)

    def test_mix_agreement_skips_extra_variants(self):
        import numpy as np
        from ocr_labels import recognize_label_image
        engine = Mock(return_value=([[None, 'D980989', .9]], None))
        result, raw = recognize_label_image(np.zeros((20, 20, 3), dtype=np.uint8), 'mix', engine)
        self.assertEqual(result['cell'], 'D980989')
        self.assertEqual(engine.call_count, 2)
        self.assertEqual(set(raw), {'gray', 'joined'})

    def test_mix_disagreement_keeps_extra_variants(self):
        import numpy as np
        from ocr_labels import recognize_label_image
        engine = Mock(side_effect=[([[None, code, .9]], None)
                                   for code in ['D980289', 'D980989', 'D980989', 'D980989']])
        result, raw = recognize_label_image(np.zeros((20, 20, 3), dtype=np.uint8), 'mix', engine)
        self.assertEqual(result['cell'], 'D980989')
        self.assertEqual(engine.call_count, 4)

    def test_cell_is_not_a_shipping_date(self):
        data = parse_label_text('2026-08-01 ICNo:ICC1008458260801213 1213 10 PACK 16 OH- PCS')
        self.assertEqual(data, {'cell': '1213', 'qtyPack': 10, 'prefix': 'OH', 'zone': None})

    def test_pack_never_uses_a_cell_suffix_or_pcs(self):
        for cell in ['4162', '0174', '1129']:
            with self.subTest(cell=cell):
                data = parse_label_text(f'{cell} PACK 20 AE- PCS MYSELF')
                self.assertEqual(data['cell'], cell)
                self.assertIsNone(data['qtyPack'])
                self.assertIsNone(data['zone'])

    def test_pack_id_and_random_numbers_are_not_quantity(self):
        data = parse_label_text('Pack ID:C123456 32 of IC 2026-07-20')
        self.assertIsNone(data['qtyPack'])
        self.assertIsNone(data['cell'])

    def test_explicit_fields_and_normalization(self):
        data = parse_label_text('１２１３ １０ PACK 16 OH-Ａ20 PCS')
        self.assertEqual(data, {'cell': '1213', 'qtyPack': 10, 'prefix': 'OH', 'zone': 'A'})

    def test_variant_disagreement_does_not_pick_first_code(self):
        data = extract_from_variants({'original': 'D980289', 'contrast': 'D980989'}, 'mix')
        self.assertIsNone(data['cell'])
        data = extract_from_variants({'original': 'D980289', 'contrast': 'D980989',
                                      'gray': 'D980989'}, 'mix')
        self.assertEqual(data['cell'], 'D980989')

    def test_mix_keeps_full_code(self):
        self.assertEqual(parse_mix_text('D980989 Made in China')['cell'], 'D980989')


class LabelPhotoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (ROOT / 'ocr_verified_labels.json').is_file():
            raise unittest.SkipTest('Historical label photos were removed during the clean reset')
        import cv2
        from rapidocr_onnxruntime import RapidOCR
        cls.cv2 = cv2
        cls.engine = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
        cls.verified = json.loads((ROOT / 'ocr_verified_labels.json').read_text(encoding='utf-8'))['labels']

    def test_manually_verified_single_photos(self):
        from ocr_labels import read_label_panel
        for filename, expected in self.verified.items():
            if '_single_' not in filename:
                continue
            with self.subTest(photo=filename):
                record = json.loads((ROOT / 'ocr_training_data/single/results' / filename).read_text(encoding='utf-8'))
                image = self.cv2.cvtColor(self.cv2.imread(str(ROOT / record['image_path'])), self.cv2.COLOR_BGR2RGB)
                data, _ = read_label_panel(image, self.engine)
                self.assertEqual(data, expected)

    def test_recognition_endpoint_and_saved_results(self):
        spec = importlib.util.spec_from_file_location('ocr_photo_test_app', ROOT / 'app.py')
        module = importlib.util.module_from_spec(spec)
        with patch('database.Database'):
            spec.loader.exec_module(module)
        module.app.config['TESTING'] = True
        module.ocr_engine = self.engine
        client = module.app.test_client()
        with client.session_transaction() as session:
            session['user_id'] = 7
        # Exercise the actual upload/preprocessing/recognition/logging pipeline.
        for filename in ['20260928_060746_111865_user1_single_result.json',
                         '20261018_143101_412908_user1_mix_result.json']:
            carton_type = 'mix' if '_mix_' in filename else 'single'
            record = json.loads((ROOT / 'ocr_training_data' / carton_type / 'results' / filename).read_text(encoding='utf-8'))
            content = (ROOT / record['image_path']).read_bytes()
            with self.subTest(photo=filename), tempfile.TemporaryDirectory() as directory:
                previous = Path.cwd()
                try:
                    os.chdir(directory)
                    with patch('builtins.print'):
                        response = client.post('/api/ocr/recognize', data={
                            'type': carton_type, 'image': (io.BytesIO(content), 'label.jpg')})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.get_json(), self.verified[filename])
                    saved = list(Path('ocr_training_data').glob('*/results/*.json'))
                    self.assertEqual(len(saved), 1)
                    result = json.loads(saved[0].read_text(encoding='utf-8'))
                    self.assertEqual(result['extracted_data'], self.verified[filename])
                    self.assertTrue(result['success'])
                finally:
                    os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
