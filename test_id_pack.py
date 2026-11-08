"""ID Pack writes and stock are verified only against a disposable database."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from uuid import uuid4

import test_api_regressions


class IdPackTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_api_regressions.ApiRegressionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.worker
        self.admin = self.fixture.client

    def payload(self, **changes):
        value = dict(sort_id=1, type='single', id_pack='C1264466260801050079',
                     expected_qty=20, scans=['C1264466260801050080', 'C1264498765432101234'],
                     manual_quantity=0, pallet_number='12', request_id=str(uuid4()))
        value.update(changes)
        return value

    def submit(self, **changes):
        return self.client.post('/api/id-pack/submit', json=self.payload(**changes))

    def rows(self, sql, params=()):
        return self.fixture.rows(sql, params)

    def test_receipt_preserves_full_ids_and_updates_existing_stock(self):
        response = self.submit(manual_quantity=3)
        self.assertEqual(response.status_code, 201, response.json)
        group_id = response.json['group_id']
        detail = self.admin.get(f'/api/admin/id-pack/groups/{group_id}').json
        self.assertEqual(detail['scans'], self.payload()['scans'])
        self.assertEqual((detail['manual_quantity'], detail['quantity']), (3, 5))
        self.assertNotIn('user_id', detail)
        self.assertNotIn('timestamp', detail)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'], 5)
        self.assertEqual(self.rows('SELECT SUM(delta) qty FROM inventory_movements')[0]['qty'], 5)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=2')[0]['total_cartons'], 5)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets')[0]['cartons_count'], 5)

    def test_resolve_creates_nothing_and_admin_only_sees_saved_groups(self):
        result = self.client.post('/api/id-pack/resolve', json=self.payload())
        self.assertEqual(result.json, dict(prefix='C12644', group=None))
        self.assertEqual(self.admin.get('/api/admin/id-pack/groups?sort_id=1').json, [])
        self.assertEqual(self.rows('SELECT * FROM id_pack_groups'), [])
        self.submit()
        result = self.client.post('/api/id-pack/resolve', json=self.payload())
        self.assertEqual(result.json['group']['collected'], 2)
        self.assertEqual(len(self.admin.get('/api/admin/id-pack/groups?sort_id=1').json), 1)

    def test_retries_are_idempotent_even_after_sort_closed(self):
        payload = self.payload()
        first = self.client.post('/api/id-pack/submit', json=payload)
        with closing(self.fixture.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='closed' WHERE id=1")
            conn.commit()
        repeated = self.client.post('/api/id-pack/submit', json=payload)
        self.assertEqual(repeated.status_code, 200)
        self.assertTrue(repeated.json['repeated'])
        payload['manual_quantity'] = 1
        self.assertEqual(self.client.post('/api/id-pack/submit', json=payload).status_code, 409)
        self.assertEqual(len(self.rows('SELECT * FROM id_pack_scans')), 2)
        self.assertEqual(self.rows('SELECT SUM(delta) qty FROM inventory_movements')[0]['qty'], 2)
        self.assertEqual(self.admin.get(f"/api/admin/id-pack/groups/{first.json['group_id']}").status_code, 200)

    def test_mismatched_code_and_bad_quantities_do_not_write(self):
        for changes in [dict(scans=['D999990123']), dict(scans=[], manual_quantity=0),
                        dict(manual_quantity=-1), dict(manual_quantity=1.5), dict(manual_quantity=True),
                        dict(expected_qty=1), dict(expected_qty=0), dict(expected_qty=2.5),
                        dict(scans=['short']), dict(scans=[None]), dict(id_pack='short'),
                        dict(type='vevor'), dict(pallet_number='')]:
            with self.subTest(changes=changes):
                self.assertIn(self.submit(**changes).status_code, (400, 409))
        for table in ['id_pack_groups','id_pack_scans','id_pack_receipts','icc_codes','pallets','inventory_movements']:
            self.assertEqual(self.rows(f'SELECT * FROM {table}'), [], table)

    def test_any_six_characters_and_mix_without_expected_count(self):
        for prefix in ['012345', '#a!9/?', 'абвгде', '😀abc12', 'aBcD12']:
            full = prefix + 'FULL-id-00099'
            response = self.submit(type='mix', id_pack=full, scans=[full, full], expected_qty=None)
            self.assertEqual(response.status_code, 201, response.json)
            detail = self.admin.get(f"/api/admin/id-pack/groups/{response.json['group_id']}").json
            self.assertEqual(detail['prefix'], prefix)
            self.assertEqual(detail['scans'], [full, full])
            self.assertIsNone(detail['expected_qty'])

    def test_zero_prefix_keeps_all_zeros_and_reads_four_more_characters(self):
        examples = [
            ('C1264466260801050079', 'C12644'),
            ('C1008455260805160062', 'C1008455'),
            ('C108455260805160062', 'C108455'),
            ('C100084055260805160062', 'C10008405'),
            ('AB000123456789', 'AB0001234'),
            ('00000123456789', '000001234'),
            ('😀x001234-tail', '😀x001234'),
        ]
        from id_pack import id_pack_group
        for full, expected in examples:
            with self.subTest(full=full):
                self.assertEqual(id_pack_group(full), expected)
                self.assertEqual(id_pack_group(expected), expected)
                resolved = self.client.post('/api/id-pack/resolve',json=self.payload(id_pack=full))
                self.assertEqual(resolved.status_code, 200, resolved.json)
                self.assertEqual(resolved.json['prefix'], expected)
                response = self.submit(type='mix', id_pack=full, scans=[full])
                self.assertEqual(response.status_code, 201, response.json)
                group = self.admin.get(f"/api/admin/id-pack/groups/{response.json['group_id']}").json
                self.assertEqual(group['prefix'], expected)
                self.assertEqual(group['scans'], [full])

    def test_codes_that_share_six_characters_are_separate_with_zeros(self):
        first = 'C1008455260805160062'
        second = 'C1008466260805160062'
        a = self.submit(id_pack=first, scans=[first])
        b = self.submit(id_pack=second, scans=[second])
        self.assertEqual((a.status_code,b.status_code), (201,201))
        self.assertNotEqual(a.json['group_id'],b.json['group_id'])
        self.assertEqual(self.submit(id_pack=first, scans=[second]).status_code,400)
        self.assertEqual(self.submit(id_pack=first, scans=[first]).status_code,201)

    def test_incomplete_zero_codes_do_not_write(self):
        for value in ['C100845', 'C100000000000', 'C10012', 'AB000123']:
            with self.subTest(value=value):
                response = self.client.post('/api/id-pack/resolve',json=self.payload(id_pack=value))
                self.assertEqual(response.status_code,400)
                self.assertEqual(self.submit(id_pack=value, scans=[value]).status_code,400)
        self.assertEqual(self.rows('SELECT * FROM id_pack_groups'),[])

    def test_groups_are_scoped_to_sort_and_type(self):
        a = self.submit().json['group_id']
        b = self.submit(sort_id=2).json['group_id']
        c = self.submit(type='mix').json['group_id']
        self.assertEqual(len({a,b,c}), 3)
        self.assertEqual(len(self.admin.get('/api/admin/id-pack/groups?sort_id=1&type=mix').json), 1)
        self.assertEqual(self.submit(expected_qty=25).status_code, 409)

    def test_closed_pallet_and_source_number_roll_back_everything(self):
        self.submit()
        with closing(self.fixture.db.get_connection()) as conn:
            conn.execute("UPDATE inventory_pallets SET state='closed' WHERE pallet_number='12'")
            conn.commit()
        response = self.submit()
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(len(self.rows('SELECT * FROM id_pack_receipts')), 1)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'], 2)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets')[0]['cartons_count'], 2)

    def test_source_pallet_collision_rolls_back_new_group(self):
        from inventory import ensure_context, ensure_pallet
        with closing(self.fixture.db.get_connection()) as conn:
            context = ensure_context(conn, 1)
            ensure_pallet(conn, context['id'], 'SOURCE', stage='source')
            conn.commit()
        self.assertEqual(self.submit(pallet_number='SOURCE').status_code, 409)
        for table in ['id_pack_groups','id_pack_scans','id_pack_receipts','icc_codes','pallets']:
            self.assertEqual(self.rows(f'SELECT * FROM {table}'), [])

    def test_permissions_inactive_and_deleted_sorts(self):
        guest = self.fixture.app.test_client()
        self.assertEqual(guest.post('/api/id-pack/resolve', json=self.payload()).status_code, 401)
        self.assertEqual(guest.post('/api/id-pack/submit', json=self.payload()).status_code, 401)
        self.assertEqual(self.client.get('/api/admin/id-pack/groups?sort_id=1').status_code, 403)
        response = self.submit()
        path = f"/api/admin/id-pack/groups/{response.json['group_id']}"
        self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.submit(sort_id=3).status_code, 409)
        with closing(self.fixture.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='deleted' WHERE id=1")
            conn.commit()
        self.assertEqual(self.admin.get(path).status_code, 404)
        self.assertEqual(self.admin.get('/api/admin/id-pack/groups?sort_id=1').status_code, 404)

    def test_parallel_workers_cannot_exceed_expected_quantity(self):
        def send(index):
            client = self.fixture.client_for(2)
            return client.post('/api/id-pack/submit',json=self.payload(expected_qty=2)).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(send, range(2)))
        self.assertEqual(sorted(results), [201,409])
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'], 2)
