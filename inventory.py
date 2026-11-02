"""Immutable stock movements shared by unloading and guided collection.

Legacy rows are retained as the original audit trail. New transfers are committed
with their SORT projections and retry receipts in a single SQLite transaction.
"""
import json
import re
from contextlib import contextmanager
from functools import wraps
from uuid import uuid4

from flask import Blueprint, jsonify, request, session


SCHEMA = '''
CREATE TABLE IF NOT EXISTS inventory_contexts(id INTEGER PRIMARY KEY,sort_id INTEGER UNIQUE NOT NULL,legacy_container_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_packs(id INTEGER PRIMARY KEY,container_id INTEGER NOT NULL,type TEXT NOT NULL,code TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',label_pack INTEGER NOT NULL DEFAULT 0,expected_qty INTEGER,name TEXT NOT NULL DEFAULT '',UNIQUE(container_id,type,code,location,label_pack));
CREATE TABLE IF NOT EXISTS inventory_pallets(id INTEGER PRIMARY KEY,container_id INTEGER NOT NULL,pallet_number TEXT NOT NULL,stage TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',legacy_presort_id INTEGER UNIQUE,legacy_sort_id INTEGER UNIQUE,UNIQUE(container_id,stage,pallet_number));
CREATE TABLE IF NOT EXISTS inventory_operations(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL,container_id INTEGER NOT NULL,pack_id INTEGER,kind TEXT NOT NULL,payload TEXT NOT NULL,response TEXT NOT NULL DEFAULT '{}',undo_of TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inventory_movements(id INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,pack_id INTEGER NOT NULL,container_id INTEGER NOT NULL,pallet_id INTEGER NOT NULL,pallet_number TEXT NOT NULL,delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),user_id INTEGER NOT NULL,timestamp TEXT DEFAULT CURRENT_TIMESTAMP,reason TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS inventory_balance ON inventory_movements(pack_id,pallet_id);
CREATE TABLE IF NOT EXISTS inventory_imports(source TEXT,legacy_id INTEGER,operation_id TEXT,PRIMARY KEY(source,legacy_id));
CREATE TABLE IF NOT EXISTS inventory_settings(sort_id INTEGER PRIMARY KEY,icc_validation_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS inventory_sessions(user_id INTEGER PRIMARY KEY,sort_id INTEGER,started_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS inventory_corrections(original_movement_id INTEGER PRIMARY KEY,operation_id TEXT,replacement_movement_id INTEGER);
CREATE TABLE IF NOT EXISTS inventory_custody(container_id INTEGER NOT NULL,user_id INTEGER NOT NULL,pallet_id INTEGER UNIQUE NOT NULL,PRIMARY KEY(container_id,user_id));
CREATE TRIGGER IF NOT EXISTS inventory_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Movements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS inventory_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Movements are immutable'); END;
'''


class InventoryError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def ensure_context(conn, sort_id):
    conn.execute('INSERT OR IGNORE INTO inventory_contexts(sort_id,legacy_container_id) SELECT ?,container_id FROM presort_jobs WHERE sort_id=?', (sort_id, sort_id))
    conn.execute('INSERT OR IGNORE INTO inventory_contexts(sort_id) VALUES(?)', (sort_id,))
    return conn.execute('SELECT * FROM inventory_contexts WHERE sort_id=?', (sort_id,)).fetchone()


def ensure_pack(conn, container_id, type, code, location, label_pack, expected_qty=None):
    values = (container_id, type, code, location or '', label_pack or 0)
    conn.execute('INSERT OR IGNORE INTO inventory_packs(container_id,type,code,location,label_pack,expected_qty) VALUES(?,?,?,?,?,?)', (*values, expected_qty))
    return conn.execute('SELECT * FROM inventory_packs WHERE container_id=? AND type=? AND code=? AND location=? AND label_pack=?', values).fetchone()


def ensure_pallet(conn, container_id, number, stage='sorted', legacy_presort_id=None, legacy_sort_id=None, state='open'):
    for field, value in [('legacy_presort_id', legacy_presort_id), ('legacy_sort_id', legacy_sort_id)]:
        if value is not None:
            row = conn.execute(f'SELECT * FROM inventory_pallets WHERE {field}=?', (value,)).fetchone()
            if row:
                return row
    conn.execute('INSERT OR IGNORE INTO inventory_pallets(container_id,pallet_number,stage,state,legacy_presort_id,legacy_sort_id) VALUES(?,?,?,?,?,?)', (container_id, number, stage, state, legacy_presort_id, legacy_sort_id))
    return conn.execute('SELECT * FROM inventory_pallets WHERE container_id=? AND stage=? AND pallet_number=?', (container_id, stage, number)).fetchone()


def append_operation(conn, operation_id, request_id, user_id, container_id, pack_id, kind, payload=None, undo_of=None):
    conn.execute('INSERT INTO inventory_operations(id,request_id,user_id,container_id,pack_id,kind,payload,undo_of) VALUES(?,?,?,?,?,?,?,?)', (operation_id, request_id, user_id, container_id, pack_id, kind, json.dumps(payload or {}, sort_keys=True), undo_of))


def append_movement(conn, operation_id, pack_id, container_id, pallet_id, delta, user_id, reason='', timestamp=None):
    row = conn.execute('SELECT pallet_number FROM inventory_pallets WHERE id=? AND container_id=?', (pallet_id, container_id)).fetchone()
    if not row:
        raise InventoryError('Палету не знайдено', 404)
    return conn.execute('INSERT INTO inventory_movements(operation_id,pack_id,container_id,pallet_id,pallet_number,delta,user_id,reason,timestamp) VALUES(?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))', (operation_id, pack_id, container_id, pallet_id, row['pallet_number'], delta, user_id, reason, timestamp)).lastrowid


def record_sort_receipt(conn, sort_id, kind, code, location, label_pack, amount, pallet_id, number, user_id, request_id):
    """Called by legacy random SORT inside its existing write transaction."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='inventory_movements'").fetchone():
        return
    context = ensure_context(conn, sort_id)
    pack = ensure_pack(conn, context['id'], kind, code, location, label_pack, label_pack or None)
    if conn.execute("SELECT 1 FROM inventory_pallets WHERE container_id=? AND stage='source' AND pallet_number=?", (context['id'], number)).fetchone():
        raise InventoryError('Цей номер належить джерельній палеті. Вкажіть іншу кінцеву палету.', 409)
    pallet = ensure_pallet(conn, context['id'], number, legacy_sort_id=pallet_id)
    if pallet['state'] != 'open':
        raise InventoryError('Кінцева палета закрита. Оберіть іншу.', 409)
    op = str(uuid4())
    append_operation(conn, op, 'random-' + request_id, user_id, context['id'], pack['id'], 'random_sort')
    append_movement(conn, op, pack['id'], context['id'], pallet['id'], amount, user_id, 'Різні товари: додавання')
    conn.execute("INSERT OR IGNORE INTO inventory_imports VALUES('sorted-pallet',?,?)", (pallet_id, op))


def balance(conn, pack_id, pallet_id):
    return conn.execute('SELECT COALESCE(SUM(delta),0) FROM inventory_movements WHERE pack_id=? AND pallet_id=?', (pack_id, pallet_id)).fetchone()[0]


def ensure_custody(conn, container_id, user_id):
    """A mobile collection held by a worker, with no physical location assigned."""
    row = conn.execute('SELECT p.* FROM inventory_custody c JOIN inventory_pallets p ON p.id=c.pallet_id WHERE c.container_id=? AND c.user_id=?', (container_id,user_id)).fetchone()
    if row:
        return row
    row = ensure_pallet(conn,container_id,f'Працівник №{user_id}',stage='carried')
    conn.execute('INSERT INTO inventory_custody VALUES(?,?,?)',(container_id,user_id,row['id']))
    return row


def pack_card(conn, pack_id):
    pack = dict(conn.execute('SELECT * FROM inventory_packs WHERE id=?', (pack_id,)).fetchone())
    pallets = [dict(row) for row in conn.execute('''SELECT p.*,SUM(m.delta) balance FROM inventory_pallets p
        JOIN inventory_movements m ON m.pallet_id=p.id WHERE m.pack_id=? GROUP BY p.id HAVING SUM(m.delta)>0''', (pack_id,))]
    pack['collected'] = sum(p['balance'] for p in pallets if p['stage'] in ('sorted','carried'))
    pack['remaining'] = sum(p['balance'] for p in pallets if p['stage'] == 'source')
    pack['complete'] = pack['remaining'] == 0
    return dict(pack=pack, pallets=pallets, container_id=pack['container_id'])


def register_inventory(app, db):
    conn = db.get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.execute('BEGIN IMMEDIATE')
        from inventory_migration import migrate_inventory
        report = migrate_inventory(conn)
        conn.commit()
        app.logger.info('Inventory import: %s', report)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    bp = Blueprint('inventory', __name__)

    @contextmanager
    def connection(write=False):
        conn = db.get_connection()
        try:
            if write:
                conn.execute('BEGIN IMMEDIATE')
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def authorized(admin=False):
        def decorator(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                user = db.get_user_by_id(session.get('user_id')) if session.get('user_id') else None
                if not user:
                    return jsonify(error='Необхідна авторизація'), 401
                if admin and user['role'] != 'admin':
                    return jsonify(error='Доступ лише для адміністратора'), 403
                return fn(*args, **kwargs)
            return wrapped
        return decorator

    @bp.errorhandler(InventoryError)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    def data():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise InventoryError('Невірний формат запиту')
        return value

    def integer(value, signed=False):
        if isinstance(value, bool) or not re.fullmatch(r'-?[1-9]\d{0,8}' if signed else r'[1-9]\d{0,8}', str(value)):
            raise InventoryError('Кількість / ID має бути цілим числом більше нуля' if not signed else 'Рух має бути ненульовим цілим числом')
        return int(value)

    def active(conn, sort_id, kind=None):
        row = conn.execute('SELECT * FROM sorts WHERE id=?', (sort_id,)).fetchone()
        if not row or row['status']=='deleted':
            raise InventoryError('SORT не знайдено', 404)
        if row['mode'] != 'sort' or row['status'] != 'active':
            raise InventoryError('Цей SORT закритий або призупинений', 409)
        if kind and (kind not in ('single', 'mix') or kind not in row['type'].split(',')):
            raise InventoryError('Тип недоступний у цьому SORT')
        return row

    def identity(conn, sort_id, value):
        kind = str(value.get('type', '')).lower()
        active(conn, sort_id, kind)
        code = str(value.get('icc_code', '')).strip().upper()
        setting = conn.execute('SELECT icc_validation_enabled FROM inventory_settings WHERE sort_id=?', (sort_id,)).fetchone()
        validation = not setting or bool(setting[0])
        if not code or len(code) > 40 or (validation and not re.fullmatch(r'[A-Z]\d{5,7}' if kind == 'mix' else r'\d{4}', code)):
            raise InventoryError('Перевірте ICC код наклейки')
        label_pack = 0 if kind == 'mix' else integer(value.get('total_cartons'))
        location = '' if kind == 'mix' else str(value.get('location_code', '')).strip().upper()
        if kind != 'mix' and not re.fullmatch(r'[A-Z]{2}-[A-Z]', location):
            raise InventoryError('Кодові букви мають бути у форматі JP-A')
        return kind, code, location, label_pack

    def touch(conn, sort_id):
        conn.execute('''INSERT INTO inventory_sessions(user_id,sort_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET
            started_at=CASE WHEN sort_id=excluded.sort_id AND is_active=1 THEN started_at ELSE CURRENT_TIMESTAMP END,
            sort_id=excluded.sort_id,last_seen_at=CURRENT_TIMESTAMP,is_active=1''', (session['user_id'], sort_id))

    def visible_context(conn, container_id):
        if not conn.execute("SELECT 1 FROM inventory_contexts c JOIN sorts s ON s.id=c.sort_id WHERE c.id=? AND s.status<>'deleted'", (container_id,)).fetchone():
            raise InventoryError('Сорт не знайдено',404)

    def visible_job(conn, sort_id):
        if not conn.execute("SELECT 1 FROM sorts WHERE id=? AND status<>'deleted'", (sort_id,)).fetchone():
            raise InventoryError('Сорт не знайдено',404)

    def pallet(conn, pallet_id, container_id, stage=None):
        visible_context(conn,container_id)
        row = conn.execute('SELECT * FROM inventory_pallets WHERE id=? AND container_id=?', (integer(pallet_id), container_id)).fetchone()
        if not row:
            raise InventoryError('Палету не знайдено', 404)
        if row['state'] != 'open':
            raise InventoryError('Палета закрита для рухів. Зверніться до адміністратора.', 409)
        if stage and row['stage'] != stage:
            raise InventoryError('Невірний тип палети', 409)
        return row

    def token(value):
        result = str(value.get('request_id', ''))
        if not re.fullmatch(r'[A-Za-z0-9-]{16,80}', result):
            raise InventoryError('Оновіть сторінку: відсутній ідентифікатор збереження')
        return result

    def replay(conn, value):
        previous = conn.execute('SELECT * FROM inventory_operations WHERE request_id=?', (token(value),)).fetchone()
        if previous:
            if previous['user_id'] != session['user_id'] or previous['payload'] != json.dumps(value, sort_keys=True):
                raise InventoryError('Ідентифікатор належить іншому збереженню', 409)
            return json.loads(previous['response'])

    def save_response(conn, op, result):
        conn.execute('UPDATE inventory_operations SET response=? WHERE id=?', (json.dumps(result), op))
        return jsonify(result)

    def worker_card(conn, pack_id):
        result = pack_card(conn,pack_id)
        result['pack']['mine'] = conn.execute('''SELECT COALESCE(SUM(m.delta),0) FROM inventory_movements m
            JOIN inventory_custody c ON c.pallet_id=m.pallet_id WHERE m.pack_id=? AND c.user_id=?''', (pack_id,session['user_id'])).fetchone()[0]
        return result

    @bp.post('/api/collection/resolve')
    @authorized()
    def resolve():
        value = data()
        sort_id = integer(value.get('sort_id'))
        with connection(True) as conn:
            kind, code, location, label_pack = identity(conn, sort_id, value)
            context = ensure_context(conn, sort_id)
            pack = ensure_pack(conn, context['id'], kind, code, location, label_pack, label_pack or None)
            touch(conn, sort_id)
            result = worker_card(conn, pack['id'])
            result['has_source'] = context['legacy_container_id'] is not None
            return jsonify(result)

    @bp.post('/api/collection/destination')
    @authorized()
    def destination():
        return jsonify(error='Оновіть сторінку. Зібрані картони автоматично прив’язуються до працівника.',code='destination_removed'),409

    def project_transfer(conn, sort_id, pack, dest, quantity):
        """Maintain the existing SORT reports without treating them as source balances."""
        row = conn.execute('''SELECT * FROM icc_codes WHERE sort_id=? AND type=? AND last_4_digits=?
            AND COALESCE(location_code,'')=? AND total_cartons=? ORDER BY id DESC LIMIT 1''', (sort_id, pack['type'], pack['code'], pack['location'], pack['label_pack'])).fetchone()
        if row:
            icc_id = row['id']
        else:
            icc_id = conn.execute('INSERT INTO icc_codes(icc_code,type,last_4_digits,location_code,total_cartons,sort_id) VALUES(?,?,?,?,?,?)', ('COLLECT-' + uuid4().hex, pack['type'], pack['code'], pack['location'], pack['label_pack'], sort_id)).lastrowid
        conn.execute('UPDATE icc_codes SET current_cartons=current_cartons+?,is_completed=CASE WHEN total_cartons>0 AND current_cartons+?>=total_cartons THEN 1 ELSE 0 END WHERE id=?', (quantity, quantity, icc_id))
        row = conn.execute('SELECT id FROM pallets WHERE icc_code_id=? AND user_id=? AND pallet_number=? AND is_closed=0', (icc_id, session['user_id'], dest['pallet_number'])).fetchone()
        if row:
            pid = row['id']
            conn.execute('UPDATE pallets SET cartons_count=cartons_count+? WHERE id=?', (quantity, pid))
        else:
            pid = conn.execute('INSERT INTO pallets(pallet_number,icc_code_id,user_id,type,cartons_count) VALUES(?,?,?,?,?)', (dest['pallet_number'], icc_id, session['user_id'], pack['type'], quantity)).lastrowid
        conn.execute("INSERT OR IGNORE INTO inventory_imports VALUES('sorted-pallet',?,?)", (pid, 'collection-projection'))
        conn.execute('UPDATE users SET total_cartons=total_cartons+?,last_activity=CURRENT_TIMESTAMP WHERE id=?', (quantity, session['user_id']))
        return dict(legacy_icc_id=icc_id, legacy_pallet_id=pid)

    @bp.post('/api/collection/pick')
    @authorized()
    def pick():
        value = data()
        with connection(True) as conn:
            previous = replay(conn, value)
            if previous is not None:
                return jsonify(previous)
            if 'destination_pallet_id' in value:
                return jsonify(error='Оновіть сторінку. Кінцеву палету більше не потрібно вказувати.',code='destination_removed'),409
            sort_id = integer(value.get('sort_id'))
            matched = identity(conn, sort_id, value)
            context = ensure_context(conn, sort_id)
            pack = conn.execute('SELECT * FROM inventory_packs WHERE id=? AND container_id=?', (integer(value.get('pack_id')), context['id'])).fetchone()
            if not pack or matched != (pack['type'], pack['code'], pack['location'], pack['label_pack']):
                raise InventoryError('Це інший картон. Перевірте всі дані наклейки.', 409)
            source = pallet(conn, value.get('source_pallet_id'), context['id'], 'source')
            if str(value.get('source_number', '')).strip().upper() != source['pallet_number'].upper():
                raise InventoryError('Номер локації не збігається з джерельною палетою', 409)
            if balance(conn, pack['id'], source['id']) < 1:
                raise InventoryError('Недостатньо на палеті: цей картон уже забрали. Оновіть залишки.', 409)
            dest = ensure_custody(conn,context['id'],session['user_id'])
            pallet(conn,dest['id'],context['id'],'carried')
            op = str(uuid4())
            append_operation(conn, op, token(value), session['user_id'], context['id'], pack['id'], 'collect', value)
            append_movement(conn, op, pack['id'], context['id'], source['id'], -1, session['user_id'], 'Один товар: забрано')
            append_movement(conn, op, pack['id'], context['id'], dest['id'], 1, session['user_id'], 'Один товар: у працівника')
            projection = project_transfer(conn, sort_id, pack, dest, 1)
            touch(conn, sort_id)
            conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)', (session['user_id'], 'collect_carton', f'SORT #{sort_id}: {pack["code"]}, {source["pallet_number"]} → {dest["pallet_number"]}'))
            result = worker_card(conn, pack['id'])
            result.update(operation_id=op, source_remaining=balance(conn, pack['id'], source['id']), **projection)
            return save_response(conn, op, result)

    @bp.post('/api/collection/operations/<operation_id>/undo')
    @authorized()
    def undo(operation_id):
        value = data()
        value['undo_operation_id'] = operation_id
        with connection(True) as conn:
            previous = replay(conn, value)
            if previous is not None:
                return jsonify(previous)
            original = conn.execute("SELECT * FROM inventory_operations WHERE id=? AND kind='collect'", (operation_id,)).fetchone()
            if not original or (original['user_id'] != session['user_id'] and db.get_user_by_id(session['user_id'])['role'] != 'admin'):
                raise InventoryError('Операцію не знайдено або вона належить іншому працівнику', 404)
            if conn.execute('SELECT 1 FROM inventory_operations WHERE undo_of=?', (operation_id,)).fetchone():
                raise InventoryError('Цей картон уже повернуто', 409)
            context = conn.execute('SELECT * FROM inventory_contexts WHERE id=?', (original['container_id'],)).fetchone()
            active(conn, context['sort_id'])
            movements = conn.execute('SELECT * FROM inventory_movements WHERE operation_id=?', (operation_id,)).fetchall()
            for m in movements:
                pallet(conn, m['pallet_id'], original['container_id'])
                if balance(conn, m['pack_id'], m['pallet_id']) - m['delta'] < 0:
                    raise InventoryError('Недостатньо на кінцевій палеті для повернення', 409)
            op = str(uuid4())
            append_operation(conn, op, token(value), session['user_id'], original['container_id'], original['pack_id'], 'undo_collect', value, operation_id)
            for m in movements:
                append_movement(conn, op, m['pack_id'], m['container_id'], m['pallet_id'], -m['delta'], session['user_id'], 'Скасування збирання: повернення картона')
            projection = json.loads(original['response'])
            p=conn.execute('UPDATE pallets SET cartons_count=cartons_count-1 WHERE id=? AND cartons_count>0', (projection['legacy_pallet_id'],))
            if p.rowcount!=1:
                raise InventoryError('Історичний облік палети змінено. Зверніться до адміністратора.',409)
            i=conn.execute('UPDATE icc_codes SET current_cartons=current_cartons-1,is_completed=CASE WHEN current_cartons-1>=total_cartons AND total_cartons>0 THEN 1 ELSE 0 END WHERE id=? AND current_cartons>0', (projection['legacy_icc_id'],))
            if i.rowcount!=1:
                raise InventoryError('Історичний облік товару змінено. Зверніться до адміністратора.',409)
            conn.execute('UPDATE users SET total_cartons=total_cartons-1 WHERE id=?', (original['user_id'],))
            return save_response(conn, op, worker_card(conn, original['pack_id']))

    @bp.get('/api/admin/inventory/jobs')
    @authorized(True)
    def jobs():
        with connection() as conn:
            return jsonify(user_id=session['user_id'], jobs=[dict(row) for row in conn.execute("SELECT s.*,COALESCE(i.icc_validation_enabled,1) icc_validation_enabled FROM sorts s LEFT JOIN inventory_settings i ON i.sort_id=s.id WHERE s.status<>'deleted' ORDER BY s.id DESC")])

    @bp.get('/api/admin/inventory/jobs/<int:sort_id>')
    @authorized(True)
    def detail(sort_id):
        with connection(True) as conn:
            visible_job(conn,sort_id)
            context = ensure_context(conn, sort_id)
            packs = [pack_card(conn, r['id'])['pack'] for r in conn.execute('SELECT id FROM inventory_packs WHERE container_id=?', (context['id'],))]
            pallets = []
            for row in conn.execute('SELECT * FROM inventory_pallets WHERE container_id=?', (context['id'],)).fetchall():
                p = dict(row)
                holder = conn.execute('SELECT c.user_id,u.username FROM inventory_custody c LEFT JOIN users u ON u.id=c.user_id WHERE c.pallet_id=?',(row['id'],)).fetchone()
                if holder:
                    p['custodian_user_id'] = holder['user_id']
                    p['custodian_username'] = holder['username'] or f'Працівник №{holder["user_id"]}'
                p['balances'] = [dict(b) for b in conn.execute('SELECT m.pack_id,i.code,i.type,i.location,i.expected_qty,SUM(m.delta) balance FROM inventory_movements m JOIN inventory_packs i ON i.id=m.pack_id WHERE m.pallet_id=? GROUP BY m.pack_id HAVING SUM(m.delta)<>0', (row['id'],))]
                pallets.append(p)
            movements = [dict(row) for row in conn.execute('''SELECT m.*,u.username,o.kind,c.operation_id corrected_by,
                CASE WHEN o.kind IN ('collect','random_sort','undo_collect') THEN 0 ELSE 1 END can_correct
                FROM inventory_movements m LEFT JOIN users u ON u.id=m.user_id JOIN inventory_operations o ON o.id=m.operation_id
                LEFT JOIN inventory_corrections c ON c.original_movement_id=m.id WHERE m.container_id=? ORDER BY m.id DESC LIMIT 1000''', (context['id'],))]
            setting = conn.execute('SELECT icc_validation_enabled FROM inventory_settings WHERE sort_id=?', (sort_id,)).fetchone()
            for movement in movements:
                movement['can_correct'] = bool(movement['can_correct'])
            workers = [dict(r) for r in conn.execute("SELECT u.id,u.username,s.started_at,s.last_seen_at FROM inventory_sessions s JOIN users u ON u.id=s.user_id WHERE s.sort_id=? AND s.is_active=1 AND s.last_seen_at>datetime('now','-15 minutes')", (sort_id,))]
            return jsonify(packs=packs,pallets=pallets,movements=movements,workers=workers,icc_validation_enabled=not setting or bool(setting[0]))

    @bp.put('/api/admin/inventory/jobs/<int:sort_id>/settings')
    @authorized(True)
    def settings(sort_id):
        enabled = data().get('icc_validation_enabled')
        if not isinstance(enabled, bool):
            raise InventoryError('Невірне налаштування ICC')
        with connection(True) as conn:
            visible_job(conn,sort_id)
            conn.execute('INSERT INTO inventory_settings VALUES(?,?) ON CONFLICT(sort_id) DO UPDATE SET icc_validation_enabled=excluded.icc_validation_enabled', (sort_id, int(enabled)))
        return jsonify(success=True)

    @bp.put('/api/admin/inventory/packs/<int:pack_id>')
    @authorized(True)
    def expected(pack_id):
        value = data().get('expected_qty')
        with connection(True) as conn:
            row = conn.execute('SELECT * FROM inventory_packs WHERE id=?', (pack_id,)).fetchone()
            if not row:
                raise InventoryError('Товар не знайдено', 404)
            visible_context(conn,row['container_id'])
            value = None if value is None and row['type'] == 'mix' else integer(value)
            conn.execute('UPDATE inventory_packs SET expected_qty=? WHERE id=?', (value, pack_id))
        return jsonify(success=True)

    @bp.put('/api/admin/inventory/pallets/<int:pallet_id>')
    @authorized(True)
    def edit_pallet(pallet_id):
        value = data()
        with connection(True) as conn:
            row = conn.execute('SELECT * FROM inventory_pallets WHERE id=?', (pallet_id,)).fetchone()
            if not row:
                raise InventoryError('Палету не знайдено', 404)
            visible_context(conn,row['container_id'])
            state = value.get('state', row['state'])
            number = str(value.get('pallet_number', row['pallet_number'])).strip().upper()
            if row['stage']=='carried' and number != row['pallet_number'].upper():
                raise InventoryError('Зібрані картони прив’язані до працівника, а не до номера локації.',409)
            if state not in ('open', 'closed') or row['state'] == 'written_off' or not number or len(number) > 80:
                raise InventoryError('Невірний номер або стан палети')
            if conn.execute('SELECT id FROM inventory_pallets WHERE container_id=? AND pallet_number=? AND id<>?', (row['container_id'], number, pallet_id)).fetchone():
                raise InventoryError('Цей номер уже використовується', 409)
            conn.execute('UPDATE inventory_pallets SET pallet_number=?,state=? WHERE id=?', (number, state, pallet_id))
            if row['stage'] == 'sorted':
                conn.execute('''UPDATE pallets SET pallet_number=?,is_closed=?,
                    closed_at=CASE WHEN ?=1 THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END
                    WHERE pallet_number=? AND icc_code_id IN (SELECT i.id FROM icc_codes i
                    JOIN inventory_contexts c ON c.sort_id=i.sort_id WHERE c.id=?)''',
                    (number,int(state=='closed'),int(state=='closed'),row['pallet_number'],row['container_id']))
        return jsonify(success=True)

    @bp.post('/api/admin/inventory/adjustments')
    @authorized(True)
    def adjustment():
        value = data()
        with connection(True) as conn:
            previous = replay(conn, value)
            if previous is not None:
                return jsonify(previous)
            context = ensure_context(conn, integer(value.get('sort_id')))
            pack_id = integer(value.get('pack_id'))
            if not conn.execute('SELECT id FROM inventory_packs WHERE id=? AND container_id=?', (pack_id, context['id'])).fetchone():
                raise InventoryError('Товар не належить завданню', 404)
            p = pallet(conn, value.get('pallet_id'), context['id'])
            delta = integer(value.get('delta'), True)
            reason = str(value.get('reason', '')).strip()
            if not reason or len(reason) > 500:
                raise InventoryError('Вкажіть причину (до 500 символів)')
            if balance(conn, pack_id, p['id']) + delta < 0:
                raise InventoryError('Недостатньо на палеті', 409)
            op = str(uuid4())
            append_operation(conn, op, token(value), session['user_id'], context['id'], pack_id, 'adjustment', value)
            append_movement(conn, op, pack_id, context['id'], p['id'], delta, session['user_id'], reason)
            return save_response(conn, op, dict(success=True,operation_id=op))

    @bp.post('/api/admin/inventory/pallets/<int:pallet_id>/writeoff')
    @authorized(True)
    def writeoff(pallet_id):
        value = data()
        value['writeoff_pallet_id'] = pallet_id
        with connection(True) as conn:
            previous = replay(conn, value)
            if previous is not None:
                return jsonify(previous)
            p = conn.execute('SELECT * FROM inventory_pallets WHERE id=?', (pallet_id,)).fetchone()
            if not p or p['state'] == 'written_off':
                raise InventoryError('Палету вже списано або не знайдено', 409)
            visible_context(conn,p['container_id'])
            reason = str(value.get('reason', '')).strip()
            if not reason or len(reason)>500:
                raise InventoryError('Вкажіть причину (до 500 символів)')
            op = str(uuid4())
            append_operation(conn, op, token(value), session['user_id'], p['container_id'], None, 'writeoff', value)
            rows = conn.execute('SELECT pack_id,SUM(delta) balance FROM inventory_movements WHERE pallet_id=? GROUP BY pack_id HAVING SUM(delta)>0', (pallet_id,)).fetchall()
            for row in rows:
                append_movement(conn, op, row['pack_id'], p['container_id'], pallet_id, -row['balance'], session['user_id'], reason)
            conn.execute("UPDATE inventory_pallets SET state='written_off' WHERE id=?", (pallet_id,))
            return save_response(conn, op, dict(success=True))

    @bp.post('/api/admin/inventory/movements/<int:movement_id>/correct')
    @authorized(True)
    def correct(movement_id):
        value = data()
        value['correct_movement_id'] = movement_id
        with connection(True) as conn:
            previous = replay(conn, value)
            if previous is not None:
                return jsonify(previous)
            m = conn.execute('SELECT m.*,o.kind FROM inventory_movements m JOIN inventory_operations o ON o.id=m.operation_id WHERE m.id=?', (movement_id,)).fetchone()
            if not m:
                raise InventoryError('Рух не знайдено',404)
            if m['kind'] in ('collect','random_sort','undo_collect'):
                raise InventoryError('Для збирання використовуйте скасування операції або окреме коригування залишку.',409)
            if conn.execute('SELECT 1 FROM inventory_corrections WHERE original_movement_id=?', (movement_id,)).fetchone():
                raise InventoryError('Рух уже виправлено. Оберіть новий рух.',409)
            pallet(conn, m['pallet_id'], m['container_id'])
            delta = integer(value.get('delta'),True)
            reason = str(value.get('reason','')).strip()
            if not reason or len(reason)>500:
                raise InventoryError('Вкажіть причину (до 500 символів)')
            if balance(conn,m['pack_id'],m['pallet_id'])-m['delta']+delta<0:
                raise InventoryError('Недостатньо на палеті',409)
            op=str(uuid4())
            append_operation(conn,op,token(value),session['user_id'],m['container_id'],m['pack_id'],'correction',value)
            compensation=append_movement(conn,op,m['pack_id'],m['container_id'],m['pallet_id'],-m['delta'],session['user_id'],reason)
            replacement=append_movement(conn,op,m['pack_id'],m['container_id'],m['pallet_id'],delta,session['user_id'],reason)
            conn.execute('INSERT INTO inventory_corrections VALUES(?,?,?)',(movement_id,op,replacement))
            # Compensation itself cannot be corrected a second time.
            conn.execute('INSERT INTO inventory_corrections VALUES(?,?,?)',(compensation,op,replacement))
            return save_response(conn,op,dict(success=True))

    app.register_blueprint(bp)
