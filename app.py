from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from database import Database
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)

db = Database()

from presort import register_presort, create_presort_job, close_presort_job
register_presort(app, db)

from sorting import register_sorting, close_sort_job
register_sorting(app, db)

from inventory import register_inventory
register_inventory(app, db)
app.config['VEVOR_UNAVAILABLE'] = True

# RapidOCR - швидка альтернатива PaddleOCR для Windows
ocr_engine = None


@app.before_request
def validate_json_object():
    if request.method in ('POST','PUT','PATCH','DELETE') and request.is_json:
        if not isinstance(request.get_json(silent=True),dict):
            return jsonify(error='Очікується JSON об’єкт'),400


def valid_credentials(username,password,new=False):
    return (isinstance(username,str) and bool(username.strip()) and len(username)<=80
            and isinstance(password,str) and (4 if new else 1)<=len(password)<=4096)


def legacy_sort_request(endpoint):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get('sort_id'):
        return jsonify(error='Оновіть сторінку та оберіть SORT перед роботою з картонами.'), 400
    return app.view_functions[endpoint]()


def public_user(user):
    return {key: value for key, value in user.items() if key != 'password'} if user else None


def with_sort_sources(sorts):
    conn = db.get_connection()
    try:
        sources = {row['sort_id'] for row in conn.execute('SELECT sort_id FROM presort_jobs')}
    finally:
        conn.close()
    for sort in sorts:
        sort['has_presort_source'] = sort['id'] in sources
    return sorts

# Декоратор для перевірки авторизації
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session or not db.get_user_by_id(session['user_id']):
            session.clear()
            if not request.path.startswith('/api/'):
                return redirect('/')
            return jsonify({'error': 'Необхідна авторизація'}), 401
        return f(*args, **kwargs)
    return decorated_function

# Декоратор для перевірки ролі Admin (прибрано lider)
def admin_or_lider_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Необхідна авторизація'}), 401
        user = db.get_user_by_id(session['user_id'])
        if not user or user['role'] not in ['admin']:
            return jsonify({'error': 'Недостатньо прав'}), 403
        return f(*args, **kwargs)
    return decorated_function

# Декоратор для перевірки ролі Admin
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if not request.path.startswith('/api/'):
                return redirect('/')
            return jsonify({'error': 'Необхідна авторизація'}), 401
        user = db.get_user_by_id(session['user_id'])
        if not user or user['role'] != 'admin':
            if not request.path.startswith('/api/'):
                return redirect('/dashboard' if user else '/')
            return jsonify({'error': 'Потрібні права адміністратора'}), 403
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    if session.get('user_id') and db.get_user_by_id(session['user_id']):
        return redirect(url_for('dashboard'))
    session.clear()
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not valid_credentials(username,password,new=True):
        return jsonify({'error': 'Введіть логін і пароль'}), 400

    success, message = db.create_user(username, password)
    if success:
        db.log_activity(None, 'register', f'Новий користувач: {username}')
        return jsonify({'message': message}), 200
    return jsonify({'error': message}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not valid_credentials(username,password):
        return jsonify(error='Введіть коректні логін і пароль'),400

    success, user = db.verify_user(username, password)
    if success:
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        db.log_activity(user['id'], 'login', f'Вхід в систему')
        return jsonify({'message': 'Успішний вхід', 'role': user['role']}), 200
    return jsonify({'error': 'Невірний логін або пароль'}), 401

@app.route('/logout')
def logout():
    if 'user_id' in session:
        db.log_activity(session['user_id'], 'logout', 'Вихід з системи')
    session.clear()
    return redirect(url_for('index'))

@app.route('/dashboard')
@login_required
def dashboard():
    user = db.get_user_by_id(session['user_id'])
    return render_template('dashboard.html', user=user)

@app.route('/admin')
@admin_required
def admin_panel():
    return render_template('admin.html')

@app.route('/lider')
@admin_required
def lider_panel():
    return render_template('lider.html')

@app.route('/test_ocr_images')
@admin_required
def test_ocr_images():
    return render_template('test_ocr_images.html')

# API для роботи з ICC кодами
@app.route('/api/icc/check', methods=['POST'])
@login_required
def check_icc():
    return legacy_sort_request('sorting.check')

@app.route('/api/icc/create', methods=['POST'])
@login_required
def create_icc():
    return jsonify(error='Оновіть сторінку. Товар і картони зберігаються разом під час підтвердження SORT.'), 400

@app.route('/api/pallet/add', methods=['POST'])
@login_required
def add_to_pallet():
    return legacy_sort_request('sorting.submit')

@app.route('/api/pallet/close', methods=['POST'])
@login_required
def close_pallet():
    return legacy_sort_request('sorting.close')

@app.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    user_id = session['user_id']

    stats = {
        'single_pallets': db.get_closed_pallets_count(user_id, 'single'),
        'mix_pallets': db.get_closed_pallets_count(user_id, 'mix'),
        'vevor_pallets': db.get_closed_pallets_count(user_id, 'vevor')
    }

    return jsonify(stats), 200

# API для Admin (було Lider)
@app.route('/api/lider/pallets', methods=['GET'])
@admin_required
def get_all_pallets_info():
    pallets = db.get_all_pallets()
    icc_codes = db.get_all_icc_codes()
    users = db.get_all_users()

    # Збагатити палети інформацією
    result = []
    for pallet in pallets:
        icc = next((i for i in icc_codes if i['id'] == pallet['icc_code_id']), None)
        user = next((u for u in users if u['id'] == pallet['user_id']), None)

        result.append({
            'pallet': pallet,
            'icc': icc,
            'user': public_user(user)
        })

    return jsonify(result), 200

@app.route('/api/lider/icc_codes', methods=['GET'])
@admin_required
def get_all_icc():
    codes = db.get_all_icc_codes()
    return jsonify(codes), 200

# API для Admin
@app.route('/api/admin/users', methods=['GET'])
@admin_required
def get_all_users_admin():
    users = db.get_all_users()
    return jsonify([public_user(user) for user in users]), 200

@app.route('/api/admin/create_account', methods=['POST'])
@admin_required
def create_account():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'user')
    if not valid_credentials(username,password,new=True):
        return jsonify(error='Введіть логін і пароль від 4 символів'),400

    # Перевірка валідності ролі (тільки user або admin)
    if role not in ['user', 'admin']:
        return jsonify({'error': 'Невірна роль'}), 400

    success, message = db.create_user(username, password, role)
    if success:
        db.log_activity(session['user_id'], 'create_account', f'Створено {role}: {username}')
        return jsonify({'message': f'Акаунт {role} створено'}), 200
    return jsonify({'error': message}), 400

@app.route('/api/admin/delete_user/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user_admin(user_id):
    user = db.get_user_by_id(user_id)
    if user and user['role'] != 'admin':
        db.delete_user(user_id)
        db.log_activity(session['user_id'], 'delete_user', f'Видалено користувача ID: {user_id}')
        return jsonify({'message': 'Користувача видалено'}), 200
    return jsonify({'error': 'Не можна видалити адміна'}), 400

@app.route('/api/admin/activity', methods=['GET'])
@admin_required
def get_all_activity_admin():
    activity = db.get_all_activity()
    return jsonify(activity), 200

@app.route('/api/admin/activity/<int:user_id>', methods=['GET'])
@admin_required
def get_user_activity_admin(user_id):
    activity = db.get_user_activity(user_id)
    return jsonify(activity), 200

# OCR endpoint для розпізнавання наклейок
@app.route('/api/ocr/recognize', methods=['POST'])
@login_required
def recognize_label():
    global ocr_engine
    if request.form.get('type', 'single').lower() == 'vevor':
        return jsonify(error='Vevor ще в розробці'), 409
    from PIL import Image, ImageOps
    import numpy as np
    import io
    from datetime import datetime

    try:
        # Lazy loading: ініціалізувати RapidOCR при першому використанні
        if ocr_engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
                print('Ініціалізація RapidOCR...')
                ocr_engine = RapidOCR()
                print('RapidOCR готовий!')
            except Exception as init_error:
                print(f'Помилка ініціалізації RapidOCR: {init_error}')
                return jsonify({'error': 'OCR недоступний. Не вдалося завантажити RapidOCR'}), 503

        # Отримати зображення та тип картону з запиту
        if 'image' not in request.files:
            return jsonify({'error': 'Зображення не надіслано'}), 400

        # Отримати тип картону (single, mix, vevor)
        carton_type = request.form.get('type', 'single')
        if carton_type not in ['single', 'mix', 'vevor']:
            carton_type = 'single'

        image_file = request.files['image']
        image_bytes = image_file.read()
        image_pil = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert('RGB')
        image_np = np.array(image_pil)

        # Зберегти оригінальне зображення для навчання (окремо для кожного типу)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        user_id = session.get('user_id', 'unknown')
        training_dir = f'ocr_training_data/{carton_type}/images'
        os.makedirs(training_dir, exist_ok=True)

        original_path = f'{training_dir}/{timestamp}_user{user_id}_{carton_type}_original.jpg'
        image_pil.save(original_path, quality=95)

        # Спершу читати поля наклейки, за потреби запускати повний OCR.
        from ocr_labels import recognize_label_image
        data, raw_results = recognize_label_image(image_np, carton_type, ocr_engine)

        if not raw_results and not any(data.values()):
            # Зберегти інформацію про невдалу спробу
            save_training_result(timestamp, user_id, carton_type, raw_results, None, False)
            return jsonify({'error': 'Текст не розпізнано на зображенні'}), 400

        print('Витягнуті дані:', data)

        # Перевірка чи всі поля знайдено
        missing = []
        if carton_type == 'mix':
            # Для MIX потрібен тільки ICC код
            if not data.get('cell'):
                missing.append('ICC код')
        else:
            # Для SINGLE/VEVOR потрібні всі поля
            if not data.get('cell'): missing.append('комірку (4 цифри)')
            if not data.get('qtyPack'): missing.append('кількість PACK')
            if not data.get('prefix') or not data.get('zone'): missing.append('кодові букви')

        # Зберегти результат для навчання
        success = len(missing) == 0
        save_training_result(timestamp, user_id, carton_type, raw_results, data, success)

        if missing:
            return jsonify({
                'error': f'⚠️ Не розпізнано: {", ".join(missing)}. Спробуйте ще раз з кращим освітленням.',
                'partial_data': data
            }), 200

        return jsonify(data), 200

    except Exception as e:
        print('Помилка OCR:', str(e))
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def save_training_result(timestamp, user_id, carton_type, raw_results, extracted_data, success):
    """Зберегти результати розпізнавання для навчання"""
    import json

    results_dir = f'ocr_training_data/{carton_type}/results'
    os.makedirs(results_dir, exist_ok=True)

    result_data = {
        'timestamp': timestamp,
        'user_id': user_id,
        'carton_type': carton_type,
        'success': success,
        'raw_ocr_results': raw_results,
        'extracted_data': extracted_data,
        'image_path': f'ocr_training_data/{carton_type}/images/{timestamp}_user{user_id}_{carton_type}_original.jpg'
    }

    result_path = f'{results_dir}/{timestamp}_user{user_id}_{carton_type}_result.json'
    with open(result_path, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)

    print(f'Training data saved: {result_path}')

def extract_label_data(full_text):
    from ocr_labels import parse_label_text
    return parse_label_text(full_text)


def extract_mix_label_data(full_text):
    from ocr_labels import parse_mix_text
    return parse_mix_text(full_text)


@app.route('/api/admin/training_data', methods=['GET'])
@admin_required
def get_training_data():
    """Отримати список збережених даних для навчання (по всіх типах картонів)"""
    import json
    from pathlib import Path

    carton_type = request.args.get('type', 'all')  # all, single, mix, vevor

    training_data = []
    types_to_check = ['single', 'mix', 'vevor'] if carton_type == 'all' else [carton_type]

    for ctype in types_to_check:
        results_dir = Path(f'ocr_training_data/{ctype}/results')
        if not results_dir.exists():
            continue

        for result_file in sorted(results_dir.glob('*.json'), reverse=True):
            try:
                with open(result_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    training_data.append({
                        'filename': result_file.name,
                        'timestamp': data.get('timestamp'),
                        'user_id': data.get('user_id'),
                        'carton_type': data.get('carton_type', ctype),
                        'success': data.get('success'),
                        'extracted_data': data.get('extracted_data'),
                        'corrected_data': data.get('corrected_data'),
                        'corrected_at': data.get('corrected_at'),
                        'image_path': data.get('image_path')
                    })
            except Exception as e:
                print(f'Помилка читання {result_file}: {e}')

    # Сортувати по timestamp (найновіші спочатку)
    training_data.sort(key=lambda x: x['timestamp'], reverse=True)

    return jsonify({'data': training_data[:100]}), 200  # Останні 100 записів

@app.route('/api/admin/training_data/<filename>', methods=['PUT'])
@admin_required
def update_training_data(filename):
    """Оновити дані для навчання (коригування помилок розпізнавання)"""
    import json
    from pathlib import Path

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Очікується JSON об’єкт'}), 400
    if '/' in filename or '\\' in filename or not filename.endswith('.json'):
        return jsonify({'error': 'Некоректна назва файлу'}), 400

    carton_type = data.get('carton_type')
    types = ['single', 'mix', 'vevor']
    if carton_type is not None and carton_type not in types:
        return jsonify({'error': 'Невідомий тип картону'}), 400
    directories = [Path('ocr_training_data') / ctype / 'results'
                   for ctype in ([carton_type] if carton_type else types)]
    if carton_type is None:
        directories.append(Path('ocr_training_data/results'))
    matches = [directory / filename for directory in directories
               if (directory / filename).is_file()]
    if not matches:
        return jsonify({'error': 'Файл не знайдено'}), 404
    if len(matches) > 1:
        return jsonify({'error': 'Вкажіть тип картону для цього файлу'}), 409
    result_file = matches[0]

    corrected_data = data.get('corrected_data')
    if not isinstance(corrected_data, dict):
        return jsonify({'error': 'Не вказано виправлені дані'}), 400
    cell = corrected_data.get('cell')
    if not isinstance(cell, str) or not cell.strip():
        return jsonify({'error': 'Вкажіть ICC код'}), 400
    qty = corrected_data.get('qtyPack')
    if qty is not None and (type(qty) is not int or qty < 1):
        return jsonify({'error': 'PACK має бути додатним цілим числом'}), 400
    for field in ['prefix', 'zone']:
        value = corrected_data.get(field)
        if value is not None and not isinstance(value, str):
            return jsonify({'error': 'Префікс і зона мають бути текстом'}), 400
    corrected_data = {
        'cell': cell.strip().upper(),
        'qtyPack': qty,
        'prefix': (corrected_data.get('prefix') or '').strip().upper() or None,
        'zone': (corrected_data.get('zone') or '').strip().upper() or None
    }

    try:
        with open(result_file, 'r', encoding='utf-8') as f:
            original_data = json.load(f)

        # Додати виправлені дані
        original_data['corrected_data'] = corrected_data
        original_data['corrected_by'] = session.get('user_id')
        original_data['corrected_at'] = datetime.now().isoformat()

        with open(result_file, 'w', encoding='utf-8') as f:
            json.dump(original_data, f, ensure_ascii=False, indent=2)

        db.log_activity(session['user_id'], 'correct_ocr', f'Виправлено OCR дані: {filename}')
        return jsonify({'message': 'Дані оновлено', 'corrected_data': corrected_data,
                        'corrected_at': original_data['corrected_at']}), 200

    except Exception as e:
        print(f'Помилка оновлення {result_file}: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/training_stats', methods=['GET'])
@admin_required
def get_training_stats():
    """Статистика збережених даних для навчання по типах картонів"""
    import json
    from pathlib import Path

    stats = {
        'single': {'total': 0, 'success': 0, 'failed': 0, 'accuracy': 0},
        'mix': {'total': 0, 'success': 0, 'failed': 0, 'accuracy': 0},
        'vevor': {'total': 0, 'success': 0, 'failed': 0, 'accuracy': 0},
        'overall': {'total': 0, 'success': 0, 'failed': 0, 'accuracy': 0}
    }

    for carton_type in ['single', 'mix', 'vevor']:
        results_dir = Path(f'ocr_training_data/{carton_type}/results')
        if not results_dir.exists():
            continue

        for result_file in results_dir.glob('*.json'):
            try:
                with open(result_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    stats[carton_type]['total'] += 1
                    stats['overall']['total'] += 1

                    if data.get('success'):
                        stats[carton_type]['success'] += 1
                        stats['overall']['success'] += 1
                    else:
                        stats[carton_type]['failed'] += 1
                        stats['overall']['failed'] += 1
            except:
                pass

        # Обчислити точність
        if stats[carton_type]['total'] > 0:
            stats[carton_type]['accuracy'] = round(
                (stats[carton_type]['success'] / stats[carton_type]['total'] * 100), 2
            )

    # Загальна точність
    if stats['overall']['total'] > 0:
        stats['overall']['accuracy'] = round(
            (stats['overall']['success'] / stats['overall']['total'] * 100), 2
        )

    return jsonify(stats), 200

# API для адміна - управління ICC кодами
@app.route('/api/admin/icc_codes', methods=['GET'])
@admin_required
def get_all_icc_codes_admin():
    """Отримати всі ICC коди (в процесі та завершені)"""
    codes = db.get_all_icc_codes()
    conn=db.get_connection()
    try:
        visible={row['id'] for row in conn.execute("SELECT id FROM sorts WHERE status<>'deleted'")}
    finally:
        conn.close()
    codes=[code for code in codes if code.get('sort_id') is None or code['sort_id'] in visible]

    # Додати інформацію про відкриті палети
    for code in codes:
        # Знайти всі палети для цього ICC
        pallets = db.get_all_pallets(code['id'])
        open_pallets = [p for p in pallets if p['is_closed'] == 0]
        code['open_pallets_count'] = len(open_pallets)
        code['total_pallets_count'] = len(pallets)

    return jsonify(codes), 200

@app.route('/api/admin/icc/<int:icc_id>', methods=['PUT'])
@admin_required
def update_icc_code_admin(icc_id):
    """Оновити ICC код"""
    data = request.get_json()
    total_cartons = data.get('total_cartons')
    current_cartons = data.get('current_cartons')
    location_code = data.get('location_code')

    conn = db.get_connection()
    cursor = conn.cursor()

    try:
        conn.execute('BEGIN IMMEDIATE')
        icc=conn.execute('SELECT * FROM icc_codes WHERE id=?',(icc_id,)).fetchone()
        if not icc:
            return jsonify(error='ICC код не знайдено'),404
        if icc['sort_id'] is not None:
            return jsonify(error='Змінюйте цей товар у вкладці «Рухи та залишки».',sort_id=icc['sort_id']),409
        if (type(total_cartons) is not int or type(current_cartons) is not int
                or total_cartons<0 or current_cartons<0 or max(total_cartons,current_cartons)>999999999
                or (icc['type']!='mix' and (total_cartons<1 or current_cartons>total_cartons))):
            return jsonify(error='Перевірте цілу кількість картонів і PACK'),400
        if location_code is not None and not isinstance(location_code,str):
            return jsonify(error='Перевірте кодові букви'),400
        # Оновити дані
        cursor.execute("""
            UPDATE icc_codes
            SET total_cartons = ?, current_cartons = ?, location_code = ?
            WHERE id = ?
        """, (total_cartons, current_cartons, location_code, icc_id))

        # Перевірити чи завершено
        if current_cartons >= total_cartons and total_cartons > 0:
            cursor.execute("UPDATE icc_codes SET is_completed = 1 WHERE id = ?", (icc_id,))
        else:
            cursor.execute("UPDATE icc_codes SET is_completed = 0 WHERE id = ?", (icc_id,))

        conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)',(session['user_id'],'update_icc',f'Оновлено ICC код ID: {icc_id}'))
        conn.commit()
        return jsonify({'message': 'ICC код оновлено'}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/icc/<int:icc_id>', methods=['DELETE'])
@admin_required
def delete_icc_code_admin(icc_id):
    """Видалити ICC код та всі пов'язані палети"""
    conn = db.get_connection()
    cursor = conn.cursor()

    try:
        conn.execute('BEGIN IMMEDIATE')
        # Отримати інформацію про ICC перед видаленням
        cursor.execute("SELECT * FROM icc_codes WHERE id = ?", (icc_id,))
        icc = cursor.fetchone()

        if not icc:
            return jsonify({'error': 'ICC код не знайдено'}), 404
        if icc['sort_id'] is not None:
            return jsonify(error='Товар має журнал обліку. Використовуйте «Рухи та залишки» або видалення завдання.',sort_id=icc['sort_id']),409

        # Видалити всі палети для цього ICC
        cursor.execute("DELETE FROM pallets WHERE icc_code_id = ?", (icc_id,))

        # Видалити ICC код
        cursor.execute("DELETE FROM icc_codes WHERE id = ?", (icc_id,))

        conn.execute('INSERT INTO activity_log(user_id,action,details) VALUES(?,?,?)',(session['user_id'],'delete_icc',f'Видалено ICC код: {icc["last_4_digits"]} ({icc["type"]})'))
        conn.commit()
        return jsonify({'message': 'ICC код видалено'}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/ocr_scans', methods=['GET'])
@admin_required
def get_ocr_scans():
    """Отримати список всіх OCR сканувань з результатами"""
    import json

    base_dir = 'ocr_training_data'
    scans = []

    if not os.path.exists(base_dir):
        return jsonify([]), 200

    for carton_type in ['single', 'mix', 'vevor']:
        results_dir = os.path.join(base_dir, carton_type, 'results')
        if not os.path.exists(results_dir):
            continue
        for fname in sorted(os.listdir(results_dir), reverse=True):
            if '_result.json' not in fname:
                continue
            fpath = os.path.join(results_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # Перевірити чи існує зображення
                img_path = data.get('image_path', '')
                data['image_exists'] = os.path.exists(img_path)
                data['json_path'] = fpath.replace('\\', '/')
                scans.append(data)
            except Exception:
                continue

    # Сортуємо за timestamp (найновіші першими)
    scans.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return jsonify(scans[:200]), 200  # обмежуємо 200 записами


@app.route('/api/admin/ocr_image')
@admin_required
def get_ocr_image():
    """Повернути зображення OCR сканування"""
    from flask import send_file
    img_path = request.args.get('path', '')
    # Безпека: тільки з ocr_training_data/
    if not img_path.startswith('ocr_training_data/') or '..' in img_path:
        return jsonify({'error': 'Заборонено'}), 403
    if not os.path.exists(img_path):
        return jsonify({'error': 'Файл не знайдено'}), 404
    return send_file(img_path, mimetype='image/jpeg')


@app.route('/api/admin/ocr_scans/delete', methods=['POST'])
@admin_required
def delete_ocr_scan():
    """Видалити OCR запис (JSON + зображення)"""
    data = request.get_json()
    json_path = data.get('json_path', '')
    img_path = data.get('image_path', '')

    # Нормалізуємо шляхи для Windows (замінюємо \ на /)
    json_path_normalized = json_path.replace('\\', '/')
    img_path_normalized = img_path.replace('\\', '/')

    # Безпека: обидва шляхи мають бути в ocr_training_data/
    for p in [json_path_normalized, img_path_normalized]:
        if p and ('..' in p or not p.startswith('ocr_training_data/')):
            return jsonify({'error': 'Заборонено', 'path': p}), 403

    deleted = []
    if json_path and os.path.exists(json_path):
        try:
            os.remove(json_path)
            deleted.append('json')
        except Exception as e:
            return jsonify({'error': f'Помилка видалення JSON: {str(e)}'}), 500

    if img_path and os.path.exists(img_path):
        try:
            os.remove(img_path)
            deleted.append('image')
        except Exception as e:
            return jsonify({'error': f'Помилка видалення зображення: {str(e)}'}), 500

    return jsonify({'success': True, 'deleted': deleted})


# API для роботи з контейнерами
@app.route('/api/containers', methods=['GET'])
@login_required
def get_containers():
    """Отримати всі активні контейнери"""
    containers = db.get_all_containers(status='active')
    return jsonify(containers), 200

@app.route('/api/containers', methods=['POST'])
@admin_required
def create_container():
    """Створити новий контейнер (тільки для admin)"""
    data = request.get_json()
    if not isinstance(data.get('container_number'),str):
        return jsonify(error='Введіть номер контейнера'),400
    container_number = data.get('container_number', '').strip().upper()

    if not container_number:
        return jsonify({'error': 'Введіть номер контейнера'}), 400

    success, container_id = db.create_container(container_number)
    if success:
        db.log_activity(session['user_id'], 'create_container', f'Створено контейнер: {container_number}')
        return jsonify({'message': 'Контейнер створено', 'container_id': container_id}), 200
    return jsonify({'error': 'Контейнер з таким номером вже існує'}), 400

@app.route('/api/containers/all', methods=['GET'])
@admin_required
def get_all_containers_admin():
    """Отримати всі контейнери (для admin)"""
    containers = db.get_all_containers()

    # Додати інформацію про користувачів які працюють з кожним контейнером
    for container in containers:
        container['working_users'] = db.get_users_working_on_container(container['id'])

    return jsonify(containers), 200

@app.route('/api/containers/<int:container_id>/status', methods=['PUT'])
@admin_required
def update_container_status(container_id):
    """Оновити статус контейнера (для admin)"""
    data = request.get_json()
    status = data.get('status')

    if status not in ['active', 'completed', 'paused']:
        return jsonify({'error': 'Невірний статус'}), 400

    container = db.get_container_by_id(container_id)
    if not container:
        return jsonify(error='Контейнер не знайдено'),404
    db.update_container_status(container_id, status)
    db.log_activity(session['user_id'], 'update_container',
                   f'Оновлено статус контейнера {container["container_number"]}: {status}')
    return jsonify({'message': 'Статус оновлено'}), 200

@app.route('/api/container/select', methods=['POST'])
@login_required
def select_container():
    """Вибрати контейнер для роботи"""
    data = request.get_json()
    container_id = data.get('container_id')
    sort_id = data.get('sort_id')  # Опціонально - ID сорту
    if any(value is not None and (isinstance(value,bool) or not str(value).isdecimal() or len(str(value))>9 or int(value)<1)
           for value in (container_id,sort_id)):
        return jsonify(error='Перевірте номер контейнера та сорту'),400

    if not container_id:
        return jsonify({'error': 'Вкажіть контейнер'}), 400

    # Перевірити чи існує контейнер
    container = db.get_container_by_id(container_id)
    if not container:
        return jsonify({'error': 'Контейнер не знайдено'}), 404

    if container['status'] != 'active':
        return jsonify({'error': 'Контейнер не активний'}), 400

    # Перевірити сорт якщо вказано
    if sort_id:
        sort = db.get_sort_by_id(sort_id)
        if not sort:
            return jsonify({'error': 'Сорт не знайдено'}), 404
        if sort['status'] != 'active':
            return jsonify({'error': 'Сорт не активний'}), 400

    # Почати сесію з прив'язкою до сорту
    session_id = db.start_container_session(session['user_id'], container_id, sort_id)
    db.log_activity(session['user_id'], 'select_container',
                   f'Почав працювати з контейнером: {container["container_number"]}' +
                   (f' (сорт: {sort["name"]})' if sort_id else ''))

    return jsonify({
        'message': 'Контейнер вибрано',
        'session_id': session_id,
        'container': container
    }), 200

@app.route('/api/container/end', methods=['POST'])
@login_required
def end_container_work():
    """Завершити роботу з контейнером"""
    db.end_container_session(session['user_id'])
    db.log_activity(session['user_id'], 'end_container', 'Завершив роботу з контейнером')
    return jsonify({'message': 'Роботу завершено'}), 200

@app.route('/api/container/current', methods=['GET'])
@login_required
def get_current_container():
    """Отримати поточний контейнер користувача"""
    active_session = db.get_active_container_session(session['user_id'])
    return jsonify(active_session), 200

@app.route('/api/containers/sessions', methods=['GET'])
@admin_required
def get_all_sessions():
    """Отримати всі активні сесії (хто з яким контейнером працює)"""
    sessions = db.get_all_active_sessions()
    return jsonify(sessions), 200


# API для роботи з сортами (зонами/рампами)
@app.route('/api/sorts', methods=['GET'])
@login_required
def get_sorts():
    """Отримати активні сорти для користувачів"""
    sorts = db.get_active_sorts_for_user()
    mode = request.args.get('mode')
    if mode:
        sorts = [sort for sort in sorts if sort.get('mode', 'sort') == mode]
    return jsonify(with_sort_sources(sorts)), 200

@app.route('/api/sorts/all', methods=['GET'])
@admin_required
def get_all_sorts():
    """Отримати всі сорти (для admin)"""
    sorts = with_sort_sources(db.get_all_sorts())

    # Додати інформацію про користувачів які працюють з кожним сортом
    for sort in sorts:
        sort['working_users'] = db.get_users_working_on_sort(sort['id'])

    return jsonify(sorts), 200

@app.route('/api/sorts', methods=['POST'])
@admin_required
def create_sort():
    """Створити новий сорт (тільки для admin)"""
    data = request.get_json()
    if any(not isinstance(data.get(key,''),str) for key in ('name','type','unload_date','description')):
        return jsonify(error='Перевірте дані сорту'),400
    name = data.get('name', '').strip()
    sort_type = data.get('type', '').strip()
    unload_date = data.get('unload_date', '').strip()
    description = data.get('description', '').strip()
    mode = data.get('mode', 'sort')

    if 'vevor' in sort_type.lower().split(','):
        return jsonify(error='Vevor ще в розробці. Оберіть Single або Mix.'), 409

    if mode not in ('sort', 'presort'):
        return jsonify({'error': 'Оберіть SORT або PRE-SORT'}), 400

    if not name or not sort_type or not unload_date:
        return jsonify({'error': 'Заповніть всі обов\'язкові поля'}), 400
    selected=[kind.strip().lower() for kind in sort_type.split(',')]
    if any(kind not in ('single','mix') for kind in selected):
        return jsonify(error='Оберіть Single та/або Mix'),400
    sort_type=','.join(dict.fromkeys(selected))
    try:
        datetime.strptime(unload_date,'%Y-%m-%d')
    except ValueError:
        return jsonify(error='Перевірте дату розвантаження'),400

    if mode == 'presort':
        try:
            sort_id = create_presort_job(db, name, sort_type, unload_date, description, session['user_id'])
            success = True
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
    else:
        success, sort_id = db.create_sort(name, sort_type, unload_date, description, session['user_id'])
    if success:
        db.log_activity(session['user_id'], 'create_sort', f'Створено сорт: {name} ({sort_type}, {unload_date})')
        return jsonify({'message': 'Сорт створено', 'sort_id': sort_id}), 200
    return jsonify({'error': f'Помилка створення сорту: {sort_id}'}), 400

@app.route('/api/sorts/<int:sort_id>', methods=['GET'])
@login_required
def get_sort(sort_id):
    """Отримати інформацію про сорт"""
    sort = db.get_sort_by_id(sort_id)
    if not sort:
        return jsonify({'error': 'Сорт не знайдено'}), 404

    # Додати статистику
    sort['working_users'] = db.get_users_working_on_sort(sort_id)

    return jsonify(with_sort_sources([sort])[0]), 200

@app.route('/api/sorts/<int:sort_id>', methods=['PUT'])
@admin_required
def update_sort(sort_id):
    """Оновити інформацію про сорт"""
    if not db.get_sort_by_id(sort_id):
        return jsonify(error='Сорт не знайдено'),404
    data = request.get_json()
    if any(data.get(key) is not None and not isinstance(data[key],str) for key in ('name','type','unload_date','description')):
        return jsonify(error='Перевірте дані сорту'),400
    if data.get('type') is not None and any(kind not in ('single','mix') for kind in data['type'].split(',')):
        return jsonify(error='Оберіть Single та/або Mix'),400
    name = data.get('name')
    sort_type = data.get('type')
    unload_date = data.get('unload_date')
    description = data.get('description')

    success = db.update_sort(sort_id, name, sort_type, unload_date, description)
    if success:
        db.log_activity(session['user_id'], 'update_sort', f'Оновлено сорт ID: {sort_id}')
        return jsonify({'message': 'Сорт оновлено'}), 200
    return jsonify({'error': 'Помилка оновлення'}), 400

@app.route('/api/sorts/<int:sort_id>/status', methods=['PUT'])
@admin_required
def update_sort_status(sort_id):
    """Оновити статус сорту"""
    data = request.get_json()
    status = data.get('status')

    if status not in ['active', 'paused', 'closed']:
        return jsonify({'error': 'Невірний статус'}), 400

    current = db.get_sort_by_id(sort_id)
    if not current:
        return jsonify({'error': 'Сорт не знайдено'}), 404
    try:
        if current.get('mode') == 'presort' and status == 'closed':
            close_presort_job(db, sort_id)
        elif current.get('mode') == 'sort' and status == 'closed':
            close_sort_job(db, sort_id)
        else:
            db.update_sort_status(sort_id, status)
    except ValueError as error:
        return jsonify(error=str(error)),409
    sort = db.get_sort_by_id(sort_id)
    if not sort:
        return jsonify(error='Сорт не знайдено'),404
    db.log_activity(session['user_id'], 'update_sort_status',
                   f'Оновлено статус сорту {sort["name"]}: {status}')
    return jsonify({'message': 'Статус оновлено'}), 200

@app.route('/api/sorts/<int:sort_id>', methods=['DELETE'])
@admin_required
def delete_sort(sort_id):
    """Explicitly confirmed removal, including unfinished tasks."""
    if request.args.get('confirm') != 'true':
        return jsonify({'error': 'Підтвердіть видалення'}), 400
    if not db.delete_sort(sort_id,session['user_id']):
        return jsonify(error='Сорт не знайдено'),404
    return jsonify({'message': 'Сорт видалено'}), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
