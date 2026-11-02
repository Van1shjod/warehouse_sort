"""Measure real uploads in isolation and check all manually readable photos.

Run from the project directory: python benchmark_ocr.py
Uses temporary logs and a mocked database; never writes production OCR data.
"""

import importlib.util
import io
import json
import os
from pathlib import Path
import statistics
import tempfile
import time
from unittest.mock import patch


def main():
    root = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('ocr_benchmark_app', root / 'app.py')
    module = importlib.util.module_from_spec(spec)
    with patch('database.Database'):
        spec.loader.exec_module(module)
    module.app.config['TESTING'] = True
    client = module.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = 7

    annotations = json.loads((root / 'ocr_manual_audit.json').read_text(encoding='utf-8'))['photos']
    previous = json.loads((root / 'ocr_review_results.json').read_text(encoding='utf-8'))
    baseline = {row['file']: row['new'] for row in previous['results']}

    def recognize(filename, carton_type):
        record = json.loads((root / 'ocr_training_data' / carton_type / 'results' / filename).read_text(encoding='utf-8'))
        content = (root / record['image_path']).read_bytes()
        start = time.perf_counter()
        with patch('builtins.print'):
            response = client.post('/api/ocr/recognize', data={
                'type': carton_type, 'image': (io.BytesIO(content), 'label.jpg')})
        body = response.get_json()
        if response.status_code != 200:
            raise RuntimeError((filename, response.status_code, body))
        return {'file': filename, 'type': carton_type,
                'seconds': round(time.perf_counter() - start, 3),
                'actual': body.get('partial_data', body)}

    warmup = []
    rows = []
    previous_directory = Path.cwd()
    with tempfile.TemporaryDirectory() as directory:
        try:
            os.chdir(directory)
            for carton_type, filename in [
                    ('single', '20260928_060746_111865_user1_single_result.json'),
                    ('single', '20260928_060746_111865_user1_single_result.json'),
                    ('mix', '20261018_143101_412908_user1_mix_result.json')]:
                result = recognize(filename, carton_type)
                warmup.append(result)
                print('Timing:', json.dumps(result), flush=True)
            for filename, annotation in annotations.items():
                if annotation['status'] != 'readable':
                    continue
                carton_type = 'mix' if '_mix_' in filename else 'single'
                row = recognize(filename, carton_type)
                row['expected'] = annotation['expected']
                row['exact'] = row['actual'] == row['expected']
                row['regressed'] = baseline[filename] == row['expected'] and not row['exact']
                row['wrong_fields'] = [field for field, expected in row['expected'].items()
                                       if row['actual'].get(field) is not None
                                       and row['actual'][field] != expected]
                rows.append(row)
                if len(rows) % 10 == 0 or not row['exact']:
                    print('Checked:', len(rows), filename, 'exact:', row['exact'], flush=True)
        finally:
            os.chdir(previous_directory)

    summary = {'checked_readable': len(rows), 'exact': sum(row['exact'] for row in rows),
               'regressions': sum(row['regressed'] for row in rows),
               'photos_with_wrong_fields': sum(bool(row['wrong_fields']) for row in rows)}
    for carton_type in ['single', 'mix']:
        timings = [row['seconds'] for row in rows if row['type'] == carton_type]
        summary[carton_type] = {'median_seconds': round(statistics.median(timings), 3),
                                'min_seconds': min(timings), 'max_seconds': max(timings)}
    report = {'method': 'Actual Flask uploads with default production engine; network time excluded. '
                        'Fresh full pipeline on all 50 manually readable photos. No OCR cache.',
              'timings': warmup, 'summary': summary, 'results': rows}
    (root / 'ocr_optimized_results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2), flush=True)
    if summary['regressions'] or summary['photos_with_wrong_fields']:
        raise SystemExit('Recognition regression detected; review the report.')


if __name__ == '__main__':
    main()
