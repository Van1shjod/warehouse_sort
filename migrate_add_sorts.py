import sqlite3
from datetime import datetime

def migrate():
    conn = sqlite3.connect('warehouse.db')
    cursor = conn.cursor()

    try:
        # Створити таблицю сортів (зон/рамп)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sorts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                unload_date DATE NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                closed_at TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users (id)
            )
        ''')

        # Додати поле sort_id до таблиці icc_codes
        try:
            cursor.execute('ALTER TABLE icc_codes ADD COLUMN sort_id INTEGER')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_icc_sort ON icc_codes(sort_id)')
        except sqlite3.OperationalError:
            print('Pole sort_id vzhe isnuye v icc_codes')

        # Додати поле sort_id до таблиці user_container_sessions
        try:
            cursor.execute('ALTER TABLE user_container_sessions ADD COLUMN sort_id INTEGER')
        except sqlite3.OperationalError:
            print('Pole sort_id vzhe isnuye v user_container_sessions')

        conn.commit()
        print('Mihratsiya uspishno vykonana!')
        print('Stvoreno tablytsu: sorts')
        print('Dodano polya sort_id do icc_codes ta user_container_sessions')

    except Exception as e:
        conn.rollback()
        print(f'Pomylka mihratsiyi: {e}')
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
