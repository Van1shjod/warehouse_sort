"""Inventory integrity checks use a temporary database, never warehouse.db."""
import os
import importlib.util
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from uuid import uuid4
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from database import Database
from presort import register_presort, create_presort_job, close_presort_job


class PresortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(os.path.join(self.temp.name, 'test.db'))
        conn = self.db.get_connection()
        conn.executescript('''
            CREATE TABLE containers (id INTEGER PRIMARY KEY, container_number TEXT,
                status TEXT, created_at TEXT);
            INSERT INTO containers VALUES(1,'TEST-A','active','2026-01-01');
            INSERT INTO containers VALUES(2,'TEST-B','active','2026-01-01');
            INSERT INTO users(id,username,password,role) VALUES(2,'worker','unused','user');
        ''')
        conn.close()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-only'
        self.app.testing = True
        register_presort(self.app, self.db)
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                INSERT INTO sorts(id,name,type,unload_date,mode) VALUES
                    (1,'Zona Single A','single,mix,vevor','2026-10-22','presort'),
                    (2,'Rampa 1','single,mix,vevor','2026-10-22','presort');
                INSERT INTO presort_jobs VALUES(1,1),(2,2);
            ''')
        self.client = self.client_for(1)

    def tearDown(self):
        self.temp.cleanup()

    def client_for(self, user_id):
        client = self.app.test_client()
        with client.session_transaction() as session:
            session['user_id'] = user_id
        return client

    def open(self, container=1, client=None):
        return (client or self.client).post('/api/presort/pallets', json={'container_id': container}).get_json()

    def scan(self, pallet_id, **values):
        return dict(pallet_id=pallet_id, type='single', code='4567', location='JP-A',
                    pack=30, request_id=str(uuid4()), **values)

    def inventory(self, container=1):
        return self.client.get(f'/api/presort/inventory?container_id={container}').get_json()

    def test_mixed_pallets_search_and_container_isolation(self):
        first = self.open()
        self.client.post('/api/presort/scans', json=self.scan(first['id']))
        different = self.scan(first['id']); different['pack'] = 40
        self.client.post('/api/presort/scans', json=different)
        self.client.post(f"/api/presort/pallets/{first['id']}/close")
        second = self.open()
        self.client.post('/api/presort/scans', json=self.scan(second['id']))
        data = self.inventory()
        self.assertEqual([p['number'] for p in data['pallets']], [1, 2])
        self.assertEqual([i['number'] for i in data['items'] if i['pack'] == 30], [1, 2])
        self.assertEqual(len(data['items']), 3)
        self.assertEqual(self.open(2)['number'], 1)
        self.assertEqual(self.inventory(2)['items'], [])

    def test_network_retry_is_idempotent_even_after_close(self):
        pallet = self.open(); payload = self.scan(pallet['id'])
        for _ in range(2):
            self.assertIn(self.client.post('/api/presort/scans', json=payload).status_code, (200, 201))
        self.client.post(f"/api/presort/pallets/{pallet['id']}/close")
        self.assertEqual(self.client.post('/api/presort/scans', json=payload).status_code, 200)
        self.assertEqual(self.inventory()['items'][0]['cartons'], 1)
        payload['pack'] = 99
        self.assertEqual(self.client.post('/api/presort/scans', json=payload).status_code, 400)

    def test_closed_and_foreign_pallets_are_protected(self):
        pallet = self.open(); other = self.client_for(2)
        self.assertEqual(other.post('/api/presort/scans', json=self.scan(pallet['id'])).status_code, 400)
        self.assertEqual(other.post(f"/api/presort/pallets/{pallet['id']}/close").status_code, 400)
        self.client.post(f"/api/presort/pallets/{pallet['id']}/close")
        self.assertEqual(self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).status_code, 400)

    def test_undo_only_latest_and_preserves_history(self):
        pallet = self.open()
        a = self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).get_json()['id']
        b = self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).get_json()['id']
        self.assertEqual(self.client.post(f'/api/presort/scans/{a}/undo').status_code, 400)
        self.assertEqual(self.client.post(f'/api/presort/scans/{b}/undo').status_code, 200)
        self.assertEqual(self.inventory()['items'][0]['cartons'], 1)
        with closing(self.db.get_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM presort_scans').fetchone()[0], 2)

    def test_simultaneous_workers_receive_distinct_numbers(self):
        def open_for(user_id):
            return self.open(client=self.client_for(user_id))['number']
        with ThreadPoolExecutor(max_workers=2) as pool:
            numbers = list(pool.map(open_for, [1, 2]))
        self.assertEqual(sorted(numbers), [1, 2])
        self.assertEqual(len(self.inventory()['pallets']), 2)
        self.open()
        self.assertEqual(len(self.inventory()['pallets']), 2)

    def test_validation_and_paused_container(self):
        pallet = self.open(); payload = self.scan(pallet['id'])
        payload['pack'] = 1.5
        self.assertEqual(self.client.post('/api/presort/scans', json=payload).status_code, 400)
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='paused' WHERE id=1")
            conn.commit()
        self.assertEqual(self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).status_code, 400)
        self.assertEqual(self.client.post('/api/presort/pallets', json={'container_id':1}).status_code, 400)

    def test_auth_and_page(self):
        self.assertEqual(self.app.test_client().get('/presort').status_code, 302)
        self.assertEqual(self.app.test_client().get('/api/presort/containers').status_code, 401)
        self.assertEqual(self.client.get('/presort').status_code, 200)
        self.assertEqual(self.client.get('/api/presort/containers').status_code, 200)
        self.assertEqual(self.client.get('/api/presort/inventory?container_id=bad').status_code, 400)

    def test_only_registered_presort_can_receive_pallets(self):
        with closing(self.db.get_connection()) as conn:
            conn.execute("INSERT INTO containers VALUES(3,'NORMAL','active','2026-10-22')")
            conn.commit()
        self.assertEqual(self.client.post('/api/presort/pallets', json={'container_id': 3}).status_code, 400)

    def test_named_job_metadata_types_and_closed_state(self):
        job_id = create_presort_job(self.db, 'Rampa 3', 'mix', '2026-10-23', 'MIX only', 1)
        jobs = self.client.get('/api/presort/containers').get_json()
        job = next(row for row in jobs if row['sort_id'] == job_id)
        self.assertEqual(job['container_number'], 'Rampa 3')
        self.assertEqual(job['description'], 'MIX only')
        pallet = self.open(job['id'])
        self.assertEqual(self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).status_code, 400)
        payload = self.scan(pallet['id']); payload['type'] = 'mix'; payload['code'] = 'D980989'
        self.assertEqual(self.client.post('/api/presort/scans', json=payload).status_code, 201)
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='closed' WHERE id=?", (job_id,))
            conn.commit()
        self.assertEqual(self.client.post('/api/presort/pallets', json={'container_id': job['id']}).status_code, 400)
        self.assertEqual(self.inventory(job['id'])['items'][0]['cartons'], 1)

    def test_real_sort_api_admin_creation_and_worker_selection(self):
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                ALTER TABLE icc_codes ADD COLUMN sort_id INTEGER;
                CREATE TABLE user_container_sessions(user_id INTEGER,sort_id INTEGER,
                    container_id INTEGER,is_active INTEGER,started_at TEXT);
            ''')
        spec = importlib.util.spec_from_file_location('presort_integration_app', Path(__file__).with_name('app.py'))
        module = importlib.util.module_from_spec(spec)
        with patch('database.Database', return_value=self.db):
            spec.loader.exec_module(module)
        module.app.testing = True
        admin, worker = module.app.test_client(), module.app.test_client()
        for client, user_id in [(admin, 1), (worker, 2)]:
            with client.session_transaction() as session:
                session['user_id'] = user_id
        payload = dict(mode='presort',name='Zona Mix B',type='single,mix',
                       unload_date='2026-10-23',description='Unload')
        self.assertEqual(admin.get('/admin').status_code, 200)
        self.assertEqual(worker.post('/api/sorts', json=payload).status_code, 403)
        self.assertEqual(module.app.test_client().post('/api/sorts', json=payload).status_code, 401)
        result = admin.post('/api/sorts', json=payload)
        self.assertEqual(result.status_code, 200)
        sort_id = result.get_json()['sort_id']
        listed = worker.get('/api/sorts').get_json()
        selected = next(row for row in listed if row['id'] == sort_id)
        self.assertEqual(selected['mode'], 'presort')
        regular_list = worker.get('/api/sorts?mode=sort').get_json()
        self.assertTrue(all(row['mode'] == 'sort' for row in regular_list))
        presort_list = worker.get('/api/sorts?mode=presort').get_json()
        self.assertIn(sort_id, [row['id'] for row in presort_list])
        self.assertEqual(worker.get(f'/api/sorts/{sort_id}').get_json()['type'], 'single,mix')
        job = next(row for row in worker.get('/api/presort/containers').get_json() if row['sort_id'] == sort_id)
        response = worker.post('/api/presort/pallets', json={'container_id': job['id']})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(admin.delete(f'/api/sorts/{sort_id}').status_code, 400)
        self.assertEqual(admin.put(f'/api/sorts/{sort_id}/status', json={'status':'closed'}).status_code, 200)
        self.assertEqual(worker.post('/api/presort/pallets', json={'container_id': job['id']}).status_code, 400)
        self.assertEqual(worker.post(f'/api/sorts/{sort_id}/convert-to-sort').status_code, 403)
        self.assertEqual(admin.post(f'/api/sorts/{sort_id}/convert-to-sort').status_code, 200)
        converted = next(row for row in worker.get('/api/sorts?mode=sort').get_json() if row['id'] == sort_id)
        self.assertEqual(converted['name'], 'Zona Mix B')
        self.assertEqual(converted['status'], 'active')
        self.assertEqual(admin.delete(f'/api/sorts/{sort_id}').status_code, 400)
        payload.pop('mode')
        normal = admin.post('/api/sorts', json=payload)
        self.assertEqual(normal.status_code, 200)
        self.assertEqual(worker.get('/api/sorts/' + str(normal.get_json()['sort_id'])).get_json()['mode'], 'sort')
        self.assertEqual(admin.delete(f'/api/sorts/{sort_id}?confirm=true').status_code,200)
        self.assertEqual(worker.get(f'/api/sorts/{sort_id}').status_code,404)
        self.assertEqual(worker.post(f'/api/sorts/{sort_id}/convert-to-sort').status_code,403)
        self.assertEqual(admin.post(f'/api/sorts/{sort_id}/convert-to-sort').status_code,400)

    def test_existing_pallet_is_adopted_once(self):
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                DELETE FROM presort_jobs WHERE container_id=2;
                DELETE FROM sorts WHERE id=2;
                INSERT INTO presort_pallets(container_id,number,user_id) VALUES(2,23,2);
            ''')
        for _ in range(2):
            another = Flask(__name__)
            register_presort(another, self.db)
        with closing(self.db.get_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM presort_jobs WHERE container_id=2').fetchone()[0], 1)
        self.assertEqual(self.inventory(2)['pallets'][0]['number'], 23)

    def test_conversion_requires_admin_and_closed_job_preserves_source(self):
        worker = self.client_for(2)
        url = '/api/sorts/1/convert-to-sort'
        self.assertEqual(self.app.test_client().post(url).status_code, 401)
        self.assertEqual(worker.post(url).status_code, 403)
        self.assertEqual(self.client.post(url).status_code, 400)
        first = self.open()
        self.client.post('/api/presort/scans', json=self.scan(first['id']))
        second = self.open(client=worker)
        worker.post('/api/presort/scans', json=self.scan(second['id']))
        other = self.scan(second['id']); other['pack'] = 40
        worker.post('/api/presort/scans', json=other)
        undone = worker.post('/api/presort/scans', json=self.scan(second['id'])).get_json()['id']
        worker.post(f'/api/presort/scans/{undone}/undo')
        self.assertEqual(worker.get('/api/sorts/1/presort-items').get_json()['items'], [])
        close_presort_job(self.db, 1)
        self.assertTrue(all(p['closed_at'] for p in self.inventory()['pallets']))
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(self.client.post(url).status_code, 200)
        source = worker.get('/api/sorts/1/presort-items').get_json()['items']
        self.assertEqual([(r['number'],r['pack'],r['cartons']) for r in source], [(1,30,1),(2,30,1),(2,40,1)])
        self.assertEqual(worker.get('/api/sorts/2/presort-items').get_json()['items'], [])
        self.assertNotIn(1, [j['sort_id'] for j in worker.get('/api/presort/containers').get_json()])
        self.assertEqual(worker.post('/api/presort/scans', json=self.scan(second['id'])).status_code, 400)
        with closing(self.db.get_connection()) as conn:
            task = conn.execute('SELECT * FROM sorts WHERE id=1').fetchone()
            self.assertEqual((task['mode'],task['status'],task['name']), ('sort','active','Zona Single A'))
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM presort_scans').fetchone()[0], 4)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM activity_log WHERE action='convert_presort'").fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM icc_codes').fetchone()[0], 0)

    def test_admin_scan_archive_survives_close_and_conversion(self):
        endpoint = '/api/admin/presort/jobs'
        worker = self.client_for(2)
        for url in [endpoint, endpoint + '/1/scans', endpoint + '/1/products']:
            self.assertEqual(self.app.test_client().get(url).status_code, 401)
            self.assertEqual(worker.get(url).status_code, 403)
        self.assertEqual(self.client.get(endpoint + '/999/scans').status_code, 404)
        pallet = self.open()
        self.client.post('/api/presort/scans', json=self.scan(pallet['id']))
        undone = self.client.post('/api/presort/scans', json=self.scan(pallet['id'])).get_json()['id']
        self.client.post(f'/api/presort/scans/{undone}/undo')
        second = self.open(client=worker)
        payload = self.scan(second['id']); payload.update(type='mix',code='D980989')
        worker.post('/api/presort/scans', json=payload)
        jobs = self.client.get(endpoint).get_json()['jobs']
        summary = next(job for job in jobs if job['id'] == 1)
        self.assertEqual((summary['cartons_count'],summary['undone_count'],summary['pallets_count']), (2,1,2))
        self.assertEqual(next(job for job in jobs if job['id'] == 2)['cartons_count'], 0)
        url = endpoint + '/1/scans'
        initial = self.client.get(url).get_json()
        self.assertEqual(initial['total'], 2)
        self.assertEqual({row['username'] for row in initial['scans']}, {'admin','worker'})
        self.assertEqual(self.client.get(url + '?scan_status=all').get_json()['total'], 3)
        close_presort_job(self.db, 1)
        self.assertEqual(self.client.get(url).get_json()['job']['status'], 'closed')
        self.client.post('/api/sorts/1/convert-to-sort')
        converted = self.client.get(url).get_json()
        self.assertEqual(converted['job']['mode'], 'sort')
        self.assertEqual([row['id'] for row in converted['scans']], [row['id'] for row in initial['scans']])
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET status='closed' WHERE id=1")
            conn.commit()
        archived = next(job for job in self.client.get(endpoint).get_json()['jobs'] if job['id'] == 1)
        self.assertEqual((archived['mode'],archived['status'],archived['cartons_count']), ('sort','closed',2))

    def test_admin_scan_filters_and_literal_search(self):
        pallet = self.open()
        for pack in (30,40):
            payload = self.scan(pallet['id']); payload['pack'] = pack
            self.client.post('/api/presort/scans', json=payload)
        url = '/api/admin/presort/jobs/1/scans'
        self.assertEqual(self.client.get(url + '?q=4567+JP-A+30').get_json()['total'], 1)
        self.assertEqual(self.client.get(url + '?type=mix').get_json()['total'], 0)
        self.assertEqual(self.client.get(url + '?q=admin').get_json()['total'], 2)
        self.assertEqual(self.client.get(url + '?q=%25').get_json()['total'], 0)
        self.assertEqual(self.client.get(url + '?q=_').get_json()['total'], 0)
        for params in ('page=0','page=no','scan_status=bad','type=unknown'):
            self.assertEqual(self.client.get(url + '?' + params).status_code, 400)
        last = self.client.get(url).get_json()['scans'][0]['id']
        self.client.post(f'/api/presort/scans/{last}/undo')
        cancelled = self.client.get(url + '?scan_status=undone').get_json()
        self.assertEqual(cancelled['total'], 1)
        self.assertEqual(cancelled['scans'][0]['undone'], 1)

    def test_admin_scan_paging_and_deleted_user(self):
        pallet = self.open()
        with closing(self.db.get_connection()) as conn:
            conn.executemany('''INSERT INTO presort_scans
                (pallet_id,user_id,type,code,location,pack,request_id)
                VALUES(?,2,'single','4567','JP-A',30,?)''',
                [(pallet['id'], str(uuid4())) for _ in range(102)])
            conn.execute('DELETE FROM users WHERE id=2')
            conn.commit()
        url = '/api/admin/presort/jobs/1/scans'
        a = self.client.get(url).get_json()
        b = self.client.get(url + '?page=2').get_json()
        self.assertEqual((a['total'],a['pages'],len(a['scans']),len(b['scans'])), (102,2,100,2))
        self.assertTrue(set(row['id'] for row in a['scans']).isdisjoint(row['id'] for row in b['scans']))
        self.assertIsNone(a['scans'][0]['username'])
        self.assertEqual(a['scans'][0]['user_id'], 2)
        self.assertEqual(self.client.get(url + '?page=999').get_json()['page'], 2)

    def test_admin_product_grouping_progress_and_lifecycle(self):
        a = self.open(); worker = self.client_for(2); b = self.open(client=worker)
        self.client.post(f"/api/presort/pallets/{a['id']}/close")
        c = self.open()
        rows = []
        for pallet, amount in [(a,5),(b,4),(c,3)]:
            rows.extend((pallet['id'],1,'single','3245','GZ-A',40,str(uuid4()),0) for _ in range(amount))
        rows.extend([
            (c['id'],1,'single','3245','GZ-A',41,str(uuid4()),0),
            (c['id'],1,'single','3245','GZ-B',40,str(uuid4()),0),
            (c['id'],1,'vevor','3245','GZ-A',40,str(uuid4()),0),
            (c['id'],1,'mix','D980989','',0,str(uuid4()),0),
            (c['id'],1,'single','3245','GZ-A',40,str(uuid4()),1),
        ])
        with closing(self.db.get_connection()) as conn:
            conn.executemany('''INSERT INTO presort_scans
                (pallet_id,user_id,type,code,location,pack,request_id,undone) VALUES(?,?,?,?,?,?,?,?)''', rows)
            conn.commit()
        url = '/api/admin/presort/jobs/1/products'
        response = self.client.get(url).get_json()
        self.assertEqual(response['total'], 5)
        product = next(p for p in response['products'] if p['type']=='single' and p['location']=='GZ-A' and p['pack']==40)
        self.assertEqual((product['cartons'],product['planned'],product['remaining'],product['percent']), (12,40,28,30.0))
        self.assertEqual((product['pallets_count'],product['closed_pallets']), (3,1))
        self.assertEqual([p['cartons'] for p in product['pallets']], [5,4,3])
        mix = next(p for p in response['products'] if p['type']=='mix')
        self.assertIsNone(mix['planned']); self.assertIsNone(mix['percent'])
        self.assertEqual(self.client.get('/api/admin/presort/jobs/2/products').get_json()['total'], 0)
        close_presort_job(self.db,1); self.client.post('/api/sorts/1/convert-to-sort')
        converted = self.client.get(url).get_json()
        self.assertEqual(converted['job']['mode'], 'sort')
        self.assertEqual(sum(p['cartons'] for p in converted['products']), 16)

    def test_admin_product_totals_exceed_pack_and_scan_page_size(self):
        pallet = self.open()
        with closing(self.db.get_connection()) as conn:
            conn.executemany('''INSERT INTO presort_scans
                (pallet_id,user_id,type,code,location,pack,request_id)
                VALUES(?,1,'single','3245','GZ-A',40,?)''', [(pallet['id'],str(uuid4())) for _ in range(101)])
            conn.commit()
        product = self.client.get('/api/admin/presort/jobs/1/products').get_json()['products'][0]
        self.assertEqual((product['cartons'],product['remaining'],product['excess'],product['percent']), (101,0,61,252.5))

    def test_admin_product_search_and_product_paging(self):
        pallet = self.open()
        with closing(self.db.get_connection()) as conn:
            conn.executemany('''INSERT INTO presort_scans
                (pallet_id,user_id,type,code,location,pack,request_id)
                VALUES(?,1,'single',?,'JP-A',40,?)''', [(pallet['id'],f'{n:04}',str(uuid4())) for n in range(102)])
            conn.commit()
        url = '/api/admin/presort/jobs/1/products'
        first = self.client.get(url).get_json(); last = self.client.get(url+'?page=999').get_json()
        self.assertEqual((first['total'],len(first['products']),last['page'],len(last['products'])), (102,100,2,2))
        self.assertTrue({p['code'] for p in first['products']}.isdisjoint(p['code'] for p in last['products']))
        self.assertEqual(self.client.get(url+'?q=0001+JP-A+40pack').get_json()['total'],1)
        self.assertEqual(self.client.get(url+'?q=%25').get_json()['total'],0)
        self.assertEqual(self.client.get(url+'?type=mix').get_json()['total'],0)
        self.assertEqual(self.client.get(url+'?type=invalid').status_code,400)
        self.assertEqual(self.client.get('/api/admin/presort/jobs/999/products').status_code,404)


if __name__ == '__main__':
    unittest.main()
