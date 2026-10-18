import sqlite3

def migrate_database():
    conn = sqlite3.connect('warehouse.db')
    cursor = conn.cursor()

    # Перевірити чи існує колонка last_4_digits
    cursor.execute("PRAGMA table_info(icc_codes)")
    columns = [column[1] for column in cursor.fetchall()]

    if 'last_4_digits' not in columns:
        print("Додаю колонку last_4_digits до таблиці icc_codes...")
        cursor.execute("ALTER TABLE icc_codes ADD COLUMN last_4_digits TEXT")

        # Оновити існуючі записи - взяти останні 4 символи з icc_code
        cursor.execute("SELECT id, icc_code FROM icc_codes")
        all_codes = cursor.fetchall()

        for icc_id, icc_code in all_codes:
            # Отримати останні 4 символи (якщо можливо цифри)
            last_4 = icc_code[-4:] if len(icc_code) >= 4 else icc_code
            cursor.execute("UPDATE icc_codes SET last_4_digits = ? WHERE id = ?", (last_4, icc_id))

        conn.commit()
        print(f"✓ Колонку last_4_digits успішно додано та оновлено {len(all_codes)} записів")
    else:
        print("✓ Колонка last_4_digits вже існує")

    conn.close()
    print("\nМіграція завершена успішно!")

if __name__ == '__main__':
    migrate_database()
