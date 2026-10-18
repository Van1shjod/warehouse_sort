# -*- coding: utf-8 -*-
"""
Покращений OCR алгоритм для розпізнавання наклейок на картонах
Гібридний підхід: спеціальна обробка чорних блоків + RapidOCR
"""
import sys
import cv2
import numpy as np
from PIL import Image
import re
from typing import Dict, Tuple, Optional, List

# Фікс для Windows консолі
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

class ImprovedOCR:
    """Покращений OCR для наклейок картонів"""

    def __init__(self):
        """Ініціалізація OCR"""
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.ocr = RapidOCR()
            print("✓ RapidOCR ініціалізовано")
        except Exception as e:
            raise Exception(f"Не вдалося завантажити RapidOCR: {e}")

    def detect_black_boxes(self, image_np: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """
        Виявити чорні блоки на наклейці
        Повертає список координат (x, y, w, h)
        """
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)

        # Знайти дуже темні області (чорні блоки)
        _, binary = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)

        # Морфологічні операції для з'єднання областей
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 20))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

        # Знайти контури
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        boxes = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            # Фільтр: тільки великі прямокутні блоки
            area = w * h
            aspect_ratio = w / h if h > 0 else 0

            if area > 5000 and 1.5 < aspect_ratio < 10:
                boxes.append((x, y, w, h))

        return boxes

    def extract_and_process_black_box(self, image_np: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
        """
        Вирізати та обробити чорний блок для OCR
        """
        x, y, w, h = box

        # Додати padding для кращого розпізнавання
        padding = 10
        x_start = max(0, x - padding)
        y_start = max(0, y - padding)
        x_end = min(image_np.shape[1], x + w + padding)
        y_end = min(image_np.shape[0], y + h + padding)

        # Вирізати блок
        box_region = image_np[y_start:y_end, x_start:x_end]

        # Конвертувати в grayscale
        gray = cv2.cvtColor(box_region, cv2.COLOR_RGB2GRAY)

        # Інвертувати (білий текст на чорному → чорний текст на білому)
        inverted = cv2.bitwise_not(gray)

        # Бінаризація
        _, binary = cv2.threshold(inverted, 127, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Збільшити розмір в 2 рази для кращого розпізнавання
        scale = 2
        new_w = binary.shape[1] * scale
        new_h = binary.shape[0] * scale
        resized = cv2.resize(binary, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

        # Додаткове очищення шуму
        kernel = np.ones((2, 2), np.uint8)
        cleaned = cv2.morphologyEx(resized, cv2.MORPH_OPEN, kernel)

        return cleaned

    def ocr_image(self, image: np.ndarray, save_path: Optional[str] = None) -> str:
        """
        Розпізнати текст з зображення
        """
        if save_path:
            Image.fromarray(image).save(save_path)
            result, _ = self.ocr(save_path)
        else:
            # Зберегти тимчасово
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
                Image.fromarray(image).save(tmp.name)
                temp_path = tmp.name

            try:
                result, _ = self.ocr(temp_path)
            finally:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)

        if result:
            text = ' '.join([line[1] for line in result])
            return text
        return ""

    def recognize_label(self, image_path: str, debug: bool = False) -> Dict[str, any]:
        """
        Розпізнати всі дані з наклейки картону

        Returns:
            {
                'cell': '3445',        # 4 цифри
                'qtyPack': 10,         # кількість
                'prefix': 'IZ',        # префікс (2 літери)
                'zone': 'A'            # зона (1 літера)
            }
        """
        # Завантажити зображення
        image = Image.open(image_path)
        image_np = np.array(image)

        all_texts = []

        # 1. Розпізнати всю наклейку (для білих областей)
        full_text = self.ocr_image(image_np)
        all_texts.append(full_text)

        if debug:
            print(f"[Full image] {full_text[:150]}...")

        # 2. Виявити та обробити чорні блоки окремо
        black_boxes = self.detect_black_boxes(image_np)

        if debug:
            print(f"Знайдено чорних блоків: {len(black_boxes)}")

        for idx, box in enumerate(black_boxes):
            processed_box = self.extract_and_process_black_box(image_np, box)
            box_text = self.ocr_image(processed_box)

            if box_text:
                all_texts.append(box_text)
                if debug:
                    print(f"[Black box {idx+1}] {box_text}")

        # 3. Інверсія всієї наклейки (додатковий варіант)
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
        inverted = cv2.bitwise_not(gray)
        inv_processed = np.where(dark_mask > 0, inverted, gray)

        inv_text = self.ocr_image(inv_processed)
        if inv_text:
            all_texts.append(inv_text)
            if debug:
                print(f"[Inverted] {inv_text[:150]}...")

        # 4. Витягти дані з об'єднаного тексту
        combined_text = ' '.join(all_texts)
        data = self.extract_label_data(combined_text, debug=debug)

        return data

    def extract_label_data(self, full_text: str, debug: bool = False) -> Dict[str, any]:
        """
        Витягти структуровані дані з тексту
        """
        data = {
            'cell': None,
            'qtyPack': None,
            'prefix': None,
            'zone': None
        }

        text_upper = full_text.upper()

        # === 1. КОД (4 цифри) ===
        # Шукаємо 4-значні числа, виключаючи довгі номери
        cell_matches = re.findall(r'\b(\d{4})\b', text_upper)

        if cell_matches:
            # Фільтруємо: не частина ICC коду, Pack ID, REF
            for match in cell_matches:
                # Контекст навколо числа
                pattern = rf'.{{0,15}}{match}.{{0,15}}'
                context = re.search(pattern, text_upper)

                if context:
                    ctx_text = context.group()
                    # Пропускаємо якщо це частина ID номера
                    if not re.search(r'(ICC|PACK.*ID|REF|C1008|NO\.:)', ctx_text):
                        data['cell'] = match
                        if debug:
                            print(f"[CODE] Знайдено: {match}")
                        break

        # === 2. КІЛЬКІСТЬ (PACK) ===
        # Спочатку шукаємо біля слова PACK
        pack_patterns = [
            r'(\d{1,3})\s*(?:PACK|PCS)',
            r'(?:PACK|PCS)\s*(\d{1,3})',
            r'(\d{1,2})\s+(?:PACK|PCS)',
            r'(?:PACK|PCS)\s+(\d{1,2})',
        ]

        for pattern in pack_patterns:
            matches = re.findall(pattern, text_upper)
            if matches:
                try:
                    qty = int(matches[0])
                    if 1 <= qty <= 200:
                        data['qtyPack'] = qty
                        if debug:
                            print(f"[PACK] Знайдено біля PACK: {qty}")
                        break
                except:
                    pass

        # Якщо не знайдено, шукаємо окремі числа в білій зоні (справа від чорних блоків)
        if not data['qtyPack']:
            # Шукаємо числа 4-99 (типовий діапазон для PACK)
            standalone = re.findall(r'\b(\d{1,2})\b', text_upper)
            for num_str in standalone:
                num = int(num_str)
                # Виключаємо дуже маленькі числа та першу частину коду
                if 4 <= num <= 99:
                    # Перевірка що це не частина коду
                    if data.get('cell') and num_str == data['cell'][:2]:
                        continue
                    data['qtyPack'] = num
                    if debug:
                        print(f"[PACK] Знайдено окреме число: {num}")
                    break

        # === 3. КОДОВІ БУКВИ (префікс-зона, наприклад IZ-A, EM-A) ===
        zone_patterns = [
            # Основні патерни з дефісом
            r'\b([A-Z]{2})\s*-\s*([A-Z])\b',
            r'\b([A-Z]{2})-([A-Z])\b',

            # З цифрами замість літер (1→I, 0→O)
            r'\b([A-Z0-9]{2})\s*-\s*([A-Z])\b',

            # Різні види дефісів
            r'\b([A-Z]{2})\s*[—–-]\s*([A-Z])\b',

            # Без дефіса (спеціальні випадки)
            r'\b([A-Z]{2})\s+([A-Z])\s+\d',
        ]

        for pattern in zone_patterns:
            match = re.search(pattern, text_upper)
            if match:
                prefix_raw = match.group(1)
                zone_raw = match.group(2) if len(match.groups()) > 1 else None

                # Корекція поширених помилок OCR
                prefix = self.correct_ocr_errors(prefix_raw)
                zone = self.correct_ocr_errors(zone_raw) if zone_raw else None

                # Перевірка валідності
                if len(prefix) == 2 and prefix.isalpha():
                    # Перевірка що префікс схожий на відомі коди зон
                    known_prefixes = ['IZ', 'EM', 'BH', 'KN', 'VX', 'MZ', 'LZ', 'RZ', 'TZ', 'WZ', 'NY']

                    if prefix in known_prefixes or True:  # Дозволяємо всі 2-літерні комбінації
                        data['prefix'] = prefix
                        data['zone'] = zone if zone and zone.isalpha() else None

                        if debug:
                            print(f"[ZONE] Знайдено: {prefix}-{zone}")
                        break

        # Додаткова спроба: шукаємо дві літери перед дефісом
        if not data['prefix']:
            two_letters_dash = re.search(r'\b([A-Z]{2})\s*-', text_upper)
            if two_letters_dash:
                prefix_raw = two_letters_dash.group(1)
                prefix = self.correct_ocr_errors(prefix_raw)

                if len(prefix) == 2 and prefix.isalpha():
                    data['prefix'] = prefix

                    # Спроба знайти зону після дефісу
                    after_dash = text_upper[two_letters_dash.end():]
                    zone_match = re.search(r'\s*([A-Z])\b', after_dash)
                    if zone_match:
                        zone = self.correct_ocr_errors(zone_match.group(1))
                        data['zone'] = zone

                    if debug:
                        print(f"[ZONE] Знайдено (fallback): {prefix}-{data['zone']}")

        return data

    def correct_ocr_errors(self, text: str) -> str:
        """
        Виправити поширені помилки OCR
        1 → I (в літерах)
        0 → O (в літерах)
        """
        if not text:
            return text

        corrected = text

        # Заміна цифр на літери в літерних контекстах
        corrected = corrected.replace('1', 'I')
        corrected = corrected.replace('0', 'O')

        return corrected


# Функція для використання в Flask
def recognize_label_improved(image_path: str, debug: bool = False) -> Dict[str, any]:
    """
    Основна функція для розпізнавання наклейки
    Використовується в Flask app
    """
    ocr = ImprovedOCR()
    return ocr.recognize_label(image_path, debug=debug)


# Тестування
if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    else:
        # Тестове зображення
        image_path = r"C:\scripts\наклейки single картонів\1.jpg"

    print(f"Тестування: {image_path}")
    print("=" * 80)

    ocr = ImprovedOCR()
    result = ocr.recognize_label(image_path, debug=True)

    print("\n" + "=" * 80)
    print("РЕЗУЛЬТАТ:")
    print(f"  Код (4 цифри): {result['cell'] or '✗ НЕ ЗНАЙДЕНО'}")
    print(f"  Кількість (PACK): {result['qtyPack'] or '✗ НЕ ЗНАЙДЕНО'}")

    if result['prefix'] and result['zone']:
        print(f"  Кодові букви: {result['prefix']}-{result['zone']}")
    else:
        print(f"  Кодові букви: ✗ НЕ ЗНАЙДЕНО")

    success = bool(result['cell'] and result['qtyPack'] and result['prefix'] and result['zone'])
    print(f"\n{'✓ УСПІХ' if success else '✗ НЕВДАЧА'}")
