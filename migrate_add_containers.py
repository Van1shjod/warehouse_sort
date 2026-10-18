import sqlite3
from datetime import datetime

def migrate():
    conn = sqlite3.connect('warehouse.db')
    cursor = conn.cursor()

    try:
        # Створити таблицю контейнерів
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS containers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                container_number TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        ''')

        # Створити таблицю для відслідковування хто працює з яким контейнером
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_container_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                container_id INTEGER NOT NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (container_id) REFERENCES containers (id)
            )
        ''')

        # Додати поле container_id до таблиці icc_codes (опціонально)
        try:
            cursor.execute('ALTER TABLE icc_codes ADD COLUMN container_id INTEGER')
        except sqlite3.OperationalError:
            print('Поле container_id вже існує в icc_codes')

        # Додати індекс для швидкого пошуку активних сесій
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_active_sessions
            ON user_container_sessions(user_id, is_active)
        ''')

        conn.commit()
        print('Migracija uspishno vykonana!')
        print('Stvoreno tablytsi: containers, user_container_sessions')

    except Exception as e:
        conn.rollback()
        print(f'Pomylka migratsii: {e}')
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
