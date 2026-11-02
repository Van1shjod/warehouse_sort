# -*- coding: utf-8 -*-
"""
OCR для MIX наклейок
Проста наклейка з ICC кодом зверху та кількістю в рамці
"""
import sys
import cv2
import numpy as np
from PIL import Image
import re
import os
import tempfile
from typing import Dict, Optional

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

class MixOCR:
    """OCR для розпізнавання MIX наклейок"""

    def __init__(self):
        """Ініціалізація OCR"""
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.ocr = RapidOCR()
            print("✓ RapidOCR ініціалізовано для MIX")
        except Exception as e:
            raise Exception(f"Не вдалося завантажити RapidOCR: {e}")

    def preprocess_image(self, image_np: np.ndarray) -> np.ndarray:
        """Попередня обробка зображення для кращого розпізнавання"""
        # Конвертувати в grayscale
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)

        # Підвищити контрастність
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)

        # Бінаризація
        _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Збільшити зображення для кращого розпізнавання
        scale = 2.0
        width = int(binary.shape[1] * scale)
        height = int(binary.shape[0] * scale)
        resized = cv2.resize(binary, (width, height), interpolation=cv2.INTER_CUBIC)

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
        Розпізнати MIX наклейку
        Структура:
        - Перший рядок: ICC код (літера + цифри, наприклад D980989)
        - Посередині: 《 5 》 - кількість в рамці
        - Внизу: Made in China
        """
        image = Image.open(image_path)
        image_np = np.array(image)

        # Спробувати різні варіанти обробки
        variants = []

        # 1. Оригінал
        original_text = self.ocr_image(image_np)
        variants.append(original_text)
        if debug:
            print(f"[Original] {original_text}")

        # 2. Покращена версія
        enhanced = self.preprocess_image(image_np)
        enhanced_text = self.ocr_image(enhanced)
        variants.append(enhanced_text)
        if debug:
            print(f"[Enhanced] {enhanced_text}")

        # 3. Збільшена версія
        scale = 3.0
        width = int(image_np.shape[1] * scale)
        height = int(image_np.shape[0] * scale)
        upscaled = cv2.resize(image_np, (width, height), interpolation=cv2.INTER_CUBIC)
        upscaled_text = self.ocr_image(upscaled)
        variants.append(upscaled_text)
        if debug:
            print(f"[Upscaled] {upscaled_text}")

        # Об'єднати всі варіанти
        combined_text = ' '.join(variants)

        # Витягти дані
        data = self.extract_mix_data(combined_text, debug=debug)

        return data

    def extract_mix_data(self, text: str, debug: bool = False) -> Dict:
        """
        Витягти дані з MIX наклейки
        - Тільки ICC код: перший рядок (літера + цифри)
        - Приклади: D980989, D980947, A123456, B7654321
        """
        data = {
            'cell': None,
            'qtyPack': None,
            'prefix': None,
            'zone': None
        }

        text_upper = text.upper()

        if debug:
            print(f"[Text] {text_upper[:200]}")

        # ============================================================
        # ICC КОД - перший рядок (літера + цифри)
        # ============================================================

        # Шукаємо патерн: літера + 5-7 цифр
        # Приклади: D980989, D980947, A123456, B7654321
        icc_patterns = [
            r'\b([A-Z]\d{6,7})\b',  # Літера + 6-7 цифр (найпоширеніше)
            r'\b([A-Z]\d{5})\b',    # Літера + 5 цифр
            r'\b([A-Z]{1,2}\d{5,7})\b',  # 1-2 літери + 5-7 цифр
        ]

        for pattern in icc_patterns:
            matches = re.findall(pattern, text_upper)
            if matches:
                # Фільтруємо, щоб виключити "Made in China" та інші слова
                for match in matches:
                    if not any(word in match for word in ['MADE', 'CHINA', 'IN']):
                        # Зберігаємо повний код
                        data['cell'] = match
                        if debug:
                            print(f"[ICC CODE] {match}")
                        return data

        if debug:
            print("[ICC CODE] Не знайдено")

        return data

def test_mix_ocr():
    """Тестування MIX OCR"""
    import sys

    if len(sys.argv) < 2:
        print("Використання: python ocr_mix.py <шлях_до_фото>")
        return

    image_path = sys.argv[1]

    if not os.path.exists(image_path):
        print(f"❌ Файл не знайдено: {image_path}")
        return

    print(f"📸 Розпізнаю MIX наклейку: {image_path}")
    print("=" * 50)

    ocr = MixOCR()
    result = ocr.recognize_label(image_path, debug=True)

    print("\n" + "=" * 50)
    print("📊 РЕЗУЛЬТАТ:")
    print("=" * 50)
    print(f"ICC код (останні 4 цифри): {result['cell']}")
    print(f"Кількість (PACK): {result['qtyPack']}")
    print(f"Префікс: {result['prefix']}")
    print(f"Зона: {result['zone']}")

    if result['cell'] and result['qtyPack']:
        print("\n✅ Розпізнавання успішне!")
    else:
        print("\n⚠️ Не всі дані розпізнані")

if __name__ == '__main__':
    test_mix_ocr()
