"""Exercise real Flask routes against an isolated, disposable warehouse database."""
import importlib.util
import os
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from database import Database


class ApiRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Database(os.path.join(self.temp.name, 'api-regression.db'))
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                CREATE TABLE containers (
                    id INTEGER PRIMARY KEY,container_number TEXT UNIQUE,status TEXT DEFAULT 'active',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,completed_at TEXT
                );
                CREATE TABLE user_container_sessions (
                    id INTEGER PRIMARY KEY,user_id INTEGER,container_id INTEGER,sort_id INTEGER,
                    is_active INTEGER DEFAULT 1,started_at TEXT DEFAULT CURRENT_TIMESTAMP,ended_at TEXT
                );
                INSERT INTO users(id,username,password,role) VALUES(2,'worker','test-only','user');
            ''')
        spec = importlib.util.spec_from_file_location('api_regression_app_' + uuid4().hex,
                                                     Path(__file__).with_name('app.py'))
        self.module = importlib.util.module_from_spec(spec)
        # This replacement is active before app.py executes Database(): its initialization,
        # automatic migrations and every route all receive only the temporary database.
        with patch('database.Database', return_value=self.db):
            spec.loader.exec_module(self.module)
        self.app = self.module.app
        self.app.testing = True
        self.client = self.client_for(1)
        self.worker = self.client_for(2)
        with closing(self.db.get_connection()) as conn:
            conn.executescript('''
                INSERT INTO sorts(id,name,type,unload_date,mode,status,created_by) VALUES
                    (1,'Rampa 1','single,mix,vevor','2026-10-25','sort','active',1),
                    (2,'Rampa 2','single,mix,vevor','2026-10-25','sort','active',1),
                    (3,'Rampa 3','single,mix','2026-10-25','presort','closed',1);
                INSERT INTO containers(id,container_number) VALUES(1,'SOURCE-3');
                INSERT INTO presort_jobs(sort_id,container_id) VALUES(3,1);
            ''')

    def client_for(self, user_id):
        client = self.app.test_client()
        with client.session_transaction() as session:
            session['user_id'] = user_id
        return client

    def identity(self, sort_id=1):
        return dict(sort_id=sort_id,type='single',icc_code='4567',total_cartons=30,location_code='JP-A')

    def submit(self, sort_id=1, client=None, number='SORT-1'):
        payload = self.identity(sort_id)
        payload.update(cartons_count=1,pallet_number=number,request_id=str(uuid4()))
        response = (client or self.client).post('/api/sort/submit',json=payload)
        self.assertEqual(response.status_code,201,response.get_json())
        return response.get_json()

    def rows(self, query, params=()):
        with closing(self.db.get_connection()) as conn:
            return [dict(row) for row in conn.execute(query,params)]

    def test_legacy_mutations_without_scope_do_not_write(self):
        payload = dict(icc_code='4567',type='single',total_cartons=30,location_code='JP-A',
                       cartons_count=4,pallet_number='LEGACY-1')
        for endpoint in ('/api/icc/create','/api/pallet/add','/api/pallet/close'):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.post(endpoint,json=payload).status_code,400)
        for table in ('icc_codes','pallets','activity_log','sort_operations'):
            self.assertEqual(self.rows('SELECT COUNT(*) count FROM '+table)[0]['count'],0)
        self.assertEqual(self.rows('SELECT total_cartons FROM users WHERE id=1')[0]['total_cartons'],0)

    def test_legacy_check_delegates_to_task_scoped_check(self):
        saved = self.submit()
        same = self.client.post('/api/icc/check',json=self.identity())
        other = self.client.post('/api/icc/check',json=self.identity(2))
        self.assertEqual(same.status_code,200)
        self.assertEqual(same.get_json()['status'],'exists')
        self.assertEqual(same.get_json()['icc_data']['id'],saved['icc_id'])
        self.assertEqual(other.status_code,200)
        self.assertEqual(other.get_json()['status'],'new')
        self.assertEqual(self.rows('SELECT COUNT(*) count FROM icc_codes')[0]['count'],1)

    def test_admin_user_responses_do_not_expose_password_hashes(self):
        self.submit(client=self.worker)
        users_response = self.client.get('/api/admin/users')
        self.assertEqual(users_response.status_code,200)
        users = users_response.get_json()
        self.assertTrue(users)
        self.assertTrue(all('password' not in user for user in users))
        pallets_response = self.client.get('/api/lider/pallets')
        self.assertEqual(pallets_response.status_code,200)
        pallets = pallets_response.get_json()
        self.assertEqual(len(pallets),1)
        self.assertEqual(pallets[0]['user']['username'],'worker')
        self.assertNotIn('password',pallets[0]['user'])

    def test_admin_task_list_marks_a_presort_source_after_conversion(self):
        response = self.client.post('/api/sorts/3/convert-to-sort')
        self.assertEqual(response.status_code,200)
        listed = self.client.get('/api/sorts/all')
        self.assertEqual(listed.status_code,200)
        indexed = {row['id']:row for row in listed.get_json()}
        self.assertTrue(indexed[3]['has_presort_source'])
        self.assertEqual(indexed[3]['mode'],'sort')
        self.assertFalse(indexed[1]['has_presort_source'])
        self.assertFalse(indexed[2]['has_presort_source'])

    def test_source_metadata_distinguishes_absent_and_empty_sources(self):
        absent = self.worker.get('/api/sorts/1/presort-items').get_json()
        self.assertEqual(absent['items'],[])
        self.assertFalse(absent['has_source'])
        self.assertIsNone(absent['source_name'])
        self.assertEqual(self.client.post('/api/sorts/3/convert-to-sort').status_code,200)
        empty = self.worker.get('/api/sorts/3/presort-items').get_json()
        self.assertEqual(empty['items'],[])
        self.assertTrue(empty['has_source'])
        self.assertEqual(empty['source_name'],'Rampa 3')

    def test_admin_closing_sort_closes_only_its_pallets(self):
        self.submit()
        self.submit(client=self.worker,number='WORKER-1')
        other = self.submit(sort_id=2,number='SORT-2')
        response = self.client.put('/api/sorts/1/status',json={'status':'closed'})
        self.assertEqual(response.status_code,200,response.get_json())
        pallets = self.rows('''SELECT p.id,p.is_closed,p.closed_at,i.sort_id FROM pallets p
            JOIN icc_codes i ON i.id=p.icc_code_id ORDER BY p.id''')
        self.assertEqual(len(pallets),3)
        self.assertTrue(all(p['is_closed']==1 and p['closed_at'] for p in pallets if p['sort_id']==1))
        remaining = next(p for p in pallets if p['id']==other['pallet_id'])
        self.assertEqual(remaining['is_closed'],0)
        self.assertIsNone(remaining['closed_at'])
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=1')[0]['status'],'closed')
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=2')[0]['status'],'active')

    def test_deleting_sort_with_sorted_items_preserves_its_accounting(self):
        saved = self.submit()
        response = self.client.delete('/api/sorts/1?confirm=true')
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.rows('SELECT COUNT(*) count FROM sorts WHERE id=1')[0]['count'],1)
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=1')[0]['status'],'deleted')
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes WHERE id=?',(saved['icc_id'],))[0]['current_cartons'],1)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets WHERE id=?',(saved['pallet_id'],))[0]['cartons_count'],1)
        self.assertEqual(self.client.get('/api/sorts/1').status_code,404)
        self.assertNotIn(1,[s['id'] for s in self.client.get('/api/sorts/all').get_json()])
        self.assertNotIn(1,[s['id'] for s in self.worker.get('/api/sorts').get_json()])
        self.assertEqual(self.client.delete('/api/sorts/1?confirm=true').status_code,200)
        self.assertEqual(len(self.rows("SELECT id FROM activity_log WHERE action='delete_sort'")),1)
        self.assertEqual(self.client.put('/api/sorts/1/status',json={'status':'active'}).status_code,404)
        self.assertEqual(self.client.put('/api/sorts/1',json={'name':'Restored'}).status_code,404)

    def test_delete_requires_admin_and_explicit_yes_and_accepts_every_task_status(self):
        self.assertEqual(self.app.test_client().delete('/api/sorts/1?confirm=true').status_code,401)
        self.assertEqual(self.worker.delete('/api/sorts/1?confirm=true').status_code,403)
        for confirmation in ('','?confirm=false','?confirm=0'):
            self.assertEqual(self.client.delete('/api/sorts/1'+confirmation).status_code,400)
        self.assertEqual(self.client.get('/api/sorts/1').get_json()['status'],'active')
        for status in ('active','paused','closed'):
            with closing(self.db.get_connection()) as conn:
                sid=conn.execute("INSERT INTO sorts(name,type,unload_date,status,mode) VALUES('Delete test','single','2026-10-31',?,'sort')",(status,)).lastrowid
                conn.commit()
            self.assertEqual(self.client.delete(f'/api/sorts/{sid}?confirm=true').status_code,200)
            self.assertEqual(self.client.get(f'/api/sorts/{sid}').status_code,404)
        self.assertEqual(self.client.delete('/api/sorts/99999?confirm=true').status_code,404)

    def test_deletion_failure_rolls_back_task_pallets_and_log(self):
        saved=self.submit()
        with closing(self.db.get_connection()) as conn:
            conn.execute("CREATE TRIGGER fail_delete_log BEFORE INSERT ON activity_log WHEN NEW.action='delete_sort' BEGIN SELECT RAISE(ABORT,'test deletion failure'); END")
            conn.commit()
        import sqlite3
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.delete('/api/sorts/1?confirm=true')
        self.assertEqual(self.client.get('/api/sorts/1').get_json()['status'],'active')
        self.assertEqual(self.rows('SELECT is_closed FROM pallets WHERE id=?',(saved['pallet_id'],))[0]['is_closed'],0)

    def test_deleted_user_sessions_are_rejected_without_server_errors(self):
        with closing(self.db.get_connection()) as conn:
            conn.execute('DELETE FROM users WHERE id=2')
            conn.commit()
        for endpoint in ('/api/stats','/api/sorts','/api/admin/users','/api/lider/pallets','/api/sorts/all'):
            with self.subTest(endpoint=endpoint):
                response = self.client_for(2).get(endpoint)
                self.assertIn(response.status_code,(401,403),response.get_json())
        payload = dict(self.identity(),cartons_count=1,pallet_number='NO-USER',request_id=str(uuid4()))
        for endpoint in ('/api/sort/submit','/api/pallet/add'):
            with self.subTest(endpoint=endpoint):
                response = self.client_for(2).post(endpoint,json=payload)
                self.assertEqual(response.status_code,401,response.get_json())
        self.assertEqual(self.rows('SELECT COUNT(*) count FROM pallets')[0]['count'],0)


    def test_bad_json_and_invalid_credentials_are_client_errors(self):
        for endpoint in ('/login','/register','/api/sorts','/api/admin/create_account'):
            for value in (None,[],42,'text'):
                response=self.client.post(endpoint,data=__import__('json').dumps(value),content_type='application/json')
                self.assertEqual(response.status_code,400,(endpoint,value,response.get_json()))
        for endpoint in ('/login','/register','/api/admin/create_account'):
            for payload in ({'username':[],'password':'1234'},{'username':'worker','password':{}},{'username':'  ','password':'1234'}):
                self.assertEqual(self.client.post(endpoint,json=payload).status_code,400)

    def test_expired_html_pages_redirect_to_login_but_api_keeps_401(self):
        anonymous=self.app.test_client()
        for endpoint in ('/dashboard','/admin','/lider','/test_ocr_images'):
            response=anonymous.get(endpoint)
            self.assertEqual(response.status_code,302)
            self.assertEqual(response.headers['Location'],'/')
        self.assertEqual(anonymous.get('/api/sorts').status_code,401)

    def test_task_creation_rejects_unusable_types_and_invalid_dates(self):
        payload=dict(name='Rampa 1',type='single',unload_date='2026-10-31',description='')
        for changes in ({'type':'zone'},{'type':'single,unknown'},{'name':[]},{'description':{}},{'unload_date':'2026-99-31'}):
            response=self.client.post('/api/sorts',json=dict(payload,**changes))
            self.assertEqual(response.status_code,400,response.get_json())
        self.assertEqual(self.client.put('/api/containers/99999/status',json={'status':'active'}).status_code,404)
        self.assertEqual(self.client.post('/api/containers',json={'container_number':[]}).status_code,400)
        self.assertEqual(self.client.post('/api/container/select',json={'container_id':{}}).status_code,400)
        self.assertEqual(self.client.put('/api/sorts/1',json={'name':[]}).status_code,400)

    def test_legacy_edit_and_delete_cannot_desynchronize_scoped_stock(self):
        saved=self.submit()
        before=self.rows('SELECT * FROM inventory_movements ORDER BY id')
        response=self.client.put(f'/api/admin/icc/{saved["icc_id"]}',json=dict(total_cartons=30,current_cartons=0,location_code='JP-A'))
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.client.delete(f'/api/admin/icc/{saved["icc_id"]}').status_code,409)
        self.assertEqual(self.rows('SELECT * FROM inventory_movements ORDER BY id'),before)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],1)

    def test_legacy_counts_are_validated_and_unknown_records_are_404(self):
        with closing(self.db.get_connection()) as conn:
            iid=conn.execute("INSERT INTO icc_codes(icc_code,type,total_cartons,last_4_digits) VALUES('legacy-test','single',3,'1234')").lastrowid
            conn.commit()
        for current,total in [(-1,3),(1.5,3),(True,3),(4,3),(1,None)]:
            self.assertEqual(self.client.put(f'/api/admin/icc/{iid}',json={'current_cartons':current,'total_cartons':total}).status_code,400)
        self.assertEqual(self.client.put('/api/admin/icc/99999',json={'current_cartons':1,'total_cartons':3}).status_code,404)


if __name__ == '__main__':
    unittest.main()
