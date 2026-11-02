"""Replay stored OCR logs/photos into a separate report without changing them.

Run: python review_ocr_logs.py
The verified subset measures exact field matches, not just non-empty fields.
"""

import json
from pathlib import Path

import cv2
from rapidocr_onnxruntime import RapidOCR

from ocr_labels import extract_from_variants, read_label_panel


def main():
    root = Path(__file__).resolve().parent
    verified = json.loads((root / 'ocr_verified_labels.json').read_text(encoding='utf-8'))['labels']
    engine = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    rows = []
    for path in sorted((root / 'ocr_training_data').glob('*/results/*.json')):
        record = json.loads(path.read_text(encoding='utf-8'))
        carton_type = record.get('carton_type', path.parent.parent.name)
        image_path = root / record.get('image_path', '')
        raw = record.get('raw_ocr_results', {}).copy()
        image_exists = image_path.is_file()
        if image_exists:
            image = cv2.cvtColor(cv2.imread(str(image_path)), cv2.COLOR_BGR2RGB)
            if carton_type == 'mix':
                gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
                # Retest the new MIX variants; retain the saved original/contrast.
                raw = {name: text for name, text in raw.items()
                       if name in ('original', 'contrast')}
                joined = cv2.morphologyEx(gray, cv2.MORPH_OPEN,
                                         cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)))
                for name, variant in [('gray', gray), ('joined', joined)]:
                    result, _ = engine(variant)
                    if result:
                        raw[name] = ' '.join(line[1] for line in result)
        data = extract_from_variants(raw, carton_type)
        if carton_type != 'mix' and image_exists:
            panel, panel_raw = read_label_panel(image, engine)
            raw.update(panel_raw)
            data.update({field: value for field, value in panel.items() if value is not None})
        expected = record.get('corrected_data') or verified.get(path.name)
        rows.append({'file': path.name, 'carton_type': carton_type,
                     'image_exists': image_exists, 'old': record.get('extracted_data'),
                     'new': data, 'expected': expected, 'raw_results': raw})

    checked = [row for row in rows if row['expected']]
    summary = {'reviewed': len(rows), 'verified': len(checked),
               'old_exact_matches': sum(row['old'] == row['expected'] for row in checked),
               'new_exact_matches': sum(row['new'] == row['expected'] for row in checked)}
    output = root / 'ocr_review_results.json'
    output.write_text(json.dumps({'summary': summary, 'results': rows},
                                 ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)
    for row in checked:
        if row['new'] != row['expected']:
            print('Needs review:', row['file'], row['new'], flush=True)
    print('Report:', output, flush=True)


if __name__ == '__main__':
    main()
