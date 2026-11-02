# Матеріали на остаточне видалення

Ці файли винесено з робочих папок 02.11.2026. Вони збережені в
`archive/cleanup-2026-11-02/`, доки користувач не погодить остаточне видалення.

Поточний сервер імпортує `ocr_labels.py`; архівні OCR-реалізації в ньому
не використовуються. `inventory-flow.*` не підключався до шаблонів. Демонстраційні
`index.html`, `about.html` і `script.js` не мають діючих маршрутів.
Старі експериментальні тести працювали з уже видаленими фото.
Архівні допоміжні скрипти залежать від старих знімків/результатів і не входять
до основних перевірок. Застарілі звіти дублюють або суперечать поточному контексту.

Автоматична перевірка безпеки відхилила безповоротне видалення загального
списку через можливу цінність старих вихідних OCR-модулів і тестів.
Замість видалення їх переміщено в архів.

## Список файлів

- `CHANGELOG_2026-10-05.md`
- `FEATURE_PLAN.md`
- `IMPROVEMENTS.md`
- `OCR_AUDIT.md`
- `SUMMARY_2026-10-05.md`
- `artifacts/audit-2026-10-31/behavior.mjs`
- `artifacts/audit-2026-10-31/responsive.mjs`
- `artifacts/collection-review/review-languages.mjs`
- `artifacts/collection-review/review-login-language.mjs`
- `artifacts/collection-review/review-theme-choice.mjs`
- `artifacts/collection-review/review-theme.mjs`
- `artifacts/collection-review/review-workflow-languages.mjs`
- `artifacts/collection-review/review.mjs`
- `artifacts/collection-review/server.py`
- `artifacts/presentation/.build/build.mjs`
- `artifacts/presentation/.build/capture.mjs`
- `artifacts/presentation/.build/capture_clean.mjs`
- `artifacts/presentation/.build/capture_more.mjs`
- `artifacts/presentation/.build/capture_tail.mjs`
- `artifacts/presentation/.build/demo_server.py`
- `artifacts/presentation/.portal-build/build.mjs`
- `artifacts/presentation/.portal-build/deduplicate_media.py`
- `artifacts/presentation/.portal-build/finalize.mjs`
- `artifacts/presentation/.portal-build/render_final.mjs`
- `artifacts/ui-review/.build/demo_server.py`
- `artifacts/ui-review/.build/review.mjs`
- `benchmark_ocr.py`
- `cleanup_ocr_logs.py`
- `cleanup_ocr_strict.py`
- `ocr_hybrid.py`
- `ocr_improved.py`
- `ocr_mix.py`
- `review_ocr_logs.py`
- `static/inventory-flow.css`
- `static/inventory-flow.js`
- `static/script.js`
- `summarize_ocr_audit.py`
- `templates/about.html`
- `templates/index.html`
- `test_hybrid_quick.py`
- `test_improved_ocr.py`
