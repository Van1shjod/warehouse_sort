"""Idempotent opening balances and transactional Pre-sort ledger integration.

Legacy tables remain an audit trail. Their counters are not used as live balances
after import: the authoritative balance is SUM(inventory_movements.delta).
Finishing a Pre-sort pallet only seals unloading; it does not close the inventory
location to picking. Explicit inventory pallet state controls that permission.
"""
import re
from uuid import NAMESPACE_URL, uuid5


def ledger_ready(conn):
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_movements'").fetchone())


def _helpers():
    # Imported lazily: inventory registers its schema before calling migration.
    from inventory import ensure_context, ensure_pack, ensure_pallet, append_operation, append_movement
    return ensure_context, ensure_pack, ensure_pallet, append_operation, append_movement


def _operation_id(source, legacy_id):
    return str(uuid5(NAMESPACE_URL, f'warehouse-inventory:{source}:{legacy_id}'))


def _imported(conn, source, legacy_id):
    return conn.execute('SELECT operation_id FROM inventory_imports WHERE source=? AND legacy_id=?',
                        (source, legacy_id)).fetchone()


def _scan(conn, scan_id):
    return conn.execute('''SELECT sc.*,p.container_id AS legacy_container_id,p.number,
        p.closed_at AS legacy_pallet_closed_at,j.sort_id
        FROM presort_scans sc JOIN presort_pallets p ON p.id=sc.pallet_id
        JOIN presort_jobs j ON j.container_id=p.container_id WHERE sc.id=?''', (scan_id,)).fetchone()


def record_presort_scan(conn, scan_id):
    """Append one receipt in the caller's transaction; never commit here."""
    if not ledger_ready(conn):
        return None
    previous = _imported(conn, 'presort-scan', scan_id)
    if previous:
        return previous['operation_id']
    scan = _scan(conn, scan_id)
    if not scan:
        raise ValueError('Сканування не має завдання Pre-sort')
    if scan['undone']:
        return None
    ensure_context, ensure_pack, ensure_pallet, append_operation, append_movement = _helpers()
    context = ensure_context(conn, scan['sort_id'])
    label_pack = int(scan['pack'])
    pack = ensure_pack(conn, context['id'], scan['type'], scan['code'], scan['location'], label_pack,
                       expected_qty=label_pack if scan['type'] != 'mix' and label_pack > 0 else None)
    pallet = ensure_pallet(conn, context['id'], str(scan['number']), stage='source',
                           legacy_presort_id=scan['pallet_id'], state='open')
    # A manager may have blocked a stock location independently of unloading.
    if pallet['state'] != 'open':
        raise ValueError('Палета закрита для рухів. Зверніться до адміністратора.')
    operation_id = _operation_id('presort-scan', scan_id)
    payload = dict(legacy_scan_id=scan_id, legacy_timestamp=scan['created_at'])
    append_operation(conn, operation_id, 'import-presort-' + str(scan_id), scan['user_id'],
                     context['id'], pack['id'], 'receive', payload=payload)
    append_movement(conn, operation_id, pack['id'], context['id'], pallet['id'], 1,
                    scan['user_id'], reason=f'Pre-sort: сканування #{scan_id}', timestamp=scan['created_at'])
    conn.execute('INSERT INTO inventory_imports(source,legacy_id,operation_id) VALUES(?,?,?)',
                 ('presort-scan', scan_id, operation_id))
    return operation_id


def undo_presort_scan(conn, scan_id, user_id):
    """Compensate a receipt without deleting it or allowing negative stock."""
    if not ledger_ready(conn):
        return None
    previous = _imported(conn, 'presort-undo', scan_id)
    if previous:
        return previous['operation_id']
    original_id = record_presort_scan(conn, scan_id)
    if original_id is None:
        raise ValueError('Сканування вже скасоване або не перенесене в облік рухів')
    already_undone = conn.execute('SELECT id FROM inventory_operations WHERE undo_of=?', (original_id,)).fetchone()
    if already_undone:
        conn.execute('INSERT INTO inventory_imports(source,legacy_id,operation_id) VALUES(?,?,?)',
                     ('presort-undo', scan_id, already_undone['id']))
        return already_undone['id']
    movement = conn.execute('''SELECT m.*,p.state FROM inventory_movements m
        JOIN inventory_pallets p ON p.id=m.pallet_id WHERE m.operation_id=?''', (original_id,)).fetchone()
    if not movement:
        raise ValueError('Не знайдено початковий рух сканування')
    if movement['state'] != 'open':
        raise ValueError('Палета закрита для рухів. Зверніться до адміністратора.')
    available = conn.execute('''SELECT COALESCE(SUM(delta),0) FROM inventory_movements
        WHERE pack_id=? AND pallet_id=?''', (movement['pack_id'], movement['pallet_id'])).fetchone()[0]
    if available < 1:
        raise ValueError('Недостатньо на палеті для скасування: картон уже забрали.')
    _, _, _, append_operation, append_movement = _helpers()
    operation_id = _operation_id('presort-undo', scan_id)
    append_operation(conn, operation_id, 'undo-presort-' + str(scan_id), user_id,
                     movement['container_id'], movement['pack_id'], 'undo_presort',
                     payload=dict(legacy_scan_id=scan_id), undo_of=original_id)
    append_movement(conn, operation_id, movement['pack_id'], movement['container_id'],
                    movement['pallet_id'], -1, user_id, reason=f'Скасування Pre-sort #{scan_id}')
    conn.execute('INSERT INTO inventory_imports(source,legacy_id,operation_id) VALUES(?,?,?)',
                 ('presort-undo', scan_id, operation_id))
    return operation_id


def _legacy_code(row):
    code = str(row['last_4_digits'] or '').strip().upper()
    if row['icc_type'] != 'mix':
        return code
    if re.fullmatch(r'[A-Z]\d{5,7}', code):
        return code
    full = str(row['icc_code'] or '').upper()
    if re.fullmatch(r'[A-Z]\d{5,7}', full):
        return full
    match = re.match(r'^MIX-([A-Z]\d{5,7})-', full)
    return match.group(1) if match else None


def migrate_inventory(conn):
    """Import known opening balances once; report ambiguous legacy rows.

    The caller owns the write transaction. No production connection is opened by
    this module, and neither legacy rows nor counters are rewritten.
    """
    report = dict(presort_scans_imported=0, sorted_pallets_imported=0,
                  unscoped_pallets_skipped=0, invalid_pallets_skipped=0, already_imported=0)
    if not ledger_ready(conn):
        return report
    for scan in conn.execute('''SELECT sc.id FROM presort_scans sc
        JOIN presort_pallets p ON p.id=sc.pallet_id JOIN presort_jobs j ON j.container_id=p.container_id
        JOIN sorts s ON s.id=j.sort_id WHERE sc.undone=0 ORDER BY sc.id''').fetchall():
        if _imported(conn, 'presort-scan', scan['id']):
            report['already_imported'] += 1
        else:
            record_presort_scan(conn, scan['id'])
            report['presort_scans_imported'] += 1
    ensure_context, ensure_pack, ensure_pallet, append_operation, append_movement = _helpers()
    rows = conn.execute('''SELECT p.*,i.type AS icc_type,i.last_4_digits,i.location_code,
        i.total_cartons,i.icc_code,i.sort_id,s.id AS known_sort_id FROM pallets p
        LEFT JOIN icc_codes i ON i.id=p.icc_code_id LEFT JOIN sorts s ON s.id=i.sort_id
        ORDER BY p.is_closed DESC,p.id''').fetchall()
    for row in rows:
        if not row['sort_id'] or not row['known_sort_id']:
            report['unscoped_pallets_skipped'] += 1
            continue
        if _imported(conn, 'sorted-pallet', row['id']):
            report['already_imported'] += 1
            continue
        amount = row['cartons_count']
        code = _legacy_code(row)
        number = str(row['pallet_number'] or '').strip()
        if not isinstance(amount, int) or amount <= 0 or not code or not number:
            report['invalid_pallets_skipped'] += 1
            continue
        kind = row['icc_type']
        label_pack = int(row['total_cartons']) if row['total_cartons'] is not None else 0
        context = ensure_context(conn, row['sort_id'])
        pack = ensure_pack(conn, context['id'], kind, code, row['location_code'] or '', label_pack,
                           expected_qty=label_pack if kind != 'mix' and label_pack > 0 else None)
        pallet = ensure_pallet(conn, context['id'], number, stage='sorted', legacy_sort_id=row['id'],
                               state='closed' if row['is_closed'] else 'open')
        operation_id = _operation_id('sorted-pallet', row['id'])
        append_operation(conn, operation_id, 'import-sorted-' + str(row['id']), row['user_id'],
                         context['id'], pack['id'], 'opening_balance',
                         payload=dict(legacy_pallet_id=row['id'], legacy_timestamp=row['created_at']))
        append_movement(conn, operation_id, pack['id'], context['id'], pallet['id'], amount,
                        row['user_id'], reason=f'Початковий залишок SORT: палета #{row["id"]}', timestamp=row['created_at'])
        conn.execute('INSERT INTO inventory_imports(source,legacy_id,operation_id) VALUES(?,?,?)',
                     ('sorted-pallet', row['id'], operation_id))
        report['sorted_pallets_imported'] += 1
    return report
