"""Compare the saved replay with visual annotations, without tuning OCR."""

from collections import Counter
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    report = json.loads((root / 'ocr_review_results.json').read_text(encoding='utf-8'))
    annotations = json.loads((root / 'ocr_manual_audit.json').read_text(encoding='utf-8'))['photos']
    rows = []
    fields = ('cell', 'qtyPack', 'prefix', 'zone')
    for replay in report['results']:
        annotation = annotations[replay['file']]
        row = {'file': replay['file'], 'carton_type': replay['carton_type'], **annotation,
               'actual': replay['new'], 'original_result': replay['old']}
        if annotation['status'] == 'readable':
            expected = annotation['expected']
            differences = {field: {'expected': expected[field], 'actual': replay['new'][field]}
                           for field in fields if replay['new'][field] != expected[field]}
            row['differences'] = differences
            row['outcome'] = ('exact' if not differences else
                              'incorrect' if any(value['actual'] is not None
                                                 for value in differences.values()) else 'incomplete')
        else:
            row['outcome'] = ('rejected' if not any(replay['new'].values())
                              else 'unexpected_output')
        rows.append(row)

    def summarize(group):
        readable = [row for row in group if row['status'] == 'readable']
        outcomes = Counter(row['outcome'] for row in readable)
        return {'photos': len(group), 'readable_labels': len(readable),
                'exact': outcomes['exact'], 'incomplete': outcomes['incomplete'],
                'incorrect': outcomes['incorrect'],
                'exact_percent_of_readable': round(100 * outcomes['exact'] / len(readable), 2)
                if readable else None,
                'unreadable_or_no_target': sum(row['status'] == 'unreadable' for row in group),
                'wrong_type': sum(row['status'] == 'wrong_type' for row in group)}

    summary = {'additional_48': summarize([row for row in rows if row['group'] == 'additional']),
               'all_60': summarize(rows),
               'method': 'Visual transcription of saved photos compared to the saved replay. '
                         'Single/Vevor replay uses stored full-image OCR text plus newly recognized '
                         'panel crops. MIX replay uses stored original/contrast text plus new '
                         'gray/joined recognition. No OCR tuning during this audit.'}
    output = {'summary': summary, 'results': rows}
    (root / 'ocr_manual_audit_results.json').write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = ['# Перевірка OCR за збереженими фото', '',
             'Успіх означає точний збіг усіх потрібних полів: ICC, PACK, префікса та зони '
             'для Single; повного ICC для Mix. Пропущене поле рахується як неповний результат.', '',
             '| Вибірка | Читабельні наклейки | Усі поля правильні | Неповні | Хибні значення | Частка повних правильних |',
             '| --- | ---: | ---: | ---: | ---: | ---: |']
    for key, title in [('additional_48', 'Решта 48 фото'), ('all_60', 'Усі 60 фото')]:
        stats = summary[key]
        lines.append(f"| {title} | {stats['readable_labels']} | {stats['exact']} | "
                     f"{stats['incomplete']} | {stats['incorrect']} | {stats['exact_percent_of_readable']}% |")
    stats = summary['all_60']
    lines += ['', f"Окремо: {stats['unreadable_or_no_target']} кадрів без надійно читабельної цільової наклейки; "
              f"{stats['wrong_type']} фото Mix надіслано в режимі Single. Вони не входять у знаменник точності читабельних наклейок.", '',
              'Це результат на наявному архіві, який містить повторні фото тих самих товарів. '
              'Початкові 12 прикладів використовувалися для налаштування; решта 48 перевірені після нього. '
              'Це не оцінка точності на 60 незалежних нових наклейках.', '',
              'Для Single повторно розпізнано області полів на фото, а повнотекстові варіанти взято зі збережених логів. '
              'Для Mix додатково розпізнано нові варіанти gray/joined. Під час цієї перевірки алгоритм не змінювався.', '',
              '## Неповні або помилкові результати', '']
    for row in rows:
        if row.get('differences'):
            changes = '; '.join(f"{field}: очікується {value['expected']}, отримано {value['actual']}"
                                for field, value in row['differences'].items())
            lines.append(f"- `{row['file']}` — {changes}.")
    (root / 'OCR_AUDIT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
