from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from database import Database
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)

db = Database()

# RapidOCR - швидка альтернатива PaddleOCR для Windows
ocr_engine = None

# Декоратор для перевірки авторизації
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
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
        if user['role'] not in ['admin']:
            return jsonify({'error': 'Недостатньо прав'}), 403
        return f(*args, **kwargs)
    return decorated_function

# Декоратор для перевірки ролі Admin
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Необхідна авторизація'}), 401
        user = db.get_user_by_id(session['user_id'])
        if user['role'] != 'admin':
            return jsonify({'error': 'Потрібні права адміністратора'}), 403
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
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
    data = request.get_json()
    icc_last_4 = data.get('icc_code')  # Для single: 4 цифри, для mix: повний код
    type_name = data.get('type')
    total_cartons = data.get('total_cartons')
    location_code = data.get('location_code')

    if not icc_last_4:
        return jsonify({'error': 'Введіть код'}), 400

    if type_name == 'mix':
        import re
        if not re.match(r'^[A-Za-z]\d{5,7}$', icc_last_4):
            return jsonify({'error': 'Неправильний формат MIX коду (літера + 5-7 цифр)'}), 400

        existing = db.get_icc_code_by_last_4(icc_last_4, type_name)
        if existing:
            open_pallet = db.get_open_pallet(existing['id'], session['user_id'], type_name)
            return jsonify({
                'status': 'exists',
                'icc_data': existing,
                'open_pallet': open_pallet
            }), 200
        return jsonify({'status': 'new'}), 200

    # Single / Vevor: перевірка 4 цифри
    if len(icc_last_4) != 4 or not icc_last_4.isdigit():
        return jsonify({'error': 'Введіть рівно 4 цифри'}), 400

    # Якщо передано всі параметри - шукаємо точний збіг товару
    if total_cartons and location_code:
        existing = db.get_icc_code_by_last_4(icc_last_4, type_name, total_cartons, location_code)

        if existing:
            if existing['is_completed']:
                return jsonify({'status': 'completed', 'message': 'Цей ICC код вже завершено!'}), 200

            open_pallet = db.get_open_pallet(existing['id'], session['user_id'], type_name)

            return jsonify({
                'status': 'exists',
                'icc_data': existing,
                'open_pallet': open_pallet
            }), 200
        else:
            return jsonify({'status': 'new'}), 200
    else:
        existing = db.get_icc_code_by_last_4(icc_last_4, type_name)

        if existing:
            if existing['is_completed']:
                return jsonify({'status': 'completed', 'message': 'Цей ICC код вже завершено!'}), 200

            open_pallet = db.get_open_pallet(existing['id'], session['user_id'], type_name)

            return jsonify({
                'status': 'exists',
                'icc_data': existing,
                'open_pallet': open_pallet
            }), 200

        return jsonify({'status': 'new'}), 200

@app.route('/api/icc/create', methods=['POST'])
@login_required
def create_icc():
    data = request.get_json()
    icc_last_4 = data.get('icc_code')  # Для single: 4 цифри, для mix: повний код
    type_name = data.get('type')
    total_cartons = data.get('total_cartons')
    location_code = data.get('location_code')

    if not icc_last_4:
        return jsonify({'error': 'Введіть код'}), 400

    if type_name == 'mix':
        import re
        if not re.match(r'^[A-Za-z]\d{5,7}$', icc_last_4):
            return jsonify({'error': 'Неправильний формат MIX коду'}), 400
        total_cartons = 0
    else:
        if len(icc_last_4) != 4 or not icc_last_4.isdigit():
            return jsonify({'error': 'Введіть рівно 4 цифри'}), 400

    import time
    icc_code = f"{type_name.upper()}-{icc_last_4.upper()}-{int(time.time())}"

    success, icc_id = db.create_icc_code(icc_code, type_name, total_cartons, icc_last_4.upper(), location_code)
    if success:
        db.log_activity(session['user_id'], 'create_icc', f'Створено ICC код: {icc_last_4} ({type_name})')
        return jsonify({'message': 'ICC код створено', 'icc_id': icc_id}), 200
    return jsonify({'error': 'Помилка створення ICC коду'}), 400

@app.route('/api/pallet/add', methods=['POST'])
@login_required
def add_to_pallet():
    data = request.get_json()
    icc_last_4 = data.get('icc_code')  # Для single: 4 цифри, для mix: повний код
    cartons_count = data.get('cartons_count')
    pallet_number = data.get('pallet_number')
    type_name = data.get('type', 'single')

    icc_data = db.get_icc_code_by_last_4(icc_last_4, type_name)
    if not icc_data:
        return jsonify({'error': 'ICC код не знайдено'}), 404

    # Перевірка чи є відкрита палета того ж типу
    open_pallet = db.get_open_pallet(icc_data['id'], session['user_id'], type_name)

    if not open_pallet:
        # Створити нову палету
        if not pallet_number:
            return jsonify({'error': 'need_pallet_number', 'message': 'Введіть номер палети'}), 400

        pallet_id = db.create_pallet(pallet_number, icc_data['id'], session['user_id'], icc_data['type'], cartons_count)
        db.log_activity(session['user_id'], 'create_pallet', f'Створено палету {pallet_number} для ICC-{icc_last_4}')
    else:
        # Додати до існуючої палети
        pallet_id = open_pallet['id']
        db.update_pallet_cartons(pallet_id, cartons_count)

    # Оновити лічильник ICC коду
    db.update_icc_cartons_by_id(icc_data['id'], cartons_count)

    # Оновити статистику користувача
    db.update_user_cartons(session['user_id'], cartons_count)

    db.log_activity(session['user_id'], 'add_cartons', f'Додано {cartons_count} картонів до ICC-{icc_last_4}')

    # Перевірити чи завершено
    updated_icc = db.get_icc_code_by_id(icc_data['id'])
    is_completed = updated_icc['is_completed']

    return jsonify({
        'message': 'Картони додано',
        'current_cartons': updated_icc['current_cartons'],
        'total_cartons': updated_icc['total_cartons'],
        'is_completed': is_completed
    }), 200

@app.route('/api/pallet/close', methods=['POST'])
@login_required
def close_pallet():
    data = request.get_json()
    icc_last_4 = data.get('icc_code')  # Останні 4 цифри
    type_name = data.get('type', 'single')  # Додати тип для правильного пошуку

    icc_data = db.get_icc_code_by_last_4(icc_last_4, type_name)
    if not icc_data:
        return jsonify({'error': 'ICC код не знайдено'}), 404

    open_pallet = db.get_open_pallet(icc_data['id'], session['user_id'], type_name)
    if open_pallet:
        db.close_pallet(open_pallet['id'])
        db.log_activity(session['user_id'], 'close_pallet', f'Закрито палету {open_pallet["pallet_number"]}')
        return jsonify({'message': 'Палету закрито'}), 200

    return jsonify({'error': 'Немає відкритої палети'}), 400

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
            'user': user
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
    return jsonify(users), 200

@app.route('/api/admin/create_account', methods=['POST'])
@admin_required
def create_account():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'user')

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
    from PIL import Image
    import cv2
    import numpy as np
    import io
    import tempfile
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
        image_pil = Image.open(io.BytesIO(image_bytes))
        image_np = np.array(image_pil)

        # Зберегти оригінальне зображення для навчання (окремо для кожного типу)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        user_id = session.get('user_id', 'unknown')
        training_dir = f'ocr_training_data/{carton_type}/images'
        os.makedirs(training_dir, exist_ok=True)

        original_path = f'{training_dir}/{timestamp}_user{user_id}_{carton_type}_original.jpg'
        image_pil.save(original_path, quality=95)

        # Підготувати кілька варіантів обробки зображення
        processed_images = []

        # Варіант 1: Оригінал
        processed_images.append(('original', image_np))

        # Варіант 2: Інверсія чорних блоків (для білого тексту на чорному)
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
        inverted = cv2.bitwise_not(gray)
        inv_processed = np.where(dark_mask > 0, inverted, gray)
        processed_images.append(('inverted', inv_processed))

        # Варіант 3: Висока контрастність
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        contrast_enhanced = clahe.apply(gray)
        processed_images.append(('contrast', contrast_enhanced))

        # Варіант 4: Бінаризація Otsu
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        processed_images.append(('binary', binary))

        # Розпізнати з кожного варіанту та об'єднати результати
        all_texts = []
        raw_results = {}  # Зберігаємо всі результати для логування

        for variant_name, img in processed_images:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
                if len(img.shape) == 2:  # grayscale
                    Image.fromarray(img).save(tmp.name)
                else:  # color
                    Image.fromarray(img).save(tmp.name)
                temp_path = tmp.name

            try:
                result, _ = ocr_engine(temp_path)
                if result:
                    text = ' '.join([line[1] for line in result])
                    all_texts.append(text)
                    raw_results[variant_name] = text
                    print(f'OCR ({variant_name}): {text[:100]}...')
            finally:
                os.unlink(temp_path)

        if not all_texts:
            # Зберегти інформацію про невдалу спробу
            save_training_result(timestamp, user_id, carton_type, raw_results, None, False)
            return jsonify({'error': 'Текст не розпізнано на зображенні'}), 400

        # Об'єднати всі результати
        combined_text = ' '.join(all_texts)
        print(f'Об\'єднаний текст ({len(all_texts)} варіантів): {combined_text[:150]}...')

        # Витягти дані з об'єднаного тексту (різна логіка для різних типів)
        if carton_type == 'mix':
            data = extract_mix_label_data(combined_text)
        else:
            data = extract_label_data(combined_text)
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
    """Витягти потрібні дані з розпізнаного тексту: комірка, PACK, префікс-зона"""
    import re

    data = {
        'cell': None,
        'qtyPack': None,
        'prefix': None,
        'zone': None
    }

    text_upper = full_text.upper()

    # Комірка (4 цифри) - шукаємо найбільш імовірну
    cell_matches = re.findall(r'\b(\d{4})\b', text_upper)
    if cell_matches:
        # Фільтруємо: беремо перше 4-значне число яке не є частиною довгого номера
        for match in cell_matches:
            # Перевіряємо що це не частина ICC коду або інших довгих номерів
            context = re.search(rf'.{{0,5}}{match}.{{0,5}}', full_text)
            if context and not re.search(r'ICC|PACK\s*ID|REF', context.group(), re.IGNORECASE):
                data['cell'] = match
                break

    # PACK - шукаємо число біля слова PACK або число в діапазоні 1-999
    pack_patterns = [
        r'(\d{1,3})\s*PACK',
        r'PACK\s*(\d{1,3})',
        r'(\d{1,3})\s*PCS',
        r'PCS\s*(\d{1,3})',
        r'\b(\d{1,2})\s+PACK\b',
        r'\bPACK\s+(\d{1,2})\b',
    ]
    for pattern in pack_patterns:
        matches = re.findall(pattern, text_upper)
        if matches:
            try:
                qty = int(matches[0])
                if 1 <= qty <= 200:
                    data['qtyPack'] = qty
                    break
            except:
                pass

    # Якщо PACK не знайдено, шукаємо окремі числа в розумному діапазоні
    if not data['qtyPack']:
        standalone_numbers = re.findall(r'\b([1-9]\d?)\b', text_upper)
        for num_str in standalone_numbers:
            num = int(num_str)
            if 4 <= num <= 99 and num_str != data.get('cell'):
                data['qtyPack'] = num
                break

    # Префікс-зона (IZ-A, KN-E, BH-A тощо) - покращені патерни
    zone_patterns = [
        r'\b([A-Z]{2})\s*-\s*([A-Z])\b',
        r'\b([A-Z]{2})-([A-Z])\b',
        r'\b([A-Z]{2})\s+([A-Z])\s+\d',
        r'\b([A-Z]{2})\s*-\s*[A-Z0-9]\b',  # Більш гнучкий патерн
        r'\b([A-Z0-9]{2})\s*-\s*([A-Z])\b',  # Дозволяє 1 замість I
        r'\bI[Z1]\s*-\s*([A-Z])\b',  # Спеціально для IZ/1Z
        r'\b([A-Z]{2})\s*-\s*',  # Префікс без зони
        r'\b([A-Z]{2})\s*-\s*[A-Z0-9\s]*',  # Префікс з будь-яким текстом після дефісу
        r'\b([A-Z]{2})\s*-\s*[A-Z]\b',  # Дво-буквений префікс з однією буквою після дефісу
    ]
    for pattern in zone_patterns:
        match = re.search(pattern, text_upper)
        if match:
            prefix = match.group(1)
            # Виправити поширені помилки розпізнавання
            prefix = prefix.replace('1', 'I').replace('0', 'O')

            # Отримати зону якщо є
            zone = match.group(2) if len(match.groups()) > 1 else None
            if zone:
                zone = zone.replace('1', 'I').replace('0', 'O')

            if prefix in ['IZ', 'KN', 'BH', 'EM', 'VX', 'MZ', 'LZ', 'RZ', 'TZ', 'WZ'] or len(prefix) == 2:
                data['prefix'] = prefix
                data['zone'] = zone
                break

    # Додатковий пошук: шукаємо дві великі літери перед дефісом
    if not data['prefix']:
        # Шукаємо шаблон дві літери, потім дефіс, потім будь-що
        two_letter_dash = re.search(r'\b([A-Z]{2})\s*-', text_upper)
        if two_letter_dash:
            prefix = two_letter_dash.group(1)
            prefix = prefix.replace('1', 'I').replace('0', 'O')
            if len(prefix) == 2:
                data['prefix'] = prefix
                # Спроба знайти зону після дефісу
                after_dash = text_upper[two_letter_dash.end():]
                zone_match = re.search(r'\b([A-Z])\b', after_dash)
                if zone_match:
                    zone = zone_match.group(1).replace('1', 'I').replace('0', 'O')
                    data['zone'] = zone

    # Спеціальний пошук для шаблону TO: followed by location code
    if not data['prefix']:
        # Шукаємо TO: або FROM: після яких може бути локація
        to_pattern = re.search(r'TO:\s*([A-Z]{2})', text_upper)
        if to_pattern:
            prefix = to_pattern.group(1)
            prefix = prefix.replace('1', 'I').replace('0', 'O')
            if len(prefix) == 2:
                data['prefix'] = prefix
                # Шукаємо зону після префікса
                after_prefix = text_upper[to_pattern.end():]
                zone_match = re.search(r'\s*-\s*([A-Z])', after_prefix)
                if zone_match:
                    zone = zone_match.group(1).replace('1', 'I').replace('0', 'O')
                    data['zone'] = zone

    # Ще один підхід: шукаємо слова, які схожі на локації
    if not data['prefix']:
        # Шукаємо слова, які закінчуються на XB, KB, AB (можливо бути частиною IZ-B, IZ-A тощо)
        location_words = re.findall(r'\b([A-Z]{2})[XBAB]\b', text_upper)
        for word in location_words:
            prefix = word[:2]
            prefix = prefix.replace('1', 'I').replace('0', 'O')
            if prefix in ['IZ', 'KN', 'BH', 'EM', 'VX', 'MZ', 'LZ', 'RZ', 'TZ', 'WZ']:
                data['prefix'] = prefix
                # Остання буква може бути зоною
                possible_zone = word[2].replace('1', 'I').replace('0', 'O')
                if possible_zone.isalpha():
                    data['zone'] = possible_zone
                break

    # Якщо знайдено префікс але не зону, спробуємо знайти зону після префікса в тексті
    if data['prefix'] and not data['zone']:
        # Шукаємо префікс і потім окрему букву після нього
        prefix_pattern = re.escape(data['prefix'])
        # Шукаємо букву A після префікса (найпоширеніша зона)
        zone_pattern = re.search(rf'{prefix_pattern}[^A-Z]*([A-Z])', text_upper)
        if zone_pattern:
            zone = zone_pattern.group(1).replace('1', 'I').replace('0', 'O')
            data['zone'] = zone

    return data

def extract_mix_label_data(full_text):
    """Витягти дані з MIX наклейки - тільки ICC код (літера + цифри)"""
    import re

    data = {
        'cell': None,
        'qtyPack': None,
        'prefix': None,
        'zone': None
    }

    text_upper = full_text.upper()

    # Витягти ICC код - перший рядок (літера + 5-7 цифр)
    # Приклади: D980989, D980947, A123456, B7654321
    icc_patterns = [
        r'\b([A-Z]\d{6,7})\b',  # Літера + 6-7 цифр (найпоширеніше)
        r'\b([A-Z]\d{5})\b',    # Літера + 5 цифр
        r'\b([A-Z]{1,2}\d{5,7})\b',  # 1-2 літери + 5-7 цифр
    ]

    for pattern in icc_patterns:
        matches = re.findall(pattern, text_upper)
        if matches:
            # Фільтруємо щоб виключити "Made in China" та інші слова
            for match in matches:
                if not any(word in match for word in ['MADE', 'CHINA', 'IN', 'PACK']):
                    data['cell'] = match
                    print(f'MIX ICC код знайдено: {match}')
                    return data

    print('MIX ICC код не знайдено')
    return data

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

    results_dir = Path('ocr_training_data/results')
    result_file = results_dir / filename

    if not result_file.exists():
        return jsonify({'error': 'Файл не знайдено'}), 404

    data = request.get_json()
    corrected_data = data.get('corrected_data')

    if not corrected_data:
        return jsonify({'error': 'Не вказано виправлені дані'}), 400

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
        return jsonify({'message': 'Дані оновлено'}), 200

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

        conn.commit()
        db.log_activity(session['user_id'], 'update_icc', f'Оновлено ICC код ID: {icc_id}')
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
        # Отримати інформацію про ICC перед видаленням
        cursor.execute("SELECT * FROM icc_codes WHERE id = ?", (icc_id,))
        icc = cursor.fetchone()

        if not icc:
            return jsonify({'error': 'ICC код не знайдено'}), 404

        # Видалити всі палети для цього ICC
        cursor.execute("DELETE FROM pallets WHERE icc_code_id = ?", (icc_id,))

        # Видалити ICC код
        cursor.execute("DELETE FROM icc_codes WHERE id = ?", (icc_id,))

        conn.commit()
        db.log_activity(session['user_id'], 'delete_icc', f'Видалено ICC код: {icc["last_4_digits"]} ({icc["type"]})')
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

    db.update_container_status(container_id, status)
    container = db.get_container_by_id(container_id)
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
    return jsonify(sorts), 200

@app.route('/api/sorts/all', methods=['GET'])
@admin_required
def get_all_sorts():
    """Отримати всі сорти (для admin)"""
    sorts = db.get_all_sorts()

    # Додати інформацію про користувачів які працюють з кожним сортом
    for sort in sorts:
        sort['working_users'] = db.get_users_working_on_sort(sort['id'])

    return jsonify(sorts), 200

@app.route('/api/sorts', methods=['POST'])
@admin_required
def create_sort():
    """Створити новий сорт (тільки для admin)"""
    data = request.get_json()
    name = data.get('name', '').strip()
    sort_type = data.get('type', '').strip()
    unload_date = data.get('unload_date', '').strip()
    description = data.get('description', '').strip()

    if not name or not sort_type or not unload_date:
        return jsonify({'error': 'Заповніть всі обов\'язкові поля'}), 400

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

    return jsonify(sort), 200

@app.route('/api/sorts/<int:sort_id>', methods=['PUT'])
@admin_required
def update_sort(sort_id):
    """Оновити інформацію про сорт"""
    data = request.get_json()
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

    db.update_sort_status(sort_id, status)
    sort = db.get_sort_by_id(sort_id)
    db.log_activity(session['user_id'], 'update_sort_status',
                   f'Оновлено статус сорту {sort["name"]}: {status}')
    return jsonify({'message': 'Статус оновлено'}), 200

@app.route('/api/sorts/<int:sort_id>', methods=['DELETE'])
@admin_required
def delete_sort(sort_id):
    """Видалити сорт"""
    sort = db.get_sort_by_id(sort_id)
    if not sort:
        return jsonify({'error': 'Сорт не знайдено'}), 404

    if not request.args.get('confirm'):
        return jsonify({'error': 'Підтвердіть видалення'}), 400

    db.delete_sort(sort_id)
    db.log_activity(session['user_id'], 'delete_sort', f'Видалено сорт: {sort["name"]}')
    return jsonify({'message': 'Сорт видалено'}), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
