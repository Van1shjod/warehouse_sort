# -*- coding: utf-8 -*-
"""
Тест покращеного OCR на всіх реальних сканах
"""
import sys
import json
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from ocr_improved import ImprovedOCR

def main():
    """Протестувати на всіх реальних сканах"""

    # Завантажити всі результати
    results_dir = Path("ocr_training_data/results")
    result_files = sorted(results_dir.glob("*.json"))

    print(f"Знайдено {len(result_files)} реальних сканувань")
    print("=" * 80)

    ocr = ImprovedOCR()

    stats = {
        'total': 0,
        'old_success': 0,
        'new_success': 0,
        'improved': 0,
        'degraded': 0,
        'same': 0
    }

    improvements = []

    for result_file in result_files:
        with open(result_file, 'r', encoding='utf-8') as f:
            old_result = json.load(f)

        image_path = old_result.get('image_path', '')
        if not Path(image_path).exists():
            continue

        stats['total'] += 1

        # Старий результат
        old_success = old_result.get('success', False)
        old_data = old_result.get('extracted_data', {})

        if old_success:
            stats['old_success'] += 1

        # Новий результат
        try:
            new_data = ocr.recognize_label(image_path, debug=False)
            new_success = bool(
                new_data['cell'] and
                new_data['qtyPack'] and
                new_data['prefix'] and
                new_data['zone']
            )

            if new_success:
                stats['new_success'] += 1

            # Порівняння
            if new_success and not old_success:
                stats['improved'] += 1
                improvements.append({
                    'file': result_file.name,
                    'old': old_data,
                    'new': new_data
                })
                print(f"✓ ПОКРАЩЕННЯ: {result_file.name}")
                print(f"  Старий: {old_data}")
                print(f"  Новий: {new_data}")
                print()
            elif not new_success and old_success:
                stats['degraded'] += 1
                print(f"✗ ПОГІРШЕННЯ: {result_file.name}")
                print(f"  Старий: {old_data}")
                print(f"  Новий: {new_data}")
                print()
            else:
                stats['same'] += 1

        except Exception as e:
            print(f"Помилка обробки {result_file.name}: {e}")
            continue

    # Підсумок
    print("\n" + "=" * 80)
    print("ПІДСУМКОВА СТАТИСТИКА")
    print("=" * 80)
    print(f"Всього тестів: {stats['total']}")
    print(f"\nСтарий алгоритм (RapidOCR):")
    print(f"  Успішно: {stats['old_success']}/{stats['total']} ({stats['old_success']/stats['total']*100:.1f}%)")
    print(f"\nНовий алгоритм (Покращений):")
    print(f"  Успішно: {stats['new_success']}/{stats['total']} ({stats['new_success']/stats['total']*100:.1f}%)")
    print(f"\nЗміни:")
    print(f"  📈 Покращень: {stats['improved']}")
    print(f"  📉 Погіршень: {stats['degraded']}")
    print(f"  ➡️  Без змін: {stats['same']}")

    diff = stats['new_success'] - stats['old_success']
    if diff > 0:
        print(f"\n🎉 Новий алгоритм КРАЩИЙ на {diff} фото (+{diff/stats['total']*100:.1f}%)")
    elif diff < 0:
        print(f"\n⚠️ Новий алгоритм ГІРШИЙ на {abs(diff)} фото ({diff/stats['total']*100:.1f}%)")
    else:
        print(f"\n➡️ Алгоритми показують однаковий результат")

    # Зберегти детальні покращення
    if improvements:
        with open('ocr_improvements.json', 'w', encoding='utf-8') as f:
            json.dump(improvements, f, ensure_ascii=False, indent=2)
        print(f"\n💾 Детальні покращення збережено в: ocr_improvements.json")

if __name__ == '__main__':
    main()
