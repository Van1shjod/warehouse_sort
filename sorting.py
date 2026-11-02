"""Task-scoped SORT operations, committed atomically and safe to retry."""
import json
import re
from contextlib import contextmanager
from functools import wraps
from uuid import uuid4

from flask import Blueprint, jsonify, request, session


class SortError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def close_sort_job(db, sort_id):
    """Finish a sorting task and its open destination pallets in one transaction."""
    conn = db.get_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        sort = conn.execute("SELECT id FROM sorts WHERE id=? AND mode='sort' AND status<>'deleted'", (sort_id,)).fetchone()
        if not sort:
            raise SortError('SORT не знайдено', 404)
        conn.execute("UPDATE sorts SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?", (sort_id,))
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='inventory_pallets'").fetchone():
            conn.execute("UPDATE inventory_pallets SET state='closed' WHERE state='open' AND container_id IN (SELECT id FROM inventory_contexts WHERE sort_id=?)", (sort_id,))
            conn.execute('UPDATE inventory_sessions SET is_active=0 WHERE sort_id=?', (sort_id,))
        conn.execute('''UPDATE pallets SET is_closed=1,closed_at=CURRENT_TIMESTAMP
            WHERE is_closed=0 AND icc_code_id IN(SELECT id FROM icc_codes WHERE sort_id=?)''', (sort_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def register_sorting(app, db):
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

    # Existing deployment is backed up before this additive migration is activated.
    with connection(write=True) as conn:
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(icc_codes)')}
        if 'sort_id' not in columns:
            conn.execute('ALTER TABLE icc_codes ADD COLUMN sort_id INTEGER')
        if 'location_code' not in columns:
            conn.execute('ALTER TABLE icc_codes ADD COLUMN location_code TEXT')
        conn.execute('''CREATE TABLE IF NOT EXISTS sort_operations (
            request_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, sort_id INTEGER NOT NULL,
            payload TEXT NOT NULL, response TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
        conn.execute('''CREATE INDEX IF NOT EXISTS idx_sort_identity ON icc_codes
            (sort_id,type,last_4_digits,location_code,total_cartons)''')

    bp = Blueprint('sorting', __name__)

    def authenticated(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not session.get('user_id') or not db.get_user_by_id(session['user_id']):
                return jsonify(error='Необхідна авторизація'), 401
            return fn(*args, **kwargs)
        return wrapped

    @bp.errorhandler(SortError)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    def integer(value, label):
        if isinstance(value, bool) or not re.fullmatch(r'[1-9]\d{0,8}', str(value)):
            raise SortError(f'{label}: введіть додатне ціле число')
        return int(value)

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise SortError('Невірний формат запиту')
        return data

    def identity(data):
        sort_id = integer(data.get('sort_id'), 'Оберіть сорт')
        kind = str(data.get('type', '')).lower()
        if kind == 'vevor' and app.config.get('VEVOR_UNAVAILABLE'):
            raise SortError('Vevor ще в розробці', 409)
        if kind not in ('single', 'mix', 'vevor'):
            raise SortError('Оберіть Single, Mix або Vevor')
        code = str(data.get('icc_code', '')).strip().upper()
        if not re.fullmatch(r'[A-Z]\d{5,7}' if kind == 'mix' else r'\d{4}', code):
            raise SortError('Перевірте ICC код наклейки')
        pack = 0 if kind == 'mix' else integer(data.get('total_cartons'), 'PACK')
        location = '' if kind == 'mix' else str(data.get('location_code', '')).strip().upper()
        if kind != 'mix' and not re.fullmatch(r'[A-Z]{2}-[A-Z]', location):
            raise SortError('Введіть кодові букви у форматі JP-A')
        return sort_id, kind, code, pack, location

    def active_sort(conn, sort_id, kind=None):
        sort = conn.execute('SELECT * FROM sorts WHERE id=?', (sort_id,)).fetchone()
        if not sort:
            raise SortError('Сорт не знайдено', 404)
        if sort['mode'] != 'sort' or sort['status'] != 'active':
            raise SortError('Цей SORT не активний. Оберіть активне завдання.', 409)
        if kind and kind not in sort['type'].split(','):
            raise SortError('Цей тип картонів не дозволений у вибраному SORT')
        return sort

    def find_item(conn, item):
        sort_id, kind, code, pack, location = item
        return conn.execute('''SELECT * FROM icc_codes WHERE sort_id=? AND type=?
            AND last_4_digits=? AND total_cartons=? AND COALESCE(location_code,'')=?
            ORDER BY is_completed ASC,id DESC LIMIT 1''', (sort_id, kind, code, pack, location)).fetchone()

    def open_pallet(conn, icc_id):
        # A worker's mobile collection is not an open stationary pallet in the
        # separate "Різні товари" workflow.
        mobile_filter = ''
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='inventory_custody'").fetchone():
            mobile_filter = ''' AND pallet_number NOT IN (SELECT ip.pallet_number
                FROM inventory_pallets ip JOIN inventory_custody c ON c.pallet_id=ip.id
                JOIN inventory_contexts ctx ON ctx.id=c.container_id
                WHERE c.user_id=pallets.user_id AND ctx.sort_id=(SELECT sort_id FROM icc_codes WHERE id=pallets.icc_code_id))'''
        return conn.execute('SELECT * FROM pallets WHERE icc_code_id=? AND user_id=? AND is_closed=0' + mobile_filter + ' ORDER BY id DESC LIMIT 1', (icc_id, session['user_id'])).fetchone()

    @bp.post('/api/sort/check')
    @authenticated
    def check():
        item = identity(body())
        with connection() as conn:
            active_sort(conn, item[0], item[1])
            record = find_item(conn, item)
            if not record:
                return jsonify(status='new', icc_data=None, open_pallet=None)
            pallet = open_pallet(conn, record['id'])
            return jsonify(status='completed' if record['is_completed'] else 'exists',
                           icc_data=dict(record), open_pallet=dict(pallet) if pallet else None)

    @bp.post('/api/sort/submit')
    @authenticated
    def submit():
        data = body()
        item = identity(data)
        sort_id, kind, code, pack, location = item
        amount = integer(data.get('cartons_count'), 'Кількість картонів')
        number = str(data.get('pallet_number', '')).strip().upper()
        if not number or len(number) > 80:
            raise SortError('Введіть номер палети (до 80 символів)')
        force = data.get('force_new', False)
        if not isinstance(force, bool):
            raise SortError('Невірне підтвердження нового товару')
        token = str(data.get('request_id', ''))
        if not re.fullmatch(r'[A-Za-z0-9-]{16,80}', token):
            raise SortError('Оновіть сторінку та повторіть збереження')
        payload = json.dumps([session['user_id'], *item, amount, number, force], separators=(',', ':'))
        with connection(write=True) as conn:
            previous = conn.execute('SELECT * FROM sort_operations WHERE request_id=?', (token,)).fetchone()
            if previous:
                if previous['payload'] != payload:
                    raise SortError('Ідентифікатор уже належить іншому збереженню', 409)
                result = json.loads(previous['response'])
                result['repeated'] = True
                return jsonify(result)
            active_sort(conn, sort_id, kind)
            record = find_item(conn, item)
            if record and record['is_completed']:
                if not force:
                    raise SortError('Цей товар уже зібрано. Підтвердіть новий товар або перевірте наклейку.', 409)
                record = None
            current = record['current_cartons'] if record else 0
            if kind != 'mix' and current + amount > pack:
                raise SortError(f'Кількість перевищує PACK. Уже додано {current} із {pack}; залишилось {max(0, pack-current)}.', 409)
            if record:
                icc_id = record['id']
            else:
                cursor = conn.execute('''INSERT INTO icc_codes
                    (icc_code,type,total_cartons,last_4_digits,location_code,sort_id)
                    VALUES(?,?,?,?,?,?)''', (f'{kind.upper()}-{code}-{uuid4().hex}', kind, pack, code, location, sort_id))
                icc_id = cursor.lastrowid
            pallet = open_pallet(conn, icc_id)
            if pallet:
                if pallet['pallet_number'] != number:
                    raise SortError(f"Підтвердіть відкриту палету {pallet['pallet_number']} або спочатку закрийте її.", 409)
                pallet_id = pallet['id']
                conn.execute('UPDATE pallets SET cartons_count=cartons_count+? WHERE id=?', (amount, pallet_id))
            else:
                cursor = conn.execute('''INSERT INTO pallets
                    (pallet_number,icc_code_id,user_id,type,cartons_count) VALUES(?,?,?,?,?)''',
                    (number, icc_id, session['user_id'], kind, amount))
                pallet_id = cursor.lastrowid
            count = current + amount
            completed = int(kind != 'mix' and count >= pack)
            conn.execute('UPDATE icc_codes SET current_cartons=?,is_completed=? WHERE id=?', (count, completed, icc_id))
            updated = conn.execute('''UPDATE users SET total_cartons=total_cartons+?,
                last_activity=CURRENT_TIMESTAMP WHERE id=?''', (amount, session['user_id']))
            if updated.rowcount != 1:
                raise SortError('Необхідна повторна авторизація', 401)
            conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)',
                         (session['user_id'], 'add_cartons', f'SORT #{sort_id}: додано {amount} до {code} {location} {pack} PACK, палета {number}'))
            result = dict(message='Картони додано', current_cartons=count, total_cartons=pack,
                          is_completed=completed, icc_id=icc_id, pallet_id=pallet_id, sort_id=sort_id)
            from inventory import record_sort_receipt, InventoryError
            try:
                record_sort_receipt(conn, sort_id, kind, code, location, pack, amount,
                                    pallet_id, number, session['user_id'], token)
            except InventoryError as error:
                raise SortError(str(error), error.status)
            conn.execute('INSERT INTO sort_operations(request_id,user_id,sort_id,payload,response) VALUES(?,?,?,?,?)',
                         (token, session['user_id'], sort_id, payload, json.dumps(result, ensure_ascii=False)))
        return jsonify(result), 201

    @bp.post('/api/sort/pallet/close')
    @authenticated
    def close():
        data = body()
        sort_id = integer(data.get('sort_id'), 'Оберіть сорт')
        icc_id = integer(data.get('icc_id'), 'Оберіть товар')
        pallet_id = integer(data.get('pallet_id'), 'Оберіть конкретну палету')
        with connection(write=True) as conn:
            sort = conn.execute("SELECT id FROM sorts WHERE id=? AND mode='sort' AND status<>'deleted'", (sort_id,)).fetchone()
            if not sort:
                raise SortError('SORT не знайдено', 404)
            record = conn.execute('SELECT * FROM icc_codes WHERE id=? AND sort_id=?', (icc_id, sort_id)).fetchone()
            if not record:
                raise SortError('Товар не належить цьому SORT', 404)
            pallet = conn.execute('''SELECT * FROM pallets WHERE id=? AND icc_code_id=?
                AND user_id=?''', (pallet_id, icc_id, session['user_id'])).fetchone()
            if not pallet:
                raise SortError('Ця палета не належить вам або цьому товару', 404)
            if pallet['is_closed']:
                return jsonify(message='Палету вже закрито', repeated=True)
            conn.execute('UPDATE pallets SET is_closed=1,closed_at=CURRENT_TIMESTAMP WHERE id=?', (pallet['id'],))
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='inventory_pallets'").fetchone():
                conn.execute("UPDATE inventory_pallets SET state='closed' WHERE stage='sorted' AND pallet_number=? AND container_id IN (SELECT id FROM inventory_contexts WHERE sort_id=?)", (pallet['pallet_number'], sort_id))
            conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)',
                         (session['user_id'], 'close_pallet', f"SORT #{sort_id}: закрито палету {pallet['pallet_number']}"))
        return jsonify(message='Палету закрито')

    app.register_blueprint(bp)
