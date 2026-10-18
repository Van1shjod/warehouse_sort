import sqlite3

def migrate():
    conn = sqlite3.connect('warehouse.db')
    cursor = conn.cursor()

    # Перевірити чи існує колонка location_code
    cursor.execute("PRAGMA table_info(icc_codes)")
    columns = [column[1] for column in cursor.fetchall()]

    if 'location_code' not in columns:
        print("Dodayemo kolonku location_code...")
        cursor.execute("ALTER TABLE icc_codes ADD COLUMN location_code TEXT")
        conn.commit()
        print("OK - Kolonka location_code dodana uspishno!")
    else:
        print("Kolonka location_code vzhe isnuye")

    conn.close()

if __name__ == '__main__':
    migrate()
