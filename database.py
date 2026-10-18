import sqlite3
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

class Database:
    def __init__(self, db_name='warehouse.db'):
        self.db_name = db_name
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_name)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        conn = self.get_connection()
        cursor = conn.cursor()

        # Таблиця користувачів
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_cartons INTEGER DEFAULT 0,
                last_activity TIMESTAMP
            )
        ''')

        # Таблиця ICC кодів
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS icc_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                icc_code TEXT UNIQUE NOT NULL,
                type TEXT NOT NULL,
                total_cartons INTEGER NOT NULL,
                current_cartons INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_completed INTEGER DEFAULT 0,
                last_4_digits TEXT NOT NULL
            )
        ''')

        # Таблиця палет
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS pallets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pallet_number TEXT NOT NULL,
                icc_code_id INTEGER,
                user_id INTEGER,
                type TEXT NOT NULL,
                cartons_count INTEGER DEFAULT 0,
                is_closed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP,
                FOREIGN KEY (icc_code_id) REFERENCES icc_codes (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')

        # Таблиця активності
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')

        # Створити admin акаунт якщо його немає
        cursor.execute("SELECT * FROM users WHERE username = 'admin'")
        if not cursor.fetchone():
            hashed_password = generate_password_hash('admin1324')
            cursor.execute(
                "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                ('admin', hashed_password, 'admin')
            )

        conn.commit()
        conn.close()

    # Методи для користувачів
    def create_user(self, username, password, role='user'):
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            hashed_password = generate_password_hash(password)
            cursor.execute(
                "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                (username, hashed_password, role)
            )
            conn.commit()
            return True, "Користувача створено"
        except sqlite3.IntegrityError:
            return False, "Користувач вже існує"
        finally:
            conn.close()

    def verify_user(self, username, password):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        conn.close()

        if user and check_password_hash(user['password'], password):
            return True, dict(user)
        return False, None

    def get_user_by_id(self, user_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        conn.close()
        return dict(user) if user else None

    def get_all_users(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users ORDER BY created_at DESC")
        users = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return users

    def delete_user(self, user_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

    def update_user_cartons(self, user_id, cartons):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET total_cartons = total_cartons + ? WHERE id = ?",
            (cartons, user_id)
        )
        conn.commit()
        conn.close()

    # Методи для ICC кодів
    def create_icc_code(self, icc_code, type_name, total_cartons, last_4_digits, location_code=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO icc_codes (icc_code, type, total_cartons, last_4_digits, location_code) VALUES (?, ?, ?, ?, ?)",
                (icc_code, type_name, total_cartons, last_4_digits, location_code)
            )
            conn.commit()
            icc_id = cursor.lastrowid
            conn.close()
            return True, icc_id
        except sqlite3.IntegrityError:
            conn.close()
            return False, None

    def get_icc_code(self, icc_code):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM icc_codes WHERE icc_code = ?", (icc_code,))
        code = cursor.fetchone()
        conn.close()
        return dict(code) if code else None

    def get_icc_code_by_last_4(self, last_4_digits, type_name=None, total_cartons=None, location_code=None):
        """
        Знайти ICC код за останніми 4 цифрами та додатковими параметрами.
        Якщо передано total_cartons та location_code - шукає точний збіг (той самий товар).
        Інакше - шукає будь-який незавершений код з цими 4 цифрами.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        # Якщо передано всі параметри - шукаємо точний збіг
        if total_cartons is not None and location_code is not None:
            query = """
                SELECT * FROM icc_codes
                WHERE last_4_digits = ?
                AND type = ?
                AND total_cartons = ?
                AND location_code = ?
                AND is_completed = 0
                ORDER BY created_at DESC
                LIMIT 1
            """
            cursor.execute(query, (last_4_digits, type_name, total_cartons, location_code))
        # Інакше шукаємо будь-який незавершений код
        elif type_name:
            cursor.execute("SELECT * FROM icc_codes WHERE last_4_digits = ? AND type = ? AND is_completed = 0 ORDER BY created_at DESC LIMIT 1", (last_4_digits, type_name))
        else:
            cursor.execute("SELECT * FROM icc_codes WHERE last_4_digits = ? AND is_completed = 0 ORDER BY created_at DESC LIMIT 1", (last_4_digits,))

        code = cursor.fetchone()
        conn.close()
        return dict(code) if code else None

    def get_icc_code_by_id(self, icc_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM icc_codes WHERE id = ?", (icc_id,))
        code = cursor.fetchone()
        conn.close()
        return dict(code) if code else None

    def update_icc_cartons(self, icc_code, cartons_added):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE icc_codes SET current_cartons = current_cartons + ? WHERE icc_code = ?",
            (cartons_added, icc_code)
        )
        cursor.execute(
            "UPDATE icc_codes SET is_completed = 1 WHERE icc_code = ? AND current_cartons >= total_cartons",
            (icc_code,)
        )
        conn.commit()
        conn.close()

    def update_icc_cartons_by_id(self, icc_id, cartons_added):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE icc_codes SET current_cartons = current_cartons + ? WHERE id = ?",
            (cartons_added, icc_id)
        )
        cursor.execute(
            "UPDATE icc_codes SET is_completed = 1 WHERE id = ? AND current_cartons >= total_cartons AND total_cartons > 0",
            (icc_id,)
        )
        conn.commit()
        conn.close()

    def get_all_icc_codes(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM icc_codes ORDER BY created_at DESC")
        codes = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return codes

    # Методи для палет
    def create_pallet(self, pallet_number, icc_code_id, user_id, type_name, cartons_count):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO pallets (pallet_number, icc_code_id, user_id, type, cartons_count) VALUES (?, ?, ?, ?, ?)",
            (pallet_number, icc_code_id, user_id, type_name, cartons_count)
        )
        conn.commit()
        pallet_id = cursor.lastrowid
        conn.close()
        return pallet_id

    def close_pallet(self, pallet_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE pallets SET is_closed = 1, closed_at = ? WHERE id = ?",
            (datetime.now(), pallet_id)
        )
        conn.commit()
        conn.close()

    def get_open_pallet(self, icc_code_id, user_id, type_name=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        if type_name:
            cursor.execute(
                "SELECT * FROM pallets WHERE icc_code_id = ? AND user_id = ? AND type = ? AND is_closed = 0 ORDER BY created_at DESC LIMIT 1",
                (icc_code_id, user_id, type_name)
            )
        else:
            cursor.execute(
                "SELECT * FROM pallets WHERE icc_code_id = ? AND user_id = ? AND is_closed = 0 ORDER BY created_at DESC LIMIT 1",
                (icc_code_id, user_id)
            )
        pallet = cursor.fetchone()
        conn.close()
        return dict(pallet) if pallet else None

    def get_all_pallets(self, icc_code_id=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        if icc_code_id:
            cursor.execute("SELECT * FROM pallets WHERE icc_code_id = ? ORDER BY created_at DESC", (icc_code_id,))
        else:
            cursor.execute("SELECT * FROM pallets ORDER BY created_at DESC")
        pallets = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return pallets

    def get_closed_pallets_count(self, user_id, type_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as count FROM pallets WHERE user_id = ? AND type = ? AND is_closed = 1",
            (user_id, type_name)
        )
        result = cursor.fetchone()
        conn.close()
        return result['count'] if result else 0

    def update_pallet_cartons(self, pallet_id, cartons_added):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE pallets SET cartons_count = cartons_count + ? WHERE id = ?",
            (cartons_added, pallet_id)
        )
        conn.commit()
        conn.close()

    # Методи для логів активності
    def log_activity(self, user_id, action, details=""):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)",
            (user_id, action, details)
        )
        # Оновити last_activity для користувача
        if user_id:
            cursor.execute(
                "UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?",
                (user_id,)
            )
        conn.commit()
        conn.close()

    def get_user_activity(self, user_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM activity_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100",
            (user_id,)
        )
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return logs

    def get_all_activity(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 100")
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return logs

    # Методи для контейнерів
    def create_container(self, container_number):
        """Створити новий контейнер"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO containers (container_number, status) VALUES (?, ?)",
                (container_number, 'active')
            )
            conn.commit()
            container_id = cursor.lastrowid
            conn.close()
            return True, container_id
        except sqlite3.IntegrityError:
            conn.close()
            return False, None

    def get_all_containers(self, status=None):
        """Отримати всі контейнери (опціонально за статусом)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        if status:
            cursor.execute("SELECT * FROM containers WHERE status = ? ORDER BY created_at DESC", (status,))
        else:
            cursor.execute("SELECT * FROM containers ORDER BY created_at DESC")
        containers = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return containers

    def get_container_by_id(self, container_id):
        """Отримати контейнер за ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM containers WHERE id = ?", (container_id,))
        container = cursor.fetchone()
        conn.close()
        return dict(container) if container else None

    def get_container_by_number(self, container_number):
        """Отримати контейнер за номером"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM containers WHERE container_number = ?", (container_number,))
        container = cursor.fetchone()
        conn.close()
        return dict(container) if container else None

    def update_container_status(self, container_id, status):
        """Оновити статус контейнера"""
        conn = self.get_connection()
        cursor = conn.cursor()
        if status == 'completed':
            cursor.execute(
                "UPDATE containers SET status = ?, completed_at = ? WHERE id = ?",
                (status, datetime.now(), container_id)
            )
        else:
            cursor.execute(
                "UPDATE containers SET status = ? WHERE id = ?",
                (status, container_id)
            )
        conn.commit()
        conn.close()

    def start_container_session(self, user_id, container_id, sort_id=None):
        """Почати роботу користувача з контейнером"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Закрити всі попередні активні сесії цього користувача
        cursor.execute(
            "UPDATE user_container_sessions SET is_active = 0, ended_at = ? WHERE user_id = ? AND is_active = 1",
            (datetime.now(), user_id)
        )

        # Створити нову сесію з прив'язкою до сорту
        cursor.execute(
            "INSERT INTO user_container_sessions (user_id, container_id, sort_id, is_active) VALUES (?, ?, ?, 1)",
            (user_id, container_id, sort_id)
        )
        conn.commit()
        session_id = cursor.lastrowid
        conn.close()
        return session_id

    def end_container_session(self, user_id):
        """Завершити роботу користувача з контейнером"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE user_container_sessions SET is_active = 0, ended_at = ? WHERE user_id = ? AND is_active = 1",
            (datetime.now(), user_id)
        )
        conn.commit()
        conn.close()

    def get_active_container_session(self, user_id):
        """Отримати активну сесію контейнера для користувача"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ucs.*, c.container_number, c.status as container_status
            FROM user_container_sessions ucs
            JOIN containers c ON ucs.container_id = c.id
            WHERE ucs.user_id = ? AND ucs.is_active = 1
            ORDER BY ucs.started_at DESC
            LIMIT 1
        """, (user_id,))
        session = cursor.fetchone()
        conn.close()
        return dict(session) if session else None

    def get_users_working_on_container(self, container_id):
        """Отримати список користувачів, які працюють з контейнером"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT u.id, u.username, u.role, ucs.started_at
            FROM user_container_sessions ucs
            JOIN users u ON ucs.user_id = u.id
            WHERE ucs.container_id = ? AND ucs.is_active = 1
            ORDER BY ucs.started_at DESC
        """, (container_id,))
        users = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return users

    def get_all_active_sessions(self):
        """Отримати всі активні сесії (хто з яким контейнером працює)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                ucs.id, ucs.started_at,
                u.id as user_id, u.username, u.role,
                c.id as container_id, c.container_number, c.status as container_status
            FROM user_container_sessions ucs
            JOIN users u ON ucs.user_id = u.id
            JOIN containers c ON ucs.container_id = c.id
            WHERE ucs.is_active = 1
            ORDER BY ucs.started_at DESC
        """)
        sessions = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return sessions

    # Методи для сортів (зон/рамп)
    def create_sort(self, name, sort_type, unload_date, description, created_by):
        """Створити новий сорт (зону/рампу)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO sorts (name, type, unload_date, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                (name, sort_type, unload_date, description, 'active', created_by)
            )
            conn.commit()
            sort_id = cursor.lastrowid
            conn.close()
            return True, sort_id
        except Exception as e:
            conn.close()
            return False, str(e)

    def get_all_sorts(self, status=None):
        """Отримати всі сорти (опціонально за статусом)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        if status:
            cursor.execute("""
                SELECT s.*, u.username as created_by_name
                FROM sorts s
                LEFT JOIN users u ON s.created_by = u.id
                WHERE s.status = ?
                ORDER BY s.unload_date DESC, s.created_at DESC
            """, (status,))
        else:
            cursor.execute("""
                SELECT s.*, u.username as created_by_name
                FROM sorts s
                LEFT JOIN users u ON s.created_by = u.id
                ORDER BY s.unload_date DESC, s.created_at DESC
            """)
        sorts = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return sorts

    def get_sort_by_id(self, sort_id):
        """Отримати сорт за ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.*, u.username as created_by_name
            FROM sorts s
            LEFT JOIN users u ON s.created_by = u.id
            WHERE s.id = ?
        """, (sort_id,))
        sort = cursor.fetchone()
        conn.close()
        return dict(sort) if sort else None

    def update_sort(self, sort_id, name=None, sort_type=None, unload_date=None, description=None):
        """Оновити інформацію про сорт"""
        conn = self.get_connection()
        cursor = conn.cursor()

        updates = []
        params = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if sort_type is not None:
            updates.append("type = ?")
            params.append(sort_type)
        if unload_date is not None:
            updates.append("unload_date = ?")
            params.append(unload_date)
        if description is not None:
            updates.append("description = ?")
            params.append(description)

        if not updates:
            conn.close()
            return False

        params.append(sort_id)
        query = f"UPDATE sorts SET {', '.join(updates)} WHERE id = ?"

        cursor.execute(query, params)
        conn.commit()
        conn.close()
        return True

    def update_sort_status(self, sort_id, status):
        """Оновити статус сорту"""
        conn = self.get_connection()
        cursor = conn.cursor()
        if status == 'closed':
            cursor.execute(
                "UPDATE sorts SET status = ?, closed_at = ? WHERE id = ?",
                (status, datetime.now(), sort_id)
            )
        else:
            cursor.execute(
                "UPDATE sorts SET status = ? WHERE id = ?",
                (status, sort_id)
            )
        conn.commit()
        conn.close()

    def delete_sort(self, sort_id):
        """Видалити сорт"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sorts WHERE id = ?", (sort_id,))
        conn.commit()
        conn.close()

    def get_active_sorts_for_user(self):
        """Отримати активні сорти для вибору користувачем"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.*, u.username as created_by_name,
                   COUNT(DISTINCT icc.id) as icc_count,
                   SUM(CASE WHEN icc.is_completed = 1 THEN 1 ELSE 0 END) as completed_count
            FROM sorts s
            LEFT JOIN users u ON s.created_by = u.id
            LEFT JOIN icc_codes icc ON icc.sort_id = s.id
            WHERE s.status = 'active'
            GROUP BY s.id
            ORDER BY s.unload_date DESC, s.created_at DESC
        """)
        sorts = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return sorts

    def get_users_working_on_sort(self, sort_id):
        """Отримати список користувачів, які працюють з сортом"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT u.id, u.username, u.role, ucs.started_at
            FROM user_container_sessions ucs
            JOIN users u ON ucs.user_id = u.id
            WHERE ucs.sort_id = ? AND ucs.is_active = 1
            ORDER BY ucs.started_at DESC
        """, (sort_id,))
        users = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return users
