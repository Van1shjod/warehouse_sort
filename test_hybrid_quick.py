# -*- coding: utf-8 -*-
"""
Тест ГІБРИДНОГО OCR на всіх реальних сканах
"""
import sys
import json
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from ocr_hybrid import HybridOCR

def main():
    results_dir = Path("ocr_training_data/results")
    result_files = sorted(results_dir.glob("*.json"))

    print(f"Знайдено {len(result_files)} реальних сканувань")
    print("=" * 80)

    ocr = HybridOCR()

    stats = {
        'total': 0,
        'old_success': 0,
        'hybrid_success': 0,
        'improved': 0,
        'degraded': 0,
        'same': 0
    }

    for result_file in result_files:  # Всі фото
        with open(result_file, 'r', encoding='utf-8') as f:
            old_result = json.load(f)

        image_path = old_result.get('image_path', '')
        if not Path(image_path).exists():
            continue

        stats['total'] += 1
        old_success = old_result.get('success', False)
        old_data = old_result.get('extracted_data', {})

        if old_success:
            stats['old_success'] += 1

        try:
            new_data = ocr.recognize_label(image_path, debug=False)
            new_success = bool(
                new_data['cell'] and
                new_data['qtyPack'] and
                new_data['prefix'] and
                new_data['zone']
            )

            if new_success:
                stats['hybrid_success'] += 1

            if new_success and not old_success:
                stats['improved'] += 1
                print(f"✓ ПОКРАЩЕННЯ: {result_file.name}")
                print(f"  Старий: {old_data}")
                print(f"  Гібрид: {new_data}")
            elif not new_success and old_success:
                stats['degraded'] += 1
                print(f"✗ ПОГІРШЕННЯ: {result_file.name}")
            else:
                stats['same'] += 1

        except Exception as e:
            print(f"Помилка: {result_file.name}: {e}")
            continue

    print("\n" + "=" * 80)
    print("ПІДСУМКОВА СТАТИСТИКА (всі 49 тестів)")
    print("=" * 80)
    print(f"Старий: {stats['old_success']}/{stats['total']} ({stats['old_success']/stats['total']*100:.1f}%)")
    print(f"Гібрид: {stats['hybrid_success']}/{stats['total']} ({stats['hybrid_success']/stats['total']*100:.1f}%)")
    print(f"Покращень: {stats['improved']}, Погіршень: {stats['degraded']}")

    diff = stats['hybrid_success'] - stats['old_success']
    if diff > 0:
        print(f"\n🎉 Гібрид КРАЩИЙ на {diff} фото")
    elif diff < 0:
        print(f"\n⚠️ Гібрид ГІРШИЙ на {abs(diff)} фото")
    else:
        print(f"\n➡️ Однаково")

if __name__ == '__main__':
    main()
