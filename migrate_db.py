import sqlite3

def migrate_database():
    conn = sqlite3.connect('warehouse.db')
    cursor = conn.cursor()

    # Перевірити чи існує колонка last_activity
    cursor.execute("PRAGMA table_info(users)")
    columns = [column[1] for column in cursor.fetchall()]

    if 'last_activity' not in columns:
        print("Додаю колонку last_activity до таблиці users...")
        cursor.execute("ALTER TABLE users ADD COLUMN last_activity TIMESTAMP")
        conn.commit()
        print("✓ Колонку last_activity успішно додано")
    else:
        print("✓ Колонка last_activity вже існує")

    conn.close()
    print("\nМіграція завершена успішно!")

if __name__ == '__main__':
    migrate_database()
