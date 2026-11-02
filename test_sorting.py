"""SORT accounting contracts; all writes use a disposable SQLite database."""
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from uuid import uuid4

from flask import Flask

from database import Database


class SortingTests(unittest.TestCase):
    def setUp(self):
        from sorting import register_sorting

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Database(os.path.join(self.temp.name, 'sorting.db'))
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                ALTER TABLE icc_codes ADD COLUMN location_code TEXT;
                ALTER TABLE icc_codes ADD COLUMN sort_id INTEGER;
                CREATE TABLE sorts (
                    id INTEGER PRIMARY KEY,name TEXT,type TEXT,unload_date TEXT,
                    description TEXT,status TEXT,mode TEXT,created_by INTEGER,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,closed_at TEXT
                );
                INSERT INTO sorts(id,name,type,status,mode) VALUES
                    (1,'Rampa 1','single,mix,vevor','active','sort'),
                    (2,'Rampa 2','single,mix,vevor','active','sort'),
                    (3,'Rampa 3','single','closed','sort'),
                    (4,'Rampa 4','single','paused','sort'),
                    (5,'Rampa 5','single','active','presort'),
                    (6,'Zona Mix A','mix','active','sort');
                INSERT INTO users(id,username,password,role) VALUES(2,'worker','unused','user');
            ''')
        self.app = Flask(__name__)
        self.app.secret_key = 'sorting-test-only'
        self.app.testing = True
        self.app.logger.disabled = True
        register_sorting(self.app, self.db)
        self.client = self.client_for(1)

    def client_for(self, user_id):
        client = self.app.test_client()
        with client.session_transaction() as session:
            session['user_id'] = user_id
        return client

    def identity(self, **changes):
        data = dict(sort_id=1, type='single', icc_code='4567', total_cartons=30, location_code='JP-A')
        data.update(changes)
        return data

    def payload(self, identity=None, **changes):
        data = dict(identity or self.identity())
        data.update(cartons_count=1, pallet_number='SORT-1', request_id=str(uuid4()))
        data.update(changes)
        return data

    def submit(self, identity=None, client=None, **changes):
        return (client or self.client).post('/api/sort/submit', json=self.payload(identity, **changes))

    def success(self, response):
        self.assertIn(response.status_code, (200, 201), response.get_json())
        return response.get_json()

    def rows(self, sql, args=()):
        with closing(self.db.get_connection()) as conn:
            return [dict(row) for row in conn.execute(sql, args)]

    def test_authentication_required_for_every_sort_operation(self):
        anonymous = self.app.test_client()
        for endpoint in ('check', 'submit', 'pallet/close'):
            self.assertEqual(anonymous.post('/api/sort/' + endpoint, json=self.payload()).status_code, 401)

    def test_check_submit_and_identity_are_scoped_to_the_sort(self):
        first = self.success(self.submit())
        other = self.identity(); other['sort_id'] = 2
        checked = self.client.post('/api/sort/check', json=other)
        self.assertEqual(checked.status_code, 200)
        self.assertEqual(checked.get_json()['status'], 'new')
        second = self.success(self.submit(other))
        self.assertNotEqual(first['icc_id'], second['icc_id'])
        self.assertEqual([row['sort_id'] for row in self.rows('SELECT sort_id FROM icc_codes ORDER BY id')], [1, 2])
        checked = self.client.post('/api/sort/check', json=self.identity()).get_json()
        self.assertEqual(checked['status'], 'exists')
        self.assertEqual(checked['icc_data']['id'], first['icc_id'])
        self.assertEqual(checked['open_pallet']['id'], first['pallet_id'])

    def test_same_digits_different_pack_location_or_type_do_not_mix(self):
        identities = [self.identity() for _ in range(4)]
        identities[1]['location_code'] = 'JP-B'
        identities[2]['total_cartons'] = 40
        identities[3]['type'] = 'vevor'
        saved = [self.success(self.submit(identity)) for identity in identities]
        self.assertEqual(len({row['icc_id'] for row in saved}), 4)
        for identity, expected in zip(identities, saved):
            checked = self.client.post('/api/sort/check', json=identity).get_json()
            self.assertEqual(checked['icc_data']['id'], expected['icc_id'])
            self.assertEqual(checked['icc_data']['current_cartons'], 1)

    def test_positive_integer_quantity_and_complete_identity_are_required(self):
        for quantity in (0, -1, 1.5, True, None, '1.5'):
            with self.subTest(quantity=quantity):
                self.assertEqual(self.submit(cartons_count=quantity).status_code, 400)
        for field, value in [('type','unknown'),('icc_code','123'),('icc_code','ABCD'),
                             ('total_cartons',0),('total_cartons',1.5),('total_cartons',True),
                             ('location_code','JP'),('location_code','JP-AA')]:
            identity = self.identity(); identity[field] = value
            with self.subTest(field=field,value=value):
                self.assertEqual(self.submit(identity).status_code, 400)
        self.assertEqual(self.submit(pallet_number='').status_code, 400)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM icc_codes')[0]['n'], 0)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM pallets')[0]['n'], 0)

    def test_closed_paused_presort_and_disallowed_types_reject_writes(self):
        for task in (3,4,5,6):
            identity = self.identity(); identity['sort_id'] = task
            with self.subTest(task=task):
                self.assertIn(self.submit(identity).status_code, (400,409))
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM icc_codes')[0]['n'], 0)

    def test_retry_is_idempotent_and_a_different_request_cannot_reuse_its_token(self):
        payload = self.payload()
        first = self.success(self.client.post('/api/sort/submit', json=payload))
        second = self.success(self.client.post('/api/sort/submit', json=payload))
        self.assertEqual(first['icc_id'], second['icc_id'])
        self.assertEqual(second['current_cartons'], 1)
        modified = dict(payload, cartons_count=2)
        self.assertIn(self.client.post('/api/sort/submit', json=modified).status_code, (400,409))
        self.assertIn(self.client_for(2).post('/api/sort/submit', json=payload).status_code, (400,409))
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'], 1)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=1')[0]['total_cartons'], 1)

    def test_completed_product_requires_explicit_new_batch_and_its_pallet_can_close(self):
        identity = self.identity(); identity['total_cartons'] = 2
        first = self.success(self.submit(identity, cartons_count=2))
        self.assertTrue(first['is_completed'])
        self.assertEqual(self.client.post('/api/sort/check', json=identity).get_json()['status'], 'completed')
        self.assertEqual(self.submit(identity).status_code, 409)
        closed = self.client.post('/api/sort/pallet/close', json={'sort_id':1,'icc_id':first['icc_id'],'pallet_id':first['pallet_id']})
        self.assertEqual(closed.status_code, 200)
        second = self.success(self.submit(identity, force_new=True, pallet_number='SORT-2'))
        self.assertNotEqual(first['icc_id'], second['icc_id'])
        self.assertEqual(second['current_cartons'], 1)

    def test_pallet_close_does_not_touch_other_users_or_sorts(self):
        saved = self.success(self.submit())
        payload = {'sort_id':1,'icc_id':saved['icc_id'],'pallet_id':saved['pallet_id']}
        self.assertIn(self.client_for(2).post('/api/sort/pallet/close', json=payload).status_code, (400,403,404,409))
        self.assertIn(self.client.post('/api/sort/pallet/close', json=dict(payload,sort_id=2)).status_code, (400,403,404,409))
        self.assertEqual(self.rows('SELECT is_closed FROM pallets')[0]['is_closed'], 0)
        self.assertEqual(self.client.post('/api/sort/pallet/close', json=payload).status_code, 200)
        self.assertEqual(self.rows('SELECT is_closed FROM pallets')[0]['is_closed'], 1)

    def test_each_user_has_their_own_open_pallet_for_the_same_product(self):
        first = self.success(self.submit())
        second = self.success(self.submit(client=self.client_for(2), pallet_number='SORT-2'))
        self.assertEqual(first['icc_id'], second['icc_id'])
        self.assertNotEqual(first['pallet_id'], second['pallet_id'])
        self.assertEqual(second['current_cartons'], 2)
        for user, expected in [(1,first),(2,second)]:
            checked = self.client_for(user).post('/api/sort/check', json=self.identity()).get_json()
            self.assertEqual(checked['open_pallet']['id'], expected['pallet_id'])

    def test_mix_has_no_pack_limit_and_uses_the_full_code(self):
        identity = dict(sort_id=1,type='mix',icc_code='D980989',total_cartons=0,location_code='')
        first = self.success(self.submit(identity,cartons_count=50))
        self.assertEqual(first['total_cartons'], 0)
        self.assertFalse(first['is_completed'])
        second = self.success(self.submit(identity,cartons_count=50))
        self.assertEqual(second['current_cartons'], 100)
        other = dict(identity,icc_code='D980289')
        self.assertEqual(self.client.post('/api/sort/check',json=other).get_json()['status'],'new')

    def test_log_failure_rolls_back_new_icc_pallet_counters_and_statistics(self):
        with closing(self.db.get_connection()) as conn:
            conn.executescript("CREATE TRIGGER audit_fail_log BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT,'test log failure'); END;")
        self.app.config['PROPAGATE_EXCEPTIONS'] = False
        response = self.submit(cartons_count=5)
        self.assertGreaterEqual(response.status_code,400)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM icc_codes')[0]['n'],0)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM pallets')[0]['n'],0)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=1')[0]['total_cartons'],0)

    def test_statistics_failure_rolls_back_existing_pallet_and_icc(self):
        saved = self.success(self.submit())
        with closing(self.db.get_connection()) as conn:
            conn.executescript("CREATE TRIGGER audit_fail_stats BEFORE UPDATE OF total_cartons ON users BEGIN SELECT RAISE(ABORT,'test stats failure'); END;")
        self.app.config['PROPAGATE_EXCEPTIONS'] = False
        response = self.submit(cartons_count=5)
        self.assertGreaterEqual(response.status_code,400)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes WHERE id=?',(saved['icc_id'],))[0]['current_cartons'],1)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets WHERE id=?',(saved['pallet_id'],))[0]['cartons_count'],1)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=1')[0]['total_cartons'],1)

    def test_two_simultaneous_submissions_create_one_icc_and_one_open_pallet(self):
        payloads = [self.payload(),self.payload()]
        def submit(payload):
            response = self.client_for(1).post('/api/sort/submit',json=payload)
            return response.status_code,response.get_json()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit,payloads))
        self.assertTrue(all(status in (200,201) for status,_ in results),results)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM icc_codes')[0]['n'],1)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM pallets')[0]['n'],1)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],2)

    def test_over_pack_is_rejected_without_partial_updates(self):
        first = self.success(self.submit(cartons_count=29))
        rejected = self.submit(cartons_count=2)
        self.assertEqual(rejected.status_code,409)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes WHERE id=?',(first['icc_id'],))[0]['current_cartons'],29)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets WHERE id=?',(first['pallet_id'],))[0]['cartons_count'],29)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=1')[0]['total_cartons'],29)

    def test_force_new_does_not_duplicate_an_unfinished_product(self):
        first = self.success(self.submit())
        second = self.success(self.submit(force_new=True))
        self.assertEqual(first['icc_id'],second['icc_id'])
        self.assertEqual(second['current_cartons'],2)

    def test_confirmed_save_can_be_retried_after_task_was_closed(self):
        payload = self.payload()
        first = self.success(self.client.post('/api/sort/submit',json=payload))
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='closed' WHERE id=1")
            conn.commit()
        repeated = self.success(self.client.post('/api/sort/submit',json=payload))
        self.assertEqual(repeated['current_cartons'],first['current_cartons'])
        self.assertTrue(repeated['repeated'])

    def test_wrong_open_pallet_is_not_silently_accepted(self):
        first = self.success(self.submit(pallet_number='P1'))
        self.assertEqual(self.submit(pallet_number='P2').status_code,409)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],1)
        self.client.post('/api/sort/pallet/close',json={'sort_id':1,'icc_id':first['icc_id'],'pallet_id':first['pallet_id']})
        next_pallet = self.success(self.submit(pallet_number='P2'))
        self.assertNotEqual(next_pallet['pallet_id'],first['pallet_id'])
        self.assertEqual(next_pallet['current_cartons'],2)

    def test_simultaneous_last_cartons_do_not_overfill_pack(self):
        identity = self.identity(total_cartons=1)
        payloads = [self.payload(identity),self.payload(identity)]
        def submit(payload):
            return self.client_for(1).post('/api/sort/submit',json=payload).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(submit,payloads))
        self.assertEqual(sorted(statuses),[201,409])
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM icc_codes')[0]['n'],1)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],1)

    def test_simultaneous_retries_count_exactly_once(self):
        payload = self.payload()
        def submit(_):
            return self.client_for(1).post('/api/sort/submit',json=payload).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(submit,range(2)))
        self.assertEqual(sorted(statuses),[200,201])
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],1)
        self.assertEqual(self.rows('SELECT COUNT(*) n FROM sort_operations')[0]['n'],1)

    def test_retry_of_old_pallet_close_does_not_close_the_next_pallet(self):
        first = self.success(self.submit(pallet_number='A'))
        close_first = {'sort_id':1,'icc_id':first['icc_id'],'pallet_id':first['pallet_id']}
        self.assertEqual(self.client.post('/api/sort/pallet/close',json=close_first).status_code,200)
        second = self.success(self.submit(pallet_number='B'))
        self.assertEqual(first['icc_id'],second['icc_id'])
        self.assertNotEqual(first['pallet_id'],second['pallet_id'])
        self.assertEqual(self.client.post('/api/sort/pallet/close',json=close_first).status_code,200)
        pallets = self.rows('SELECT id,is_closed FROM pallets ORDER BY id')
        self.assertEqual(pallets,[{'id':first['pallet_id'],'is_closed':1},{'id':second['pallet_id'],'is_closed':0}])
        checked = self.client.post('/api/sort/check',json=self.identity()).get_json()
        self.assertEqual(checked['open_pallet']['id'],second['pallet_id'])

    def test_close_requires_a_specific_valid_pallet_id(self):
        saved = self.success(self.submit())
        payload = {'sort_id':1,'icc_id':saved['icc_id']}
        self.assertEqual(self.client.post('/api/sort/pallet/close',json=payload).status_code,400)
        self.assertEqual(self.client.post('/api/sort/pallet/close',json=dict(payload,pallet_id=999)).status_code,404)
        self.assertEqual(self.rows('SELECT is_closed FROM pallets')[0]['is_closed'],0)

    def test_closing_sort_is_atomic_and_does_not_close_other_sort_pallets(self):
        from sorting import close_sort_job
        first = self.success(self.submit())
        second = self.success(self.submit(client=self.client_for(2),pallet_number='WORKER-2'))
        other = self.success(self.submit(self.identity(sort_id=2),pallet_number='OTHER-SORT'))
        with closing(self.db.get_connection()) as conn:
            conn.executescript("CREATE TRIGGER audit_fail_close BEFORE UPDATE OF is_closed ON pallets BEGIN SELECT RAISE(ABORT,'test close failure'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            close_sort_job(self.db,1)
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=1')[0]['status'],'active')
        self.assertTrue(all(row['is_closed']==0 for row in self.rows('SELECT is_closed FROM pallets')))
        with closing(self.db.get_connection()) as conn:
            conn.execute('DROP TRIGGER audit_fail_close')
            conn.commit()
        close_sort_job(self.db,1)
        states = {row['id']:row['is_closed'] for row in self.rows('SELECT id,is_closed FROM pallets')}
        self.assertEqual(states[first['pallet_id']],1)
        self.assertEqual(states[second['pallet_id']],1)
        self.assertEqual(states[other['pallet_id']],0)
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=1')[0]['status'],'closed')
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=2')[0]['status'],'active')

    def test_own_pallet_can_be_closed_while_its_sort_is_paused(self):
        saved = self.success(self.submit())
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='paused' WHERE id=1")
            conn.commit()
        response = self.client.post('/api/sort/pallet/close',json={
            'sort_id':1,'icc_id':saved['icc_id'],'pallet_id':saved['pallet_id']})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.rows('SELECT is_closed FROM pallets')[0]['is_closed'],1)


if __name__ == '__main__':
    unittest.main()
