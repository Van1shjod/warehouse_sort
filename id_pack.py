"""Barcode ID Pack receipts, atomic with SORT stock."""
import json
import re
from contextlib import contextmanager
from functools import wraps
from uuid import uuid4

from flask import Blueprint, jsonify, request, session

from sorting import SortError


def id_pack_group(value):
    """Two characters, all following leading zeros, then four more characters.

    Zeros are part of the returned key. Zeros inside the final four characters
    are ordinary characters, not another run to skip.
    """
    end = 2
    while end < len(value) and value[end] == '0':
        end += 1
    end += 4
    if len(value) < end:
        raise SortError('Недостатньо символів ID Pack після початкових нулів.')
    return value[:end]


def register_id_pack(app, db):
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

    # Additive migration; production SQLite backup is made before activation.
    with connection(write=True) as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS id_pack_groups (
            id INTEGER PRIMARY KEY, sort_id INTEGER NOT NULL, type TEXT NOT NULL,
            prefix TEXT NOT NULL, expected_qty INTEGER, icc_id INTEGER NOT NULL UNIQUE,
            UNIQUE(sort_id,type,prefix))''')
        conn.execute('''CREATE TABLE IF NOT EXISTS id_pack_receipts (
            request_id TEXT PRIMARY KEY, group_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL, manual_quantity INTEGER NOT NULL,
            payload TEXT NOT NULL, response TEXT NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS id_pack_scans (
            id INTEGER PRIMARY KEY, request_id TEXT NOT NULL, full_id TEXT NOT NULL)''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_id_pack_receipts ON id_pack_receipts(group_id)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_id_pack_scans ON id_pack_scans(request_id)')

    bp = Blueprint('id_pack', __name__)

    def authorized(admin=False):
        def decorate(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                user = db.get_user_by_id(session.get('user_id')) if session.get('user_id') else None
                if not user:
                    return jsonify(error='Необхідна авторизація'), 401
                if admin and user['role'] != 'admin':
                    return jsonify(error='Доступ лише для адміністратора'), 403
                return fn(*args, **kwargs)
            return wrapped
        return decorate

    @bp.errorhandler(SortError)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    def integer(value, label, zero=False):
        if isinstance(value, bool) or not re.fullmatch(r'0|[1-9]\d{0,8}' if zero else r'[1-9]\d{0,8}', str(value)):
            raise SortError(f'{label}: введіть ціле число ' + ('від 0' if zero else 'більше нуля'))
        return int(value)

    def full_id(value):
        # Preserve case, spaces, punctuation and the complete barcode. Only trim
        # scanner terminators; grouping is by Unicode characters, not byte count.
        if not isinstance(value, str):
            raise SortError('Введіть ID Pack (щонайменше 6 символів)')
        value = value.rstrip('\r\n')
        if not 6 <= len(value) <= 500 or any(ord(c) < 32 for c in value):
            raise SortError('Введіть ID Pack (від 6 до 500 символів)')
        return value

    def identity(data):
        if not isinstance(data, dict):
            raise SortError('Невірний формат запиту')
        sort_id = integer(data.get('sort_id'), 'Оберіть сорт')
        kind = data.get('type')
        if kind not in ('single', 'mix'):
            raise SortError('Оберіть Single або Mix')
        code = full_id(data.get('id_pack'))
        return sort_id, kind, id_pack_group(code)

    def active(conn, sort_id, kind):
        row = conn.execute('SELECT * FROM sorts WHERE id=?', (sort_id,)).fetchone()
        if not row or row['status'] == 'deleted':
            raise SortError('Сорт не знайдено', 404)
        if row['mode'] != 'sort' or row['status'] != 'active':
            raise SortError('Цей SORT не активний. Оберіть активне завдання.', 409)
        if kind not in row['type'].split(','):
            raise SortError('Цей тип картонів не дозволений у вибраному SORT')

    @bp.post('/api/id-pack/resolve')
    @authorized()
    def resolve():
        sort_id, kind, prefix = identity(request.get_json(silent=True))
        with connection() as conn:
            active(conn, sort_id, kind)
            group = conn.execute('''SELECT g.id,g.expected_qty,i.current_cartons collected
                FROM id_pack_groups g JOIN icc_codes i ON i.id=g.icc_id
                WHERE g.sort_id=? AND g.type=? AND g.prefix=?''', (sort_id, kind, prefix)).fetchone()
            return jsonify(prefix=prefix, group=dict(group) if group else None)

    @bp.post('/api/id-pack/submit')
    @authorized()
    def submit():
        data = request.get_json(silent=True)
        sort_id, kind, prefix = identity(data)
        expected = integer(data.get('expected_qty'), 'Очікувана кількість картонів') if kind == 'single' else None
        scans = data.get('scans')
        if not isinstance(scans, list) or len(scans) > 10000:
            raise SortError('Невірний список ID Pack')
        scans = [full_id(value) for value in scans]
        if any(id_pack_group(value) != prefix for value in scans):
            raise SortError('Це інший картон')
        manual = integer(data.get('manual_quantity', 0), 'Ручна кількість', zero=True)
        amount = integer(len(scans) + manual, 'Кількість картонів')
        number = data.get('pallet_number')
        if not isinstance(number, str) or not number.strip() or len(number.strip()) > 80:
            raise SortError('Введіть номер палети (до 80 символів)')
        number = number.strip().upper()
        token = data.get('request_id')
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}', token):
            raise SortError('Оновіть сторінку та повторіть збереження')
        payload = json.dumps([session['user_id'], sort_id, kind, prefix, expected, scans, manual, number], ensure_ascii=False)
        with connection(write=True) as conn:
            previous = conn.execute('SELECT * FROM id_pack_receipts WHERE request_id=?', (token,)).fetchone()
            if previous:
                if previous['payload'] != payload:
                    raise SortError('Ідентифікатор уже належить іншому збереженню', 409)
                return jsonify(**json.loads(previous['response']), repeated=True)
            active(conn, sort_id, kind)
            group = conn.execute('SELECT * FROM id_pack_groups WHERE sort_id=? AND type=? AND prefix=?', (sort_id, kind, prefix)).fetchone()
            if group and group['expected_qty'] != expected:
                raise SortError('Очікувана кількість цієї групи вже задана. Перевірте дані.', 409)
            if group:
                icc_id, group_id = group['icc_id'], group['id']
                current = conn.execute('SELECT current_cartons FROM icc_codes WHERE id=?', (icc_id,)).fetchone()[0]
            else:
                current = 0
                icc_id = conn.execute('''INSERT INTO icc_codes(icc_code,type,total_cartons,last_4_digits,location_code,sort_id)
                    VALUES(?,?,?,?,?,?)''', ('IDPACK-' + uuid4().hex, kind, expected or 0, prefix, 'ID PACK', sort_id)).lastrowid
                group_id = conn.execute('INSERT INTO id_pack_groups(sort_id,type,prefix,expected_qty,icc_id) VALUES(?,?,?,?,?)',
                                        (sort_id, kind, prefix, expected, icc_id)).lastrowid
            if expected is not None and current + amount > expected:
                raise SortError(f'Кількість перевищує очікувану. Уже додано {current} із {expected}.', 409)
            pallet = conn.execute('''SELECT * FROM pallets WHERE icc_code_id=? AND user_id=? AND pallet_number=?
                AND is_closed=0 ORDER BY id DESC LIMIT 1''', (icc_id, session['user_id'], number)).fetchone()
            if pallet:
                pallet_id = pallet['id']
                conn.execute('UPDATE pallets SET cartons_count=cartons_count+? WHERE id=?', (amount, pallet_id))
            else:
                pallet_id = conn.execute('''INSERT INTO pallets(pallet_number,icc_code_id,user_id,type,cartons_count)
                    VALUES(?,?,?,?,?)''', (number, icc_id, session['user_id'], kind, amount)).lastrowid
            from inventory import record_sort_receipt, InventoryError
            try:
                record_sort_receipt(conn, sort_id, kind, prefix, 'ID PACK', expected or 0,
                                    amount, pallet_id, number, session['user_id'], 'idpack-' + token)
            except InventoryError as error:
                raise SortError(str(error), error.status)
            count = current + amount
            completed = int(expected is not None and count == expected)
            conn.execute('UPDATE icc_codes SET current_cartons=?,is_completed=? WHERE id=?', (count, completed, icc_id))
            conn.execute('UPDATE users SET total_cartons=total_cartons+?,last_activity=CURRENT_TIMESTAMP WHERE id=?', (amount, session['user_id']))
            conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)',
                         (session['user_id'], 'add_cartons', f'SORT #{sort_id}: ID Pack {prefix}, +{amount}, палета {number}'))
            result = dict(group_id=group_id, prefix=prefix, quantity=amount, collected=count,
                          expected_qty=expected, is_completed=bool(completed), pallet_number=number)
            conn.execute('INSERT INTO id_pack_receipts VALUES(?,?,?,?,?,?)',
                         (token, group_id, amount, manual, payload, json.dumps(result, ensure_ascii=False)))
            conn.executemany('INSERT INTO id_pack_scans(request_id,full_id) VALUES(?,?)', [(token, value) for value in scans])
            return jsonify(result), 201

    @bp.get('/api/admin/id-pack/groups')
    @authorized(admin=True)
    def groups():
        sort_id = integer(request.args.get('sort_id'), 'Оберіть сорт')
        kind = request.args.get('type', 'single')
        if kind not in ('single', 'mix'):
            raise SortError('Оберіть Single або Mix')
        with connection() as conn:
            sort = conn.execute("SELECT * FROM sorts WHERE id=? AND mode='sort' AND status<>'deleted'", (sort_id,)).fetchone()
            if not sort:
                raise SortError('Сорт не знайдено', 404)
            rows = conn.execute('''SELECT g.id,g.prefix,g.expected_qty,SUM(r.quantity) quantity,
                SUM(r.manual_quantity) manual_quantity FROM id_pack_groups g
                JOIN id_pack_receipts r ON r.group_id=g.id WHERE g.sort_id=? AND g.type=?
                GROUP BY g.id ORDER BY g.prefix''', (sort_id, kind))
            return jsonify([dict(row) for row in rows])

    @bp.get('/api/admin/id-pack/groups/<int:group_id>')
    @authorized(admin=True)
    def group_detail(group_id):
        with connection() as conn:
            group = conn.execute('''SELECT g.* FROM id_pack_groups g JOIN sorts s ON s.id=g.sort_id
                WHERE g.id=? AND s.status<>'deleted' ''', (group_id,)).fetchone()
            if not group:
                raise SortError('Групу не знайдено', 404)
            ids = [r['full_id'] for r in conn.execute('''SELECT s.full_id FROM id_pack_scans s
                JOIN id_pack_receipts r ON r.request_id=s.request_id WHERE r.group_id=? ORDER BY s.id''', (group_id,))]
            manual = conn.execute('SELECT COALESCE(SUM(manual_quantity),0) FROM id_pack_receipts WHERE group_id=?', (group_id,)).fetchone()[0]
            return jsonify(prefix=group['prefix'], type=group['type'], sort_id=group['sort_id'],
                           expected_qty=group['expected_qty'], scans=ids, manual_quantity=manual,
                           quantity=len(ids) + manual)

    app.register_blueprint(bp)
