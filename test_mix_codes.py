"""Unrestricted MIX identities across OCR and accounting, using temporary DBs."""
import unittest
from contextlib import closing

from ocr_labels import parse_mix_text


CODES = ('7', 'abc', '12/34-X', 'КОД-9', 'Z' * 80, 'space code')


class MixCodeTests(unittest.TestCase):
    def test_ocr_keeps_arbitrary_codes_and_rejects_ambiguous_regions(self):
        for code in CODES:
            with self.subTest(code=code):
                self.assertEqual(parse_mix_text(code)['cell'], code.upper())
        self.assertIsNone(parse_mix_text('  ')['cell'])
        self.assertIsNone(parse_mix_text('ABC\nXYZ')['cell'])

    def test_sort_accepts_arbitrary_mix_codes(self):
        from test_sorting import SortingTests
        fixture = SortingTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for code in CODES:
            with self.subTest(code=code):
                identity = fixture.identity(type='mix', icc_code=code, total_cartons=0, location_code='')
                fixture.success(fixture.submit(identity))
        self.assertEqual(fixture.submit(fixture.identity(type='mix', icc_code=' ')).status_code, 400)

    def test_presort_accepts_arbitrary_mix_codes(self):
        from test_presort import PresortTests
        fixture = PresortTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        pallet = fixture.open()
        for code in CODES:
            with self.subTest(code=code):
                payload = fixture.scan(pallet['id'])
                payload.update(type='mix', code=code)
                response = fixture.client.post('/api/presort/scans', json=payload)
                self.assertIn(response.status_code, (200, 201), response.get_json())

    def test_guided_collection_accepts_arbitrary_mix_codes(self):
        from test_collection import CollectionTests
        for code in CODES:
            with self.subTest(code=code):
                fixture = CollectionTests()
                fixture.setUp()
                self.addCleanup(fixture.doCleanups)
                with closing(fixture.db.get_connection()) as conn:
                    conn.execute("UPDATE inventory_packs SET code=? WHERE type='mix'", (code.upper(),))
                    conn.commit()
                identity = dict(sort_id=1, type='mix', icc_code=code, location_code='', total_cartons=0)
                result = fixture.success(fixture.worker.post('/api/collection/pick', json=fixture.payload('10', identity)))
                self.assertEqual(result['pack']['collected'], 1)


if __name__ == '__main__':
    unittest.main()
