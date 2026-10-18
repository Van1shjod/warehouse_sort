#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для жорсткої перевірки та видалення OCR логів без фото
"""

import os
import json
import sys

def cleanup_ocr_logs_strict():
    """Видалити всі OCR логи без реальних фото"""
    base_dir = 'ocr_training_data'

    if not os.path.exists(base_dir):
        print(f"❌ Директорія {base_dir} не існує")
        return

    stats = {
        'total': 0,
        'with_images': 0,
        'deleted': 0
    }

    carton_types = ['single', 'mix', 'vevor']

    for carton_type in carton_types:
        results_dir = os.path.join(base_dir, carton_type, 'results')

        if not os.path.exists(results_dir):
            continue

        print(f"\n📂 Перевіряю {carton_type}...")

        json_files = [f for f in os.listdir(results_dir) if f.endswith('_result.json')]

        for json_file in json_files:
            stats['total'] += 1
            json_path = os.path.join(results_dir, json_file)

            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                image_path = data.get('image_path', '')

                # Реальна перевірка: чи існує файл зображення
                if not image_path or not os.path.exists(image_path):
                    print(f"  🗑️  Видаляю {json_file}")
                    if image_path:
                        print(f"      Шлях: {image_path} - НЕ ІСНУЄ")
                    else:
                        print(f"      Немає шляху до зображення")
                    os.remove(json_path)
                    stats['deleted'] += 1
                else:
                    # Перевіримо розмір файлу - якщо 0 байт, теж видаляємо
                    file_size = os.path.getsize(image_path)
                    if file_size == 0:
                        print(f"  🗑️  Видаляю {json_file} - порожнє зображення")
                        os.remove(json_path)
                        os.remove(image_path)  # Видаляємо і порожнє зображення
                        stats['deleted'] += 1
                    else:
                        stats['with_images'] += 1
                        print(f"  ✅ {json_file} - фото є ({file_size} байт)")

            except Exception as e:
                print(f"  ❌ Помилка обробки {json_file}: {e}")
                # Якщо помилка - теж видаляємо
                try:
                    os.remove(json_path)
                    stats['deleted'] += 1
                except:
                    pass

    # Виводимо статистику
    print("\n" + "="*50)
    print("📊 СТАТИСТИКА:")
    print("="*50)
    print(f"Всього записів:         {stats['total']}")
    print(f"✅ З фото:              {stats['with_images']}")
    print(f"🗑️  Видалено:           {stats['deleted']}")
    print("="*50)

    return stats

if __name__ == '__main__':
    print("🔍 Жорстка перевірка OCR логів на наявність фото...\n")
    stats = cleanup_ocr_logs_strict()
    print(f"\n✅ Завершено!")
    sys.exit(0)
