"""Mixed unloading pallets and a searchable inventory of their contents."""
import re
from datetime import date
from contextlib import contextmanager
from functools import wraps
from uuid import uuid4

from flask import Blueprint, jsonify, redirect, render_template, request, session


SCHEMA = """
CREATE TABLE IF NOT EXISTS sorts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL,
    unload_date DATE NOT NULL, description TEXT, status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, closed_at TEXT,
    mode TEXT NOT NULL DEFAULT 'sort'
);
CREATE TABLE IF NOT EXISTS presort_jobs (
    sort_id INTEGER PRIMARY KEY, container_id INTEGER NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS presort_pallets (
    id INTEGER PRIMARY KEY, container_id INTEGER NOT NULL,
    number INTEGER NOT NULL, user_id INTEGER NOT NULL,
    closed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(container_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS presort_one_open
    ON presort_pallets(container_id, user_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS presort_scans (
    id INTEGER PRIMARY KEY, pallet_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, type TEXT NOT NULL, code TEXT NOT NULL,
    location TEXT NOT NULL, pack INTEGER NOT NULL,
    request_id TEXT NOT NULL UNIQUE, undone INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS presort_inventory ON presort_scans(pallet_id, undone);
"""


def create_presort_job(db, name, types, unload_date, description, user_id):
    """The admin-only sorts endpoint calls this atomic creation operation."""
    if not re.fullmatch(r'(?:Zona (?:Single|Mix) [ABC]|Rampa [1-9])', name):
        raise ValueError('Оберіть зону або рампу')
    selected = types.split(',')
    if not selected or any(t not in ('single', 'mix', 'vevor') for t in selected):
        raise ValueError('Оберіть типи картонів')
    date.fromisoformat(unload_date)
    conn = db.get_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        cursor = conn.execute('''INSERT INTO sorts
            (name,type,unload_date,description,created_by,mode) VALUES(?,?,?,?,?,'presort')''',
            (name, types, unload_date, description, user_id))
        sort_id = cursor.lastrowid
        # Keep the original pallet inventory intact behind the named Pre-sort.
        cursor = conn.execute("INSERT INTO containers(container_number,status) VALUES(?,'active')",
                              ('PRE-SORT-' + str(sort_id) + '-' + uuid4().hex[:8],))
        conn.execute('INSERT INTO presort_jobs(sort_id,container_id) VALUES(?,?)',
                     (sort_id, cursor.lastrowid))
        conn.commit()
        return sort_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def close_presort_job(db, sort_id):
    conn = db.get_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        job = conn.execute("SELECT * FROM sorts WHERE id=? AND mode='presort' AND status<>'deleted'", (sort_id,)).fetchone()
        if not job:
            raise ValueError('Pre-sort не знайдено')
        conn.execute("UPDATE sorts SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?", (sort_id,))
        conn.execute('''UPDATE presort_pallets SET closed_at=CURRENT_TIMESTAMP
            WHERE closed_at IS NULL AND container_id=(
                SELECT container_id FROM presort_jobs WHERE sort_id=?)''', (sort_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def register_presort(app, db):
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

    with connection() as conn:
        conn.executescript(SCHEMA)
        columns = [row['name'] for row in conn.execute('PRAGMA table_info(sorts)')]
        if 'mode' not in columns:
            conn.execute("ALTER TABLE sorts ADD COLUMN mode TEXT NOT NULL DEFAULT 'sort'")

    # Adopt existing unloading inventories once, without renumbering their pallets.
    with connection(write=True) as conn:
        legacy = conn.execute('''SELECT DISTINCT c.* FROM containers c
            JOIN presort_pallets p ON p.container_id=c.id
            LEFT JOIN presort_jobs j ON j.container_id=c.id WHERE j.sort_id IS NULL''').fetchall()
        for row in legacy:
            creator = conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
            cursor = conn.execute('''INSERT INTO sorts
                (name,type,unload_date,description,status,created_by,mode)
                VALUES(?,'single,mix,vevor',?,'Перенесено з попереднього Pre-sort',?,?,'presort')''',
                (row['container_number'], (row['created_at'] or date.today().isoformat())[:10],
                 'active' if row['status'] == 'active' else 'closed', creator['id'] if creator else None))
            conn.execute('INSERT INTO presort_jobs VALUES(?,?)', (cursor.lastrowid, row['id']))

    bp = Blueprint('presort', __name__)

    def authenticated(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not session.get('user_id') or not db.get_user_by_id(session['user_id']):
                if request.endpoint == 'presort.page':
                    return redirect('/')
                return jsonify(error='Необхідна авторизація'), 401
            return fn(*args, **kwargs)
        return wrapped

    @bp.errorhandler(ValueError)
    def invalid(error):
        return jsonify(error=str(error)), 400

    def admin_only(fn):
        @authenticated
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if db.get_user_by_id(session['user_id'])['role'] != 'admin':
                return jsonify(error='Потрібні права адміністратора'), 403
            return fn(*args, **kwargs)
        return wrapped

    @bp.get('/api/admin/presort/jobs')
    @admin_only
    def admin_jobs():
        # The source link survives conversion, so no filter on sorts.mode/status.
        with connection() as conn:
            jobs = [dict(row) for row in conn.execute('''
                SELECT s.id,s.name,s.type,s.mode,s.status,s.unload_date,
                    COUNT(DISTINCT p.id) AS pallets_count,
                    COUNT(sc.id) AS scans_count,
                    SUM(CASE WHEN sc.undone=0 THEN 1 ELSE 0 END) AS cartons_count,
                    SUM(CASE WHEN sc.undone=1 THEN 1 ELSE 0 END) AS undone_count
                FROM presort_jobs j JOIN sorts s ON s.id=j.sort_id
                LEFT JOIN presort_pallets p ON p.container_id=j.container_id
                LEFT JOIN presort_scans sc ON sc.pallet_id=p.id
                WHERE s.status<>'deleted'
                GROUP BY s.id ORDER BY s.unload_date DESC,s.id DESC
            ''')]
        return jsonify(jobs=jobs)

    @bp.get('/api/admin/presort/jobs/<int:sort_id>/products')
    @admin_only
    def admin_products(sort_id):
        kind = request.args.get('type', 'all')
        query = request.args.get('q', '').strip()
        page = positive(request.args.get('page', '1'))
        if kind not in ('all', 'single', 'mix', 'vevor') or len(query) > 120:
            raise ValueError('Невірний фільтр товарів')
        with connection() as conn:
            job = conn.execute('''SELECT s.id,s.name,s.type,s.mode,s.status,s.unload_date,
                j.container_id FROM sorts s JOIN presort_jobs j ON j.sort_id=s.id
                WHERE s.id=? AND s.status<>'deleted' ''', (sort_id,)).fetchone()
            if not job:
                return jsonify(error='Завдання Pre-sort не знайдено'), 404
            params = [job['container_id']]
            condition = ''
            if kind != 'all':
                condition = ' AND sc.type=?'
                params.append(kind)
            # Aggregate the whole inventory, never only one page of scan history.
            rows = conn.execute('''SELECT sc.type,sc.code,sc.location,sc.pack,
                p.id AS pallet_id,p.number,p.closed_at,COUNT(*) AS cartons,
                MAX(sc.created_at) AS last_added_at
                FROM presort_scans sc JOIN presort_pallets p ON p.id=sc.pallet_id
                WHERE p.container_id=? AND sc.undone=0''' + condition + '''
                GROUP BY sc.type,sc.code,sc.location,sc.pack,p.id
                ORDER BY sc.code,sc.location,sc.pack,sc.type,p.number''', params).fetchall()
        products = {}
        for row in rows:
            key = (row['type'], row['code'], row['location'], row['pack'])
            if key not in products:
                products[key] = dict(type=row['type'], code=row['code'], location=row['location'],
                                     pack=row['pack'], cartons=0, pallets=[], last_added_at=row['last_added_at'])
            item = products[key]
            item['cartons'] += row['cartons']
            item['last_added_at'] = max(item['last_added_at'], row['last_added_at'])
            item['pallets'].append(dict(number=row['number'], cartons=row['cartons'], closed=bool(row['closed_at'])))
        result = []
        terms = query.upper().split()
        for item in products.values():
            text = f"{item['code']} {item['location']} {item['pack']}PACK {item['pack']} PACK {item['type']}".upper()
            if not all(term in text for term in terms):
                continue
            planned = item['pack'] if item['type'] != 'mix' and item['pack'] > 0 else None
            item.update(pallets_count=len(item['pallets']),
                        closed_pallets=sum(pallet['closed'] for pallet in item['pallets']),
                        planned=planned,
                        remaining=max(0, planned - item['cartons']) if planned else None,
                        excess=max(0, item['cartons'] - planned) if planned else None,
                        percent=round(item['cartons'] * 100 / planned, 1) if planned else None)
            result.append(item)
        total = len(result)
        pages = max(1, (total + 99) // 100)
        page = min(page, pages)
        return jsonify(job=dict(job), products=result[(page - 1) * 100:page * 100],
                       total=total, page=page, pages=pages, page_size=100)

    @bp.get('/api/admin/presort/jobs/<int:sort_id>/scans')
    @admin_only
    def admin_scans(sort_id):
        kind = request.args.get('type', 'all')
        status = request.args.get('scan_status', 'valid')
        query = request.args.get('q', '').strip()
        page = positive(request.args.get('page', '1'))
        if kind not in ('all', 'single', 'mix', 'vevor') or status not in ('all', 'valid', 'undone'):
            raise ValueError('Невірний фільтр сканувань')
        if len(query) > 120:
            raise ValueError('Пошуковий запит має бути не довшим за 120 символів')
        with connection() as conn:
            job = conn.execute('''SELECT s.id,s.name,s.type,s.mode,s.status,s.unload_date,
                j.container_id FROM sorts s JOIN presort_jobs j ON j.sort_id=s.id
                WHERE s.id=? AND s.status<>'deleted' ''', (sort_id,)).fetchone()
            if not job:
                return jsonify(error='Завдання Pre-sort не знайдено'), 404
            params = [job['container_id']]
            where = ['p.container_id=?']
            if kind != 'all':
                where.append('sc.type=?'); params.append(kind)
            if status != 'all':
                where.append('sc.undone=?'); params.append(1 if status == 'undone' else 0)
            if query:
                # Literal search: percent and underscore are not SQL wildcards.
                escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                where.append("(sc.code || ' ' || sc.location || ' ' || sc.pack || ' ' || p.number || ' ' || COALESCE(u.username,'')) LIKE ? ESCAPE '\\'")
                params.append('%' + escaped + '%')
            source = ''' FROM presort_scans sc JOIN presort_pallets p ON p.id=sc.pallet_id
                LEFT JOIN users u ON u.id=sc.user_id WHERE ''' + ' AND '.join(where)
            total = conn.execute('SELECT COUNT(*)' + source, params).fetchone()[0]
            pages = max(1, (total + 99) // 100)
            page = min(page, pages)
            scans = [dict(row) for row in conn.execute('''SELECT sc.id,sc.type,sc.code,
                sc.location,sc.pack,sc.user_id,sc.created_at,sc.undone,
                p.number AS pallet_number,p.closed_at AS pallet_closed_at,u.username'''
                + source + ' ORDER BY sc.id DESC LIMIT 100 OFFSET ?', params + [(page - 1) * 100])]
        return jsonify(job=dict(job), scans=scans, total=total, page=page, pages=pages, page_size=100)

    @bp.post('/api/sorts/<int:sort_id>/convert-to-sort')
    @authenticated
    def convert_to_sort(sort_id):
        if db.get_user_by_id(session['user_id'])['role'] != 'admin':
            return jsonify(error='Потрібні права адміністратора'), 403
        with connection(write=True) as conn:
            job = conn.execute('''SELECT s.*,j.container_id FROM sorts s
                JOIN presort_jobs j ON j.sort_id=s.id WHERE s.id=? AND s.status<>'deleted' ''', (sort_id,)).fetchone()
            if not job:
                raise ValueError('Pre-sort не знайдено')
            if job['mode'] == 'sort':
                return jsonify(message='Завдання вже переведено в SORT', sort_id=sort_id)
            if job['status'] != 'closed':
                raise ValueError('Спочатку закрийте Pre-sort')
            # Keep the source inventory and the same task ID; never count unloading as sorting.
            conn.execute("UPDATE sorts SET mode='sort',status='active',closed_at=NULL WHERE id=?", (sort_id,))
            conn.execute('''INSERT INTO activity_log(user_id,action,details)
                VALUES(?,'convert_presort',?)''', (session['user_id'], f'Pre-sort #{sort_id} переведено в SORT'))
        return jsonify(message='Pre-sort переведено в SORT', sort_id=sort_id)

    @bp.get('/api/sorts/<int:sort_id>/presort-items')
    @authenticated
    def source_items(sort_id):
        with connection() as conn:
            job = conn.execute('''SELECT s.mode,s.name,j.container_id FROM sorts s
                JOIN presort_jobs j ON j.sort_id=s.id WHERE s.id=? AND s.status<>'deleted' ''', (sort_id,)).fetchone()
            if not job or job['mode'] != 'sort':
                return jsonify(items=[], has_source=False, source_name=None)
            items = [dict(row) for row in conn.execute('''
                SELECT s.type,s.code,s.location,s.pack,p.number,COUNT(*) AS cartons
                FROM presort_scans s JOIN presort_pallets p ON p.id=s.pallet_id
                WHERE p.container_id=? AND s.undone=0
                GROUP BY s.type,s.code,s.location,s.pack,p.id ORDER BY s.code,p.number
            ''', (job['container_id'],))]
        return jsonify(items=items, has_source=True, source_name=job['name'])

    def positive(value):
        if isinstance(value, bool) or not re.fullmatch(r'[1-9]\d{0,8}', str(value)):
            raise ValueError('Очікується додатне ціле число')
        return int(value)

    def container(conn, container_id, active=False):
        row = conn.execute('''SELECT c.id,s.id AS sort_id,s.name AS container_number,
            s.type,s.unload_date,s.description,s.status FROM presort_jobs j
            JOIN containers c ON c.id=j.container_id JOIN sorts s ON s.id=j.sort_id
            WHERE c.id=? AND s.mode='presort' AND s.status<>'deleted' ''', (container_id,)).fetchone()
        if not row:
            raise ValueError('Pre-sort не знайдено. Оберіть створений адміністратором Pre-sort.')
        if active and row['status'] != 'active':
            raise ValueError('Pre-sort не активний')
        return row

    def owned_open(conn, pallet_id):
        row = conn.execute('SELECT * FROM presort_pallets WHERE id=?', (pallet_id,)).fetchone()
        if not row or row['user_id'] != session['user_id']:
            raise ValueError('Ця палета не належить вам')
        if row['closed_at']:
            raise ValueError('Палета вже закрита')
        container(conn, row['container_id'], active=True)
        return row

    @bp.get('/presort')
    @authenticated
    def page():
        return render_template('presort.html', user=db.get_user_by_id(session['user_id']))

    @bp.get('/api/presort/containers')
    @authenticated
    def containers():
        with connection() as conn:
            rows = [dict(row) for row in conn.execute('''
                SELECT c.id,s.id AS sort_id,s.name AS container_number,s.type,
                    s.unload_date,s.description,s.status FROM presort_jobs j
                JOIN containers c ON c.id=j.container_id JOIN sorts s ON s.id=j.sort_id
                WHERE s.mode='presort' AND s.status<>'deleted' ORDER BY s.unload_date DESC,s.id DESC''')]
        return jsonify(rows)

    @bp.get('/api/presort/inventory')
    @authenticated
    def inventory():
        container_id = positive(request.args.get('container_id'))
        with connection() as conn:
            selected = dict(container(conn, container_id))
            pallets = [dict(row) for row in conn.execute('''
                SELECT p.*, u.username, COUNT(s.id) AS cartons
                FROM presort_pallets p LEFT JOIN users u ON u.id=p.user_id
                LEFT JOIN presort_scans s ON s.pallet_id=p.id AND s.undone=0
                WHERE p.container_id=? GROUP BY p.id ORDER BY p.number
            ''', (container_id,))]
            items = [dict(row) for row in conn.execute('''
                SELECT s.type, s.code, s.location, s.pack, p.id AS pallet_id,
                       p.number, p.closed_at, COUNT(*) AS cartons
                FROM presort_scans s JOIN presort_pallets p ON p.id=s.pallet_id
                WHERE p.container_id=? AND s.undone=0
                GROUP BY s.type,s.code,s.location,s.pack,p.id ORDER BY s.code,p.number
            ''', (container_id,))]
            last = conn.execute('''
                SELECT s.id FROM presort_scans s JOIN presort_pallets p ON p.id=s.pallet_id
                WHERE p.container_id=? AND p.user_id=? AND p.closed_at IS NULL
                  AND s.undone=0 ORDER BY s.id DESC LIMIT 1
            ''', (container_id, session['user_id'])).fetchone()
        return jsonify(container=selected, pallets=pallets, items=items,
                       user_id=session['user_id'], last_scan_id=last['id'] if last else None)

    @bp.post('/api/presort/pallets')
    @authenticated
    def open_pallet():
        data = request.get_json(silent=True) or {}
        container_id = positive(data.get('container_id'))
        with connection(write=True) as conn:
            container(conn, container_id, active=True)
            row = conn.execute('''SELECT * FROM presort_pallets
                WHERE container_id=? AND user_id=? AND closed_at IS NULL''',
                (container_id, session['user_id'])).fetchone()
            if row:
                return jsonify(dict(row))
            number = conn.execute('SELECT COALESCE(MAX(number),0)+1 FROM presort_pallets WHERE container_id=?',
                                  (container_id,)).fetchone()[0]
            cursor = conn.execute('INSERT INTO presort_pallets(container_id,number,user_id) VALUES(?,?,?)',
                                  (container_id, number, session['user_id']))
            pallet_id = cursor.lastrowid
        return jsonify(id=pallet_id, number=number), 201

    @bp.post('/api/presort/pallets/<int:pallet_id>/close')
    @authenticated
    def close_pallet(pallet_id):
        with connection(write=True) as conn:
            owned_open(conn, pallet_id)
            conn.execute('UPDATE presort_pallets SET closed_at=CURRENT_TIMESTAMP WHERE id=?', (pallet_id,))
        return jsonify(message='Палету закрито')

    @bp.post('/api/presort/scans')
    @authenticated
    def add_scan():
        data = request.get_json(silent=True) or {}
        pallet_id = positive(data.get('pallet_id'))
        kind = str(data.get('type', '')).lower()
        if kind == 'vevor' and app.config.get('VEVOR_UNAVAILABLE'):
            return jsonify(error='Vevor ще в розробці'), 409
        code = str(data.get('code', '')).strip().upper()
        location = str(data.get('location', '')).strip().upper()
        token = str(data.get('request_id', ''))
        if kind not in ('single', 'mix', 'vevor'):
            raise ValueError('Оберіть тип товару')
        if not re.fullmatch(r'[A-Z0-9]{4,20}' if kind == 'mix' else r'\d{4}', code):
            raise ValueError('Перевірте ICC код')
        pack = 0 if kind == 'mix' else positive(data.get('pack'))
        location = '' if kind == 'mix' else location
        if kind != 'mix' and not re.fullmatch(r'[A-Z]{2}-[A-Z]', location):
            raise ValueError('Введіть локацію у форматі JP-A')
        if not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', token):
            raise ValueError('Невірний ідентифікатор сканування')
        with connection(write=True) as conn:
            # Retrying the same HTTP operation must not count a second carton.
            previous = conn.execute('SELECT * FROM presort_scans WHERE request_id=?', (token,)).fetchone()
            if previous:
                expected = (pallet_id, session['user_id'], kind, code, location, pack)
                actual = tuple(previous[k] for k in ('pallet_id','user_id','type','code','location','pack'))
                if actual != expected:
                    raise ValueError('Цей ідентифікатор вже використано')
                return jsonify(id=previous['id'], repeated=True)
            pallet = owned_open(conn, pallet_id)
            job = container(conn, pallet['container_id'], active=True)
            if kind not in job['type'].split(','):
                raise ValueError('Цей тип картонів не дозволений у вибраному Pre-sort')
            cursor = conn.execute('''INSERT INTO presort_scans
                (pallet_id,user_id,type,code,location,pack,request_id) VALUES(?,?,?,?,?,?,?)''',
                (pallet_id, session['user_id'], kind, code, location, pack, token))
            scan_id = cursor.lastrowid
            from inventory_migration import record_presort_scan
            record_presort_scan(conn, scan_id)
        return jsonify(id=scan_id), 201

    @bp.post('/api/presort/scans/<int:scan_id>/undo')
    @authenticated
    def undo_scan(scan_id):
        with connection(write=True) as conn:
            scan = conn.execute('SELECT * FROM presort_scans WHERE id=?', (scan_id,)).fetchone()
            if not scan or scan['user_id'] != session['user_id']:
                raise ValueError('Сканування не знайдено')
            owned_open(conn, scan['pallet_id'])
            last = conn.execute('SELECT MAX(id) FROM presort_scans WHERE pallet_id=? AND undone=0',
                                (scan['pallet_id'],)).fetchone()[0]
            if last != scan_id:
                raise ValueError('Можна скасувати лише останній картон')
            from inventory_migration import undo_presort_scan
            undo_presort_scan(conn, scan_id, session['user_id'])
            conn.execute('UPDATE presort_scans SET undone=1 WHERE id=?', (scan_id,))
        return jsonify(message='Останній картон скасовано')

    app.register_blueprint(bp)
