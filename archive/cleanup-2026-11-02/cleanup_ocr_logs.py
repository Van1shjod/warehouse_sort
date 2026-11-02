#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для перевірки та очищення OCR логів
- Перевіряє чи існують зображення для кожного OCR запису
- Видаляє JSON файли якщо зображення не існує
- Видаляє JSON файли з некоректними шляхами
"""

import os
import json
import sys

def cleanup_ocr_logs():
    """Очистити OCR логи без фото"""
    base_dir = 'ocr_training_data'

    if not os.path.exists(base_dir):
        print(f"❌ Директорія {base_dir} не існує")
        return

    stats = {
        'total': 0,
        'valid': 0,
        'deleted': 0,
        'fixed': 0
    }

    carton_types = ['single', 'mix', 'vevor']

    for carton_type in carton_types:
        results_dir = os.path.join(base_dir, carton_type, 'results')
        images_dir = os.path.join(base_dir, carton_type, 'images')

        if not os.path.exists(results_dir):
            print(f"⚠️  Директорія {results_dir} не існує, пропускаю...")
            continue

        print(f"\n📂 Перевіряю {carton_type}...")

        # Отримуємо всі JSON файли
        json_files = [f for f in os.listdir(results_dir) if f.endswith('_result.json')]

        for json_file in json_files:
            stats['total'] += 1
            json_path = os.path.join(results_dir, json_file)

            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                image_path = data.get('image_path', '')

                # Перевірка 1: Чи є шлях до зображення
                if not image_path:
                    print(f"  🗑️  Видаляю {json_file} - немає шляху до зображення")
                    os.remove(json_path)
                    stats['deleted'] += 1
                    continue

                # Перевірка 2: Чи існує файл зображення
                if not os.path.exists(image_path):
                    # Спробуємо знайти зображення за альтернативним шляхом
                    image_filename = os.path.basename(image_path)
                    alternative_path = os.path.join(images_dir, image_filename)

                    if os.path.exists(alternative_path):
                        # Виправляємо шлях в JSON
                        print(f"  🔧 Виправляю шлях для {json_file}")
                        data['image_path'] = alternative_path
                        with open(json_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        stats['fixed'] += 1
                        stats['valid'] += 1
                    else:
                        print(f"  🗑️  Видаляю {json_file} - зображення не знайдено: {image_path}")
                        os.remove(json_path)
                        stats['deleted'] += 1
                else:
                    # Зображення існує, все ОК
                    stats['valid'] += 1

            except Exception as e:
                print(f"  ❌ Помилка обробки {json_file}: {e}")
                continue

    # Виводимо статистику
    print("\n" + "="*50)
    print("📊 СТАТИСТИКА:")
    print("="*50)
    print(f"Всього записів:         {stats['total']}")
    print(f"✅ Валідних:            {stats['valid']}")
    print(f"🔧 Виправлено:          {stats['fixed']}")
    print(f"🗑️  Видалено:           {stats['deleted']}")
    print("="*50)

    return stats

if __name__ == '__main__':
    print("🔍 Починаю перевірку OCR логів...\n")
    stats = cleanup_ocr_logs()
    print(f"\n✅ Завершено!")
    sys.exit(0)
