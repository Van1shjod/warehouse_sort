# -*- coding: utf-8 -*-
"""
ГІБРИДНИЙ OCR - найкраще з двох підходів
1. Старий алгоритм (RapidOCR) - для коду та кількості
2. Новий алгоритм (спеціальна обробка) - для кодових букв з чорних блоків
"""
import sys
import cv2
import numpy as np
from PIL import Image
import re
import os
import tempfile
from typing import Dict, Tuple, Optional, List

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

class HybridOCR:
    """Гібридний OCR - найкраще з двох підходів"""

    def __init__(self):
        """Ініціалізація OCR"""
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.ocr = RapidOCR()
            print("✓ RapidOCR ініціалізовано")
        except Exception as e:
            raise Exception(f"Не вдалося завантажити RapidOCR: {e}")

    def extract_black_boxes(self, image_np: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """
        Виявити чорні блоки на наклейці
        Повертає список координат (x, y, w, h)
        """
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)

        # Знайти дуже темні області (чорні блоки)
        _, binary = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

        # Морфологічні операції для з'єднання областей
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

        # Знайти контури
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        boxes = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h
            aspect_ratio = w / h if h > 0 else 0

            # Фільтр: великі прямокутні блоки
            if area > 3000 and 1.5 < aspect_ratio < 12:
                boxes.append((x, y, w, h))

        return boxes

    def process_black_box(self, image_np: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
        """
        Обробити чорний блок для кращого розпізнавання
        """
        x, y, w, h = box

        # Додати padding
        padding = 5
        x_start = max(0, x - padding)
        y_start = max(0, y - padding)
        x_end = min(image_np.shape[1], x + w + padding)
        y_end = min(image_np.shape[0], y + h + padding)

        # Вирізати блок
        box_region = image_np[y_start:y_end, x_start:x_end]

        # Конвертувати в grayscale
        gray = cv2.cvtColor(box_region, cv2.COLOR_RGB2GRAY)

        # Інвертувати (білий текст → чорний на білому)
        inverted = cv2.bitwise_not(gray)

        # Бінаризація
        _, binary = cv2.threshold(inverted, 140, 255, cv2.THRESH_BINARY)

        # Збільшити в 2.5 рази
        scale = 2.5
        new_w = int(binary.shape[1] * scale)
        new_h = int(binary.shape[0] * scale)
        resized = cv2.resize(binary, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

        return resized

    def ocr_image(self, image: np.ndarray) -> str:
        """Розпізнати текст з зображення"""
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
            Image.fromarray(image).save(tmp.name)
            temp_path = tmp.name

        try:
            result, _ = self.ocr(temp_path)
            if result:
                text = ' '.join([line[1] for line in result])
                return text
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

        return ""

    def recognize_label(self, image_path: str, debug: bool = False) -> Dict[str, any]:
        """
        ГІБРИДНИЙ підхід: використовуємо старий алгоритм + спеціальну обробку чорних блоків
        """
        image = Image.open(image_path)
        image_np = np.array(image)

        all_texts = []

        # ============================================================
        # КРОК 1: СТАРИЙ АЛГОРИТМ (для коду та кількості)
        # ============================================================

        # 1a. Оригінал
        full_text = self.ocr_image(image_np)
        all_texts.append(full_text)
        if debug:
            print(f"[Original] {full_text[:100]}...")

        # 1b. Інверсія всієї наклейки
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
        inverted = cv2.bitwise_not(gray)
        inv_processed = np.where(dark_mask > 0, inverted, gray)
        inv_text = self.ocr_image(inv_processed)
        all_texts.append(inv_text)
        if debug:
            print(f"[Inverted] {inv_text[:100]}...")

        # 1c. Контрастність
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        contrast = clahe.apply(gray)
        contrast_text = self.ocr_image(contrast)
        all_texts.append(contrast_text)

        # 1d. Бінаризація
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        binary_text = self.ocr_image(binary)
        all_texts.append(binary_text)

        # ============================================================
        # КРОК 2: НОВИЙ АЛГОРИТМ (тільки для чорних блоків - кодові букви)
        # ============================================================

        black_boxes = self.extract_black_boxes(image_np)
        if debug:
            print(f"Знайдено чорних блоків: {len(black_boxes)}")

        black_box_texts = []
        for idx, box in enumerate(black_boxes):
            processed_box = self.process_black_box(image_np, box)
            box_text = self.ocr_image(processed_box)
            if box_text:
                black_box_texts.append(box_text)
                if debug:
                    print(f"[Black box {idx+1}] {box_text}")

        # ============================================================
        # КРОК 3: ВИТЯГТИ ДАНІ З ГІБРИДНИМ ПІДХОДОМ
        # ============================================================

        # Об'єднаний текст зі СТАРОГО алгоритму (для коду та кількості)
        combined_standard = ' '.join(all_texts)

        # Текст з НОВОГО алгоритму (тільки для кодових букв)
        combined_black_boxes = ' '.join(black_box_texts)

        # Витягти дані
        data = self.extract_hybrid_data(
            standard_text=combined_standard,
            black_box_text=combined_black_boxes,
            debug=debug
        )

        return data

    def extract_hybrid_data(self, standard_text: str, black_box_text: str, debug: bool = False) -> Dict:
        """
        ГІБРИДНИЙ витяг даних:
        - Код та кількість - зі СТАРОГО алгоритму (надійніше)
        - Кодові букви - з НОВОГО алгоритму (спеціально для чорних блоків)
        """
        data = {
            'cell': None,
            'qtyPack': None,
            'prefix': None,
            'zone': None
        }

        text_upper = standard_text.upper()
        black_text_upper = black_box_text.upper()

        # ============================================================
        # 1. КОД (4 цифри) - зі СТАРОГО алгоритму
        # ============================================================
        cell_matches = re.findall(r'\b(\d{4})\b', text_upper)
        if cell_matches:
            for match in cell_matches:
                pattern = rf'.{{0,15}}{match}.{{0,15}}'
                context = re.search(pattern, text_upper)
                if context:
                    ctx_text = context.group()
                    # Виключаємо довгі номери
                    if not re.search(r'(ICC|PACK.*ID|REF|C1008|NO\.:)', ctx_text):
                        data['cell'] = match
                        if debug:
                            print(f"[CODE from standard] {match}")
                        break

        # ============================================================
        # 2. КІЛЬКІСТЬ (PACK) - зі СТАРОГО алгоритму
        # ============================================================

        # Шукаємо біля PACK
        pack_patterns = [
            r'(\d{1,3})\s*(?:PACK|PACE|PCS)',
            r'(?:PACK|PACE|PCS)\s*(\d{1,3})',
        ]

        for pattern in pack_patterns:
            matches = re.findall(pattern, text_upper)
            if matches:
                try:
                    qty = int(matches[0])
                    if 1 <= qty <= 200:
                        data['qtyPack'] = qty
                        if debug:
                            print(f"[PACK from standard] {qty}")
                        break
                except:
                    pass

        # Якщо не знайдено біля PACK, шукаємо окреме число
        if not data['qtyPack']:
            # Шукаємо числа після SKU або в кінці рядків з номерами
            standalone = re.findall(r'SKU.*?(\d{1,2})\b', text_upper)
            if not standalone:
                standalone = re.findall(r'\b(\d{1,2})\b', text_upper)

            for num_str in standalone:
                num = int(num_str)
                if 4 <= num <= 99:
                    # Не беремо якщо це частина коду
                    if data.get('cell') and num_str in data['cell']:
                        continue
                    data['qtyPack'] = num
                    if debug:
                        print(f"[PACK standalone] {num}")
                    break

        # ============================================================
        # 3. КОДОВІ БУКВИ - з НОВОГО алгоритму (чорні блоки)
        # ============================================================

        # Спочатку шукаємо в тексті з чорних блоків
        zone_patterns = [
            r'\b([A-Z]{2})\s*-\s*([A-Z])\b',
            r'\b([A-Z]{2})-([A-Z])\b',
            r'\b([A-Z0-9]{2})\s*-\s*([A-Z])\b',
        ]

        for pattern in zone_patterns:
            match = re.search(pattern, black_text_upper)
            if match:
                prefix_raw = match.group(1)
                zone_raw = match.group(2) if len(match.groups()) > 1 else None

                prefix = self.correct_letters(prefix_raw)
                zone = self.correct_letters(zone_raw) if zone_raw else None

                if len(prefix) == 2 and prefix.isalpha():
                    data['prefix'] = prefix
                    data['zone'] = zone if zone and zone.isalpha() else None
                    if debug:
                        print(f"[ZONE from black boxes] {prefix}-{zone}")
                    break

        # Якщо не знайдено в чорних блоках, шукаємо в стандартному тексті (fallback)
        if not data['prefix']:
            for pattern in zone_patterns:
                match = re.search(pattern, text_upper)
                if match:
                    prefix_raw = match.group(1)
                    zone_raw = match.group(2) if len(match.groups()) > 1 else None

                    prefix = self.correct_letters(prefix_raw)
                    zone = self.correct_letters(zone_raw) if zone_raw else None

                    if len(prefix) == 2 and prefix.isalpha():
                        data['prefix'] = prefix
                        data['zone'] = zone if zone and zone.isalpha() else None
                        if debug:
                            print(f"[ZONE from standard fallback] {prefix}-{zone}")
                        break

        return data

    def correct_letters(self, text: str) -> str:
        """
        Виправити поширені помилки OCR в літерах
        """
        if not text:
            return text

        corrected = text
        # Заміна цифр на літери
        corrected = corrected.replace('1', 'I')
        corrected = corrected.replace('0', 'O')
        corrected = corrected.replace('5', 'S')

        return corrected


def recognize_label_hybrid(image_path: str, debug: bool = False) -> Dict[str, any]:
    """
    Головна функція для Flask
    """
    ocr = HybridOCR()
    return ocr.recognize_label(image_path, debug=debug)


if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    else:
        image_path = r"ocr_training_data/images/20260926_202319_674530_user1_original.jpg"

    print(f"Тестування гібридного OCR: {image_path}")
    print("=" * 80)

    ocr = HybridOCR()
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
