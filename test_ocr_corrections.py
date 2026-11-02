import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class OcrCorrectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Never initialize or change the real warehouse database.
        spec = importlib.util.spec_from_file_location(
            'ocr_correction_test_app', Path(__file__).with_name('app.py'))
        cls.module = importlib.util.module_from_spec(spec)
        with patch('database.Database'):
            spec.loader.exec_module(cls.module)
        cls.module.app.config['TESTING'] = True

    def setUp(self):
        self.previous_directory = Path.cwd()
        self.directory = tempfile.TemporaryDirectory()
        os.chdir(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(os.chdir, self.previous_directory)
        self.client = self.module.app.test_client()
        self.module.db.reset_mock()
        self.module.db.get_user_by_id.return_value = {'role': 'admin'}
        with self.client.session_transaction() as session:
            session['user_id'] = 7
        self.correction = {'cell': ' d980947 ', 'qtyPack': 10,
                           'prefix': ' iz ', 'zone': ' p '}

    def make_record(self, carton_type, filename='scan_result.json'):
        path = Path('ocr_training_data') / carton_type / 'results' / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {'timestamp': '20261018_140000', 'carton_type': carton_type,
                  'success': False, 'extracted_data': {'cell': 'wrong'},
                  'raw_ocr_results': {'original': 'original OCR text'}}
        path.write_text(json.dumps(record), encoding='utf-8')
        return path, record

    def update(self, **payload):
        return self.client.put('/api/admin/training_data/scan_result.json',
                               json=payload)

    def test_corrections_persist_for_each_type_without_changing_original(self):
        for carton_type in ['single', 'mix', 'vevor']:
            with self.subTest(carton_type=carton_type):
                path, original = self.make_record(carton_type)
                response = self.update(carton_type=carton_type,
                                       corrected_data=self.correction)
                self.assertEqual(response.status_code, 200)
                saved = json.loads(path.read_text(encoding='utf-8'))
                for key, value in original.items():
                    self.assertEqual(saved[key], value)
                self.assertEqual(saved['corrected_data'], {
                    'cell': 'D980947', 'qtyPack': 10, 'prefix': 'IZ', 'zone': 'P'})
                self.assertEqual(saved['corrected_by'], 7)
                self.assertTrue(saved['corrected_at'])
                scans = self.client.get('/api/admin/ocr_scans').get_json()
                self.assertTrue(any(s.get('corrected_data') == saved['corrected_data']
                                    for s in scans))
                listed = self.client.get('/api/admin/training_data').get_json()['data']
                self.assertTrue(any(s.get('corrected_data') == saved['corrected_data']
                                    for s in listed))

    def test_untyped_requests_and_ambiguous_names(self):
        self.make_record('single')
        self.assertEqual(self.update(corrected_data=self.correction).status_code, 200)
        self.make_record('mix')
        self.assertEqual(self.update(corrected_data=self.correction).status_code, 409)

    def test_invalid_input_does_not_change_record(self):
        path, original = self.make_record('single')
        for correction in [None, [], {}, {'cell': ' '},
                           {'cell': '1234', 'qtyPack': True},
                           {'cell': '1234', 'qtyPack': -1},
                           {'cell': '1234', 'prefix': []}]:
            with self.subTest(correction=correction):
                self.assertEqual(self.update(carton_type='single',
                                             corrected_data=correction).status_code, 400)
        self.assertEqual(self.update(carton_type='../single',
                                     corrected_data=self.correction).status_code, 400)
        self.assertEqual(json.loads(path.read_text(encoding='utf-8')), original)
        self.module.db.log_activity.assert_not_called()

    def test_missing_record_and_wrong_type(self):
        self.make_record('single')
        self.assertEqual(self.update(carton_type='mix',
                                     corrected_data=self.correction).status_code, 404)

    def test_only_admin_can_correct(self):
        path, original = self.make_record('single')
        self.module.db.get_user_by_id.return_value = {'role': 'user'}
        self.assertEqual(self.update(corrected_data=self.correction).status_code, 403)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.update(corrected_data=self.correction).status_code, 401)
        self.assertEqual(json.loads(path.read_text(encoding='utf-8')), original)


if __name__ == '__main__':
    unittest.main()
