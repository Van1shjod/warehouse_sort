"""Guided collection accounting, tested only on disposable databases."""
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from uuid import uuid4

import test_api_regressions


class CollectionTests(unittest.TestCase):
    def setUp(self):
        fixture = test_api_regressions.ApiRegressionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.db, self.app, self.client, self.worker = fixture.db, fixture.app, fixture.client, fixture.worker
        self.client_for = fixture.client_for
        with closing(self.db.get_connection()) as conn:
            conn.execute("INSERT INTO containers(id,container_number) VALUES(2,'COLLECTION-SOURCE')")
            conn.execute('INSERT INTO presort_jobs VALUES(1,2)')
            for number in (1,4,10):
                conn.execute("INSERT INTO presort_pallets(id,container_id,number,user_id,closed_at) VALUES(?,2,?,1,CURRENT_TIMESTAMP)", (number, number))
            from inventory_migration import record_presort_scan
            for number, kind, code, location, pack in [(1,'single','4567','JP-A',3),(1,'single','4567','JP-A',3),(4,'single','4567','JP-A',3),(10,'mix','D980989','',0)]:
                scan = conn.execute('INSERT INTO presort_scans(pallet_id,user_id,type,code,location,pack,request_id) VALUES(?,1,?,?,?,?,?)', (number,kind,code,location,pack,str(uuid4()))).lastrowid
                record_presort_scan(conn,scan)
            conn.commit()
        self.identity = dict(sort_id=1,type='single',icc_code='4567',location_code='JP-A',total_cartons=3)

    def success(self,response):
        self.assertIn(response.status_code,(200,201),response.get_json())
        return response.get_json()

    def resolve(self,identity=None):
        return self.success(self.client.post('/api/collection/resolve',json=identity or self.identity))

    def payload(self,source='1',identity=None):
        card = self.resolve(identity)
        p = next(p for p in card['pallets'] if p['pallet_number']==source)
        return dict(identity or self.identity, pack_id=card['pack']['id'],source_pallet_id=p['id'],source_number=source,request_id=str(uuid4()))

    def rows(self,sql,args=()):
        with closing(self.db.get_connection()) as conn:
            return [dict(r) for r in conn.execute(sql,args)]

    def test_resolve_is_stable_and_does_not_move_stock(self):
        first,second=self.resolve(),self.resolve()
        self.assertEqual(first['pack']['id'],second['pack']['id'])
        self.assertEqual(first['pack']['remaining'],3)
        self.assertEqual(first['pack']['collected'],0)
        self.assertEqual(len(self.rows('SELECT * FROM inventory_movements')),4)
        self.assertEqual({p['state'] for p in first['pallets']},{'open'})

    def test_one_confirmation_moves_exactly_one_and_replay_is_safe(self):
        payload=self.payload()
        first=self.success(self.client.post('/api/collection/pick',json=payload))
        replay=self.success(self.client.post('/api/collection/pick',json=payload))
        self.assertEqual(first,replay)
        self.assertEqual(first['source_remaining'],1)
        self.assertEqual(first['pack']['remaining'],2)
        self.assertEqual(first['pack']['collected'],1)
        self.assertEqual(len(self.rows("SELECT * FROM inventory_movements WHERE operation_id=?",(first['operation_id'],))),2)
        self.assertEqual(self.rows('SELECT current_cartons FROM icc_codes')[0]['current_cartons'],1)
        self.assertEqual(self.worker.post('/api/collection/pick',json=payload).status_code,409)
        payload['source_number']='4'
        self.assertEqual(self.client.post('/api/collection/pick',json=payload).status_code,409)

    def test_all_cartons_and_mix_identity(self):
        for source in ('1','1','4'):
            result=self.success(self.client.post('/api/collection/pick',json=self.payload(source)))
        self.assertEqual(result['pack']['remaining'],0)
        self.assertTrue(result['pack']['complete'])
        self.assertEqual(result['pack']['collected'],3)
        mix=dict(sort_id=1,type='mix',icc_code='D980989',location_code='',total_cartons=0)
        result=self.success(self.worker.post('/api/collection/pick',json=self.payload('10',mix)))
        self.assertEqual(result['pack']['collected'],1)
        self.assertIsNone(result['pack']['expected_qty'])

    def test_wrong_identity_location_closed_and_cross_task_are_atomic(self):
        original=self.payload()
        for field,value in [('icc_code','9999'),('total_cartons',4),('location_code','JP-B'),('source_number','4'),('source_pallet_id',9999),('destination_pallet_id',9999),('sort_id',2),('pack_id',True)]:
            payload=dict(original,request_id=str(uuid4()));payload[field]=value
            self.assertIn(self.client.post('/api/collection/pick',json=payload).status_code,(400,404,409))
        self.assertEqual(self.resolve()['pack']['remaining'],3)
        from inventory import ensure_custody
        with closing(self.db.get_connection()) as conn:
            p=ensure_custody(conn,self.resolve()['container_id'],1)['id'];conn.commit()
        self.success(self.client.put(f'/api/admin/inventory/pallets/{p}',json={'state':'closed'}))
        self.assertEqual(self.client.post('/api/collection/pick',json=original).status_code,409)
        self.assertEqual(len(self.rows("SELECT * FROM inventory_operations WHERE kind='collect'")),0)

    def test_two_workers_cannot_take_the_last_carton_twice(self):
        payload=self.payload('4')
        def pick(user_id):
            client=self.client_for(user_id)
            return client.post('/api/collection/pick',json=dict(payload,request_id=str(uuid4()))).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses=list(pool.map(pick,(1,2)))
        self.assertEqual(sorted(statuses),[200,409])
        self.assertEqual(self.resolve()['pack']['remaining'],2)

    def test_undo_compensates_and_cannot_be_applied_twice(self):
        result=self.success(self.client.post('/api/collection/pick',json=self.payload('4')))
        url='/api/collection/operations/'+result['operation_id']+'/undo'
        self.assertEqual(self.worker.post(url,json={'request_id':str(uuid4())}).status_code,404)
        payload={'request_id':str(uuid4())}
        undone=self.success(self.client.post(url,json=payload))
        self.assertEqual(undone,self.success(self.client.post(url,json=payload)))
        self.assertEqual(undone['pack']['remaining'],3)
        self.assertEqual(undone['pack']['collected'],0)
        self.assertEqual(self.client.post(url,json={'request_id':str(uuid4())}).status_code,409)
        self.assertEqual(len(self.rows('SELECT * FROM inventory_movements')),8)
        with closing(self.db.get_connection()) as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute('DELETE FROM inventory_movements')

    def test_restarting_import_does_not_recreate_collected_stock(self):
        self.success(self.client.post('/api/collection/pick',json=self.payload('4')))
        with closing(self.db.get_connection()) as conn:
            from inventory_migration import migrate_inventory
            migrate_inventory(conn);conn.commit()
        self.assertEqual(self.resolve()['pack']['remaining'],2)
        self.assertEqual(self.resolve()['pack']['collected'],1)

    def test_random_sort_and_source_receipts_share_ledger(self):
        response=self.client.post('/api/sort/submit',json=dict(self.identity,cartons_count=1,pallet_number='RANDOM-1',request_id=str(uuid4())))
        self.assertEqual(response.status_code,201,response.get_json())
        self.assertEqual(self.resolve()['pack']['collected'],1)
        self.assertEqual(self.resolve()['pack']['remaining'],3)
        with closing(self.db.get_connection()) as conn:
            from inventory_migration import migrate_inventory
            migrate_inventory(conn);conn.commit()
        self.assertEqual(self.resolve()['pack']['collected'],1)

    def test_admin_state_expected_and_source_rename_keep_identity(self):
        card=self.resolve();source=card['pallets'][0];pack_id=card['pack']['id']
        self.assertEqual(self.worker.put(f'/api/admin/inventory/packs/{pack_id}',json={'expected_qty':4}).status_code,403)
        self.success(self.client.put(f'/api/admin/inventory/packs/{pack_id}',json={'expected_qty':5}))
        self.assertEqual(self.resolve()['pack']['id'],pack_id)
        self.assertEqual(self.resolve()['pack']['expected_qty'],5)
        self.success(self.client.put(f'/api/admin/inventory/pallets/{source["id"]}',json={'pallet_number':'NEW-1'}))
        from inventory import ensure_pallet
        with closing(self.db.get_connection()) as conn:
            row=ensure_pallet(conn,card['container_id'],'1',stage='source',legacy_presort_id=1)
            self.assertEqual(row['id'],source['id']);self.assertEqual(row['pallet_number'],'NEW-1')

    def test_vevor_and_source_destination_collision_are_refused(self):
        vevor=dict(self.identity,type='vevor')
        self.assertEqual(self.client.post('/api/collection/resolve',json=vevor).status_code,400)
        self.assertEqual(self.client.post('/api/sort/check',json=vevor).status_code,409)
        self.assertEqual(self.client.post('/api/collection/destination',json={'sort_id':1,'pallet_number':'1'}).status_code,409)
        self.assertEqual(self.app.test_client().post('/api/collection/resolve',json=self.identity).status_code,401)

    def test_collected_cartons_belong_to_authenticated_worker_without_a_location(self):
        first=self.success(self.client.post('/api/collection/pick',json=dict(self.payload(),user_id=2)))
        second=self.success(self.worker.post('/api/collection/pick',json=self.payload()))
        self.assertEqual(first['pack']['mine'],1)
        self.assertEqual(second['pack']['mine'],1)
        custody=self.rows('SELECT * FROM inventory_custody ORDER BY user_id')
        self.assertEqual([r['user_id'] for r in custody],[1,2])
        self.assertNotEqual(custody[0]['pallet_id'],custody[1]['pallet_id'])
        detail=self.success(self.client.get('/api/admin/inventory/jobs/1'))
        holders=[p for p in detail['pallets'] if p['stage']=='carried']
        self.assertEqual({p['custodian_user_id'] for p in holders},{1,2})
        self.assertTrue(all(sum(b['balance'] for b in p['balances'])==1 for p in holders))
        # A client cannot select another worker's holding as the destination.
        payload=dict(self.payload('4'),destination_pallet_id=custody[0]['pallet_id'])
        result=self.worker.post('/api/collection/pick',json=payload)
        self.assertEqual(result.status_code,409)
        self.assertEqual(result.get_json()['code'],'destination_removed')
        self.assertEqual(self.resolve()['pack']['remaining'],1)

    def test_unconfirmed_legacy_destination_request_can_be_retried_safely(self):
        payload=dict(self.payload(),destination_pallet_id=9999)
        response=self.client.post('/api/collection/pick',json=payload)
        self.assertEqual(response.get_json()['code'],'destination_removed')
        del payload['destination_pallet_id']
        first=self.success(self.client.post('/api/collection/pick',json=payload))
        self.assertEqual(first,self.success(self.client.post('/api/collection/pick',json=payload)))
        self.assertEqual(first['pack']['mine'],1)

    def test_random_mode_does_not_use_the_workers_mobile_collection_as_a_location(self):
        self.success(self.client.post('/api/collection/pick',json=self.payload()))
        response=self.client.post('/api/sort/submit',json=dict(self.identity,cartons_count=1,pallet_number='RANDOM-9',request_id=str(uuid4())))
        self.assertEqual(response.status_code,201,response.get_json())
        checked=self.success(self.client.post('/api/sort/check',json=self.identity))
        self.assertEqual(checked['open_pallet']['pallet_number'],'RANDOM-9')

    def test_delete_unfinished_collection_stops_work_and_preserves_all_movements(self):
        self.success(self.client.post('/api/collection/pick',json=self.payload()))
        remaining=self.payload('4')
        before=self.rows('SELECT * FROM inventory_movements ORDER BY id')
        self.success(self.client.delete('/api/sorts/1?confirm=true'))
        self.assertEqual(self.rows('SELECT * FROM inventory_movements ORDER BY id'),before)
        self.assertEqual(self.worker.post('/api/collection/pick',json=remaining).status_code,404)
        self.assertEqual(self.client.post('/api/collection/resolve',json=self.identity).status_code,404)
        self.assertEqual(self.client.get('/api/admin/inventory/jobs/1').status_code,404)
        self.assertNotIn(1,[j['id'] for j in self.client.get('/api/admin/inventory/jobs').get_json()['jobs']])
        self.assertNotIn(1,[j['id'] for j in self.client.get('/api/admin/presort/jobs').get_json()['jobs']])
        self.assertEqual(self.client.get('/api/admin/presort/jobs/1/products').status_code,404)
        self.assertTrue(all(r['state']=='closed' for r in self.rows('SELECT state FROM inventory_pallets')))
        self.assertEqual(self.rows('SELECT status FROM sorts WHERE id=2')[0]['status'],'active')

    def test_deleting_active_presort_closes_its_sources_and_sessions(self):
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET mode='presort' WHERE id=1")
            conn.execute('UPDATE presort_pallets SET closed_at=NULL WHERE id=1')
            conn.execute('INSERT INTO user_container_sessions(user_id,container_id,sort_id) VALUES(1,2,1)')
            conn.commit()
        self.success(self.client.delete('/api/sorts/1?confirm=true'))
        self.assertTrue(all(r['closed_at'] for r in self.rows('SELECT closed_at FROM presort_pallets')))
        self.assertEqual(self.rows('SELECT is_active FROM user_container_sessions')[0]['is_active'],0)
        self.assertNotIn(1,[j['sort_id'] for j in self.worker.get('/api/presort/containers').get_json()])
        self.assertEqual(self.worker.post('/api/presort/pallets',json={'container_id':2}).status_code,400)

    def test_presort_receipt_and_undo_append_movements_in_the_same_transaction(self):
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET mode='presort' WHERE id=1");conn.commit()
        p=self.success(self.client.post('/api/presort/pallets',json={'container_id':2}))
        payload=dict(pallet_id=p['id'],type='single',code='4567',location='JP-A',pack=3,request_id=str(uuid4()))
        added=self.client.post('/api/presort/scans',json=payload)
        self.assertIn(added.status_code,(200,201),added.get_json())
        scan_id=added.get_json()['id']
        self.success(self.client.post(f'/api/presort/scans/{scan_id}/undo',json={}))
        with closing(self.db.get_connection()) as conn:
            conn.execute("UPDATE sorts SET mode='sort' WHERE id=1");conn.commit()
        self.assertEqual(self.resolve()['pack']['remaining'],3)
        self.assertEqual(len(self.rows('SELECT * FROM inventory_movements')),6)

    def test_failed_final_save_leaves_no_partial_transfer(self):
        payload=self.payload()
        with closing(self.db.get_connection()) as conn:
            conn.execute("CREATE TRIGGER fail_collection_log BEFORE INSERT ON activity_log WHEN NEW.action='collect_carton' BEGIN SELECT RAISE(ABORT,'test failure'); END");conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.post('/api/collection/pick',json=payload)
        self.assertEqual(self.resolve()['pack']['remaining'],3)
        self.assertEqual(self.resolve()['pack']['collected'],0)
        self.assertEqual(len(self.rows("SELECT * FROM inventory_operations WHERE kind='collect'")),0)
        self.assertEqual(len(self.rows('SELECT * FROM icc_codes')),0)

    def test_admin_adjustment_correction_and_writeoff_keep_history(self):
        card=self.resolve();p=card['pallets'][0]
        payload=dict(sort_id=1,pack_id=card['pack']['id'],pallet_id=p['id'],delta=2,reason='Physical count',request_id=str(uuid4()))
        result=self.success(self.client.post('/api/admin/inventory/adjustments',json=payload))
        self.success(self.client.post('/api/admin/inventory/adjustments',json=payload))
        self.assertEqual(self.resolve()['pack']['remaining'],5)
        movement=self.rows('SELECT id FROM inventory_movements WHERE operation_id=?',(result['operation_id'],))[0]['id']
        correction=dict(delta=1,reason='Count corrected',request_id=str(uuid4()))
        self.success(self.client.post(f'/api/admin/inventory/movements/{movement}/correct',json=correction))
        self.success(self.client.post(f'/api/admin/inventory/movements/{movement}/correct',json=correction))
        self.assertEqual(self.resolve()['pack']['remaining'],4)
        correction['request_id']=str(uuid4())
        self.assertEqual(self.client.post(f'/api/admin/inventory/movements/{movement}/correct',json=correction).status_code,409)
        writeoff=dict(reason='Damaged',request_id=str(uuid4()))
        self.success(self.client.post(f'/api/admin/inventory/pallets/{p["id"]}/writeoff',json=writeoff))
        self.success(self.client.post(f'/api/admin/inventory/pallets/{p["id"]}/writeoff',json=writeoff))
        self.assertEqual(self.resolve()['pack']['remaining'],1)
        self.assertEqual(len(self.rows('SELECT * FROM inventory_movements')),8)


    def test_undo_of_previously_corrupted_legacy_count_rolls_back(self):
        result=self.success(self.client.post('/api/collection/pick',json=self.payload()))
        before=self.rows('SELECT * FROM inventory_movements ORDER BY id')
        with closing(self.db.get_connection()) as conn:
            conn.execute('UPDATE icc_codes SET current_cartons=0 WHERE id=?',(result['legacy_icc_id'],));conn.commit()
        response=self.client.post('/api/collection/operations/'+result['operation_id']+'/undo',json={'request_id':str(uuid4())})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.rows('SELECT * FROM inventory_movements ORDER BY id'),before)
        self.assertEqual(self.rows('SELECT cartons_count FROM pallets WHERE id=?',(result['legacy_pallet_id'],))[0]['cartons_count'],1)


if __name__=='__main__':
    unittest.main()
