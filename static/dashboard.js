// OCR transitions must not summon the phone keyboard. Manual steps retain focus.
let ocrFocusDepth = 0;
function focusWorkInput(input) {
    if (!ocrFocusDepth) input.focus();
}

let currentType = null;
let currentICCCode = null;
let currentICCData = null;
let currentPalletNumber = null;
let pendingCartonsCount = null;
let scannedData = null; // Зберігаємо дані після сканування
let currentContainer = null; // Поточний обраний контейнер
let currentSort = null; // Поточний обраний сорт
let pendingSortSave = null;
let sortSaveInFlight = false;
let sortCheckGeneration = 0;
const sortPendingKey = 'warehouse-sort-pending-' + (typeof userId === 'undefined' ? 'unknown' : userId);
try {
    const saved = JSON.parse(sessionStorage.getItem(sortPendingKey) || 'null');
    if (saved?.request_id && saved.sort_id && saved.icc_code) pendingSortSave = saved;
} catch (_) {}
window.hasPendingSortSave = () => !!pendingSortSave || sortSaveInFlight;

function syncSortSaveControls() {
    const locked = !!pendingSortSave || sortSaveInFlight;
    document.querySelectorAll('#work-area input, #work-area button, #location-modal input, #location-modal button, #confirmation-modal input, #confirmation-modal button').forEach(node => { node.disabled = locked; });
    const notice = document.getElementById('sort-pending-notice');
    if (notice) notice.hidden = !pendingSortSave;
    const retry = document.getElementById('sort-retry-btn');
    if (retry) retry.disabled = sortSaveInFlight;
    const text = document.getElementById('sort-pending-text');
    if (text && pendingSortSave) text.textContent = `${sortSaveInFlight ? 'Зберігаю' : 'Збереження не підтверджене'}: ${pendingSortSave.icc_code}, ${pendingSortSave.cartons_count} картонів → палета ${pendingSortSave.pallet_number}. Повторення цієї операції не додає дубль.`;
}

function sortActionBlocked() {
    if (!pendingSortSave && !sortSaveInFlight) return false;
    syncSortSaveControls();
    showToast('Спочатку повторіть непідтверджене збереження цього картону.', 'warning', 3500);
    return true;
}

function clearPendingSortSave() {
    pendingSortSave = null;
    try { sessionStorage.removeItem(sortPendingKey); } catch (_) {}
}

function allowedSortTypes() {
    const types = String(currentSort?.type || '').split(',').map(type => type.trim().toLowerCase()).filter(type => ['single','mix','vevor'].includes(type));
    return types.length ? types : ['single','mix','vevor'];
}

// Функція для показу toast повідомлень (замість alert)
function showToast(message, type = 'info', duration = 2500) {
    const toast = document.getElementById('toast-message');

    // Очистити попередні класи
    toast.className = 'toast-message';

    // Додати тип (error, success, warning, info)
    toast.classList.add(type);
    toast.classList.add('show');

    // Встановити текст
    toast.textContent = String(message).replace(/<br\s*\/?>/gi, '\n').replace(/<\/?strong>/gi, '');
    toast.style.whiteSpace = 'pre-line';

    // Автоматично сховати через duration мілісекунд
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// Завантажити статистику
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        for (const [id, field] of [['single-pallets','single_pallets'],['mix-pallets','mix_pallets'],['vevor-pallets','vevor_pallets']]) {
            const counter = document.getElementById(id);
            if (counter) counter.textContent = data[field];
        }
    } catch (error) {
        console.error('Помилка завантаження статистики:', error);
    }
}

// Завантажити поточний контейнер користувача
async function loadCurrentContainer() {
    try {
        const response = await fetch('/api/container/current');
        if (response.ok) {
            const data = await response.json();
            if (data && data.is_active === 1) {
                currentContainer = data;
                showCurrentContainerInfo(data);
            } else {
                currentContainer = null;
                hideCurrentContainerInfo();
            }
        }
    } catch (error) {
        console.error('Помилка завантаження контейнера:', error);
    }
}

// Показати інформацію про поточний контейнер
function showCurrentContainerInfo(containerData) {
    const infoDiv = document.getElementById('current-container-info');
    const containerNumber = document.getElementById('current-container-number');

    containerNumber.textContent = containerData.container_number;
    infoDiv.style.display = 'block';
}

// Сховати інформацію про контейнер
function hideCurrentContainerInfo() {
    document.getElementById('current-container-info').style.display = 'none';
}

// Перевірити контейнер і показати меню Sort
async function checkContainerAndShowSortMenu() {
    // Якщо контейнер вже обрано - показати меню
    if (currentContainer && currentContainer.is_active === 1) {
        showSortMenu();
        return;
    }

    // Якщо немає контейнера - показати вибір контейнера
    await showContainerSelection();
}

// Показати вибір контейнера
async function showContainerSelection() {
    try {
        const response = await fetch('/api/containers');
        const containers = await response.json();

        if (containers.length === 0) {
            showToast('Немає доступних контейнерів. Зверніться до адміністратора.', 'error', 3000);
            return;
        }

        const containersList = document.getElementById('containers-list');
        containersList.innerHTML = '';

        containers.forEach(container => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-large btn-primary';
            btn.style.width = '100%';
            btn.textContent = container.container_number;
            btn.onclick = () => selectContainer(container.id);
            containersList.appendChild(btn);
        });

        document.getElementById('container-selection').style.display = 'block';
    } catch (error) {
        console.error('Помилка завантаження контейнерів:', error);
        showToast('Помилка завантаження контейнерів', 'error');
    }
}

// Вибрати контейнер
async function selectContainer(containerId) {
    try {
        const requestBody = { container_id: containerId };

        // Якщо обрано сорт - передати його ID
        if (currentSort && currentSort.id) {
            requestBody.sort_id = currentSort.id;
        }

        const response = await fetch('/api/container/select', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            currentContainer = data.container;
            showCurrentContainerInfo(data.container);
            document.getElementById('container-selection').style.display = 'none';
            showToast('Контейнер обрано: ' + data.container.container_number, 'success');

            // Показати меню Sort після вибору контейнера
            showSortMenu();
        } else {
            showToast(data.error || 'Помилка вибору контейнера', 'error');
        }
    } catch (error) {
        console.error('Помилка вибору контейнера:', error);
        showToast('Помилка вибору контейнера', 'error');
    }
}

// Скасувати вибір контейнера
function cancelContainerSelection() {
    document.getElementById('container-selection').style.display = 'none';
}

// Завершити роботу з контейнером
async function endContainerWork() {
    if (!confirm('Ви впевнені, що хочете завершити роботу з цим контейнером?')) {
        return;
    }

    try {
        const response = await fetch('/api/container/end', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            currentContainer = null;
            hideCurrentContainerInfo();
            showToast('Роботу з контейнером завершено', 'success');
        } else {
            showToast(data.error || 'Помилка завершення роботи', 'error');
        }
    } catch (error) {
        console.error('Помилка завершення роботи з контейнером:', error);
        showToast('Помилка завершення роботи', 'error');
    }
}

// ============================================
// ФУНКЦІЇ ДЛЯ РОБОТИ З СОРТАМИ
// ============================================

// Завантажити поточний сорт користувача
async function loadCurrentSort() {
    // Поки що сорт зберігається в localStorage
    const savedSortId = localStorage.getItem('currentSortId');
    if (savedSortId) {
        try {
            const response = await fetch(`/api/sorts/${savedSortId}`);
            if (response.ok) {
                const sort = await response.json();
                if (sort.status === 'active' && sort.mode !== 'presort') {
                    currentSort = sort;
                    window.loadPresortSource?.(sort);
                    showCurrentSortInfo(sort);
                } else {
                    // Сорт неактивний - видалити з localStorage
                    localStorage.removeItem('currentSortId');
                    currentSort = null;
                    hideCurrentSortInfo();
                }
            } else {
                localStorage.removeItem('currentSortId');
                currentSort = null;
                hideCurrentSortInfo();
            }
        } catch (error) {
            console.error('Помилка завантаження сорту:', error);
            currentSort = null;
            hideCurrentSortInfo();
        }
    } else {
        currentSort = null;
        hideCurrentSortInfo();
    }
}

// Показати інформацію про поточний сорт
function showCurrentSortInfo(sort) {
    const infoDiv = document.getElementById('current-sort-info');
    const sortName = document.getElementById('current-sort-name');
    const sortDetails = document.getElementById('current-sort-details');

    sortName.textContent = `#${sort.id} · ${sort.name}`;
    const workSortName = document.getElementById('work-sort-name');
    if (workSortName) workSortName.textContent = sort.name;

    const typeLabels = {
        'zone': '🏢 Зона',
        'ramp': '🚛 Рампа',
        'container': '📦 Контейнер',
        'other': '📋 Інше'
    };
    const cartonLabels = {single:'Single',mix:'Mix',vevor:'Vevor'};
    const typeLabel = String(sort.type).split(',').map(type => cartonLabels[type] || typeLabels[type] || type).join(' / ');

    const unloadDate = new Date(sort.unload_date).toLocaleDateString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    sortDetails.textContent = `${typeLabel} • Розвантаження: ${unloadDate}`;
    infoDiv.style.display = 'block';
}

// Сховати інформацію про сорт
function hideCurrentSortInfo() {
    document.getElementById('current-sort-info').style.display = 'none';
}

// Перевірити сорт і показати меню Sort
async function checkContainerAndShowSortMenu() {
    if (sortActionBlocked()) return;
    // Завжди показувати вибір сорту після натискання SORT
    await showSortSelection();
}

// Показати вибір сорту
async function showSortSelection() {
    if (sortActionBlocked()) return;
    sortCheckGeneration++;
    try {
        const response = await fetch('/api/sorts?mode=sort');
        if (!response.ok) throw new Error('Не вдалося завантажити сорти');
        const sorts = await response.json();

        if (sorts.length === 0) {
            showToast('Немає доступних сортів. Зверніться до адміністратора.', 'error', 3000);
            return;
        }

        const sortsList = document.getElementById('sorts-list');
        sortsList.innerHTML = '';

        sorts.forEach(sort => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-large btn-primary';
            btn.style.cssText = 'width: 100%; text-align: left; padding: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;';

            const typeLabels = {
                'zone': '🏢 Зона',
                'ramp': '🚛 Рампа',
                'container': '📦 Контейнер',
                'other': '📋 Інше'
            };
            const typeLabel = typeLabels[sort.type] || sort.type;

            const unloadDate = new Date(sort.unload_date).toLocaleDateString('uk-UA', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            let progressText = '';
            if (sort.icc_count > 0) {
                progressText = `<div style="font-size: 0.9rem; opacity: 0.9;">Прогрес: ${sort.completed_count} / ${sort.icc_count} ICC кодів завершено</div>`;
            }

            const title = document.createElement('div');
            title.style.cssText = 'font-size: 1.3rem; font-weight: bold;';
            title.dataset.noTranslate=''; title.textContent = `#${sort.id} · ${sort.mode === 'presort' ? 'PRE-SORT' : 'SORT'} · ${sort.name}`;
            const details = document.createElement('div');
            details.textContent = `${typeLabel} • ${unloadDate}`;
            btn.append(title, details);
            if (sort.has_presort_source) {
                const source = document.createElement('div');
                source.textContent = 'Є дані Pre-sort: пошук початкових палет';
                btn.append(source);
            }
            if (sort.description) {
                const notes = document.createElement('div');
                notes.textContent = sort.description; notes.dataset.noTranslate='';
                btn.append(notes);
            }
            if (sort.mode !== 'presort' && sort.icc_count > 0) {
                const progress = document.createElement('div');
                progress.textContent = `Прогрес: ${sort.completed_count} / ${sort.icc_count} ICC кодів завершено`;
                btn.append(progress);
            }
            btn.onclick = () => selectSort(sort.id);
            sortsList.appendChild(btn);
        });

        document.getElementById('sort-selection').style.display = 'block';
    } catch (error) {
        console.error('Помилка завантаження сортів:', error);
        showToast('Помилка завантаження сортів', 'error');
    }
}

// Вибрати сорт
async function selectSort(sortId) {
    if (sortActionBlocked()) return;
    sortCheckGeneration++;
    try {
        const response = await fetch(`/api/sorts/${sortId}`);
        const data = await response.json();

        if (response.ok) {
            if (data.status !== 'active') { showToast('Цей сорт уже закритий або призупинений. Оберіть інший.', 'warning'); return; }
            if (data.mode === 'presort') {
                window.location.href = `/presort?sort_id=${data.id}`;
                return;
            }
            currentSort = data;
            window.loadPresortSource?.(data);
            localStorage.setItem('currentSortId', sortId);
            showCurrentSortInfo(data);
            document.getElementById('sort-selection').style.display = 'none';

            // Одразу показати меню Sort (без вибору контейнера)
            showSortMenu();
        } else {
            showToast(data.error || 'Помилка вибору сорту', 'error');
        }
    } catch (error) {
        console.error('Помилка вибору сорту:', error);
        showToast('Помилка вибору сорту', 'error');
    }
}

// Скасувати вибір сорту
function cancelSortSelection() {
    document.getElementById('sort-selection').style.display = 'none';
}

// Змінити вибір сорту
async function changeSortSelection() {
    if (sortActionBlocked()) return;
    if (confirm('Ви впевнені, що хочете змінити сорт? Поточна робота буде збережена.')) {
        localStorage.removeItem('currentSortId');
        currentSort = null;
        hideCurrentSortInfo();
        window.loadPresortSource?.(null);
        await showSortSelection();
    }
}

// Показати меню Sort
function showSortMenu() {
    if (sortActionBlocked()) return;
    sortCheckGeneration++;
    for (const type of ['single','mix','vevor']) {
        const button = document.getElementById(`sort-type-${type}-btn`);
        if (button) { button.hidden = !allowedSortTypes().includes(type); button.disabled = button.hidden; }
    }
    document.getElementById('sort-menu').style.display = 'flex';
}

// Закрити меню Sort
function closeSortMenu() {
    document.getElementById('sort-menu').style.display = 'none';
}

// Вибрати тип
function selectType(type) {
    if (sortActionBlocked()) return;
    if (!currentSort || !allowedSortTypes().includes(type)) {
        showToast('Оберіть дозволений тип у поточному сорті.', 'warning'); return;
    }
    currentType = type;
    document.getElementById('current-type').textContent = type.toUpperCase();
    closeSortMenu();
    document.getElementById('work-area').style.display = 'block';
    resetWorkArea();

    // Показуємо відповідну секцію для кожного типу
    if (type === 'single' || type === 'vevor') {
        document.getElementById('single-input-section').style.display = 'block';
        focusWorkInput(document.getElementById('icc-code-input'));
    } else if (type === 'mix') {
        document.getElementById('mix-input-section').style.display = 'block';
        focusWorkInput(document.getElementById('mix-icc-code-input'));
    }
}

// Закрити робочу область
function closeWorkArea() {
    if (sortActionBlocked()) return;
    sortCheckGeneration++;
    document.getElementById('work-area').style.display = 'none';
    currentType = null;
    currentICCCode = null;
    currentICCData = null;
    currentPalletNumber = null;
    pendingCartonsCount = null;
    scannedData = null;
    loadStats();
}

// Скинути робочу область
function resetWorkArea() {
    sortCheckGeneration++;
    // Сховати обидві секції
    document.getElementById('single-input-section').style.display = 'none';
    document.getElementById('mix-input-section').style.display = 'none';

    // Очистити поля Single
    document.getElementById('icc-code-input').value = '';
    document.getElementById('cartons-count-input').value = '';
    document.getElementById('location-code-input').value = '';

    // Очистити поля MIX
    document.getElementById('mix-icc-code-input').value = '';
    window.refreshPresortMatches?.();

    // Скинути змінні
    currentICCCode = null;
    currentICCData = null;
    currentPalletNumber = null;
    pendingCartonsCount = null;
    scannedData = null;
}

// Функція для відправки даних після натискання "Продовжити"
async function submitSingleData() {
    if (sortActionBlocked()) return;
    const iccCode = document.getElementById('icc-code-input').value.trim();
    const totalCartons = parseInt(document.getElementById('cartons-count-input').value);
    const locationCode = document.getElementById('location-code-input').value.trim().toUpperCase();

    // Валідація
    if (!/^\d{4}$/.test(iccCode)) {
        showToast('Введіть 4 цифри коду!', 'error');
        focusWorkInput(document.getElementById('icc-code-input'));
        return;
    }

    if (!Number.isInteger(Number(document.getElementById('cartons-count-input').value)) || !totalCartons || totalCartons < 1) {
        showToast('Введіть загальну кількість (PACK)!', 'error');
        focusWorkInput(document.getElementById('cartons-count-input'));
        return;
    }

    if (!/^[A-Z]{2}-[A-Z]$/.test(locationCode)) {
        showToast('Введіть кодові букви (наприклад: IZ-A)!', 'error');
        focusWorkInput(document.getElementById('location-code-input'));
        return;
    }

    // Зберігаємо дані для підтвердження
    scannedData = {
        iccCode: iccCode,
        totalCartons: totalCartons,
        locationCode: locationCode
    };
    const checkGeneration = ++sortCheckGeneration;
    const checkedSortId = currentSort?.id;
    const checkedType = currentType;

    // Перевіряємо чи існує ICC код з такими ж параметрами
    try {
        const checkResponse = await fetch('/api/sort/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sort_id: currentSort?.id,
                icc_code: iccCode,
                type: currentType,
                total_cartons: totalCartons,
                location_code: locationCode
            })
        });

        const checkData = await checkResponse.json();
        if (checkGeneration !== sortCheckGeneration || checkedSortId !== currentSort?.id || checkedType !== currentType) return;
        if (!checkResponse.ok) { showToast(checkData.error || 'Не вдалося перевірити товар', 'error'); return; }

        // Якщо ICC завершений - питаємо чи це новий товар
        if (checkData.status === 'completed') {
            scannedData.existingData = checkData.icc_data;
            scannedData.existingPallet = checkData.open_pallet?.pallet_number || null;
            scannedData.existingPalletId = checkData.open_pallet?.id || null;
            showNewItemModal();
            return;
        }

        // Якщо існує товар з такими ж параметрами - показуємо відкриту палету
        if (checkData.status === 'exists') {
            scannedData.existingData = checkData.icc_data;
            scannedData.isExisting = true;
            if (checkData.open_pallet) {
                scannedData.existingPallet = checkData.open_pallet.pallet_number;
                scannedData.existingPalletId = checkData.open_pallet.id;
            }
        } else {
            scannedData.isExisting = false;
        }

        // Показуємо вікно підтвердження
        showConfirmationModal();

    } catch (error) {
        if (checkGeneration !== sortCheckGeneration) return;
        console.error('Помилка перевірки ICC:', error);
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}

// Показати вікно "Це новий товар?"
function showNewItemModal() {
    const previous = document.getElementById('completed-pallet-row');
    if (previous) previous.hidden = !scannedData?.existingPalletId;
    const label = document.getElementById('completed-pallet-number');
    if (label) label.textContent = scannedData?.existingPallet || '';
    document.getElementById('new-item-modal').style.display = 'flex';
}

async function closeCompletedPallet() {
    if (sortActionBlocked() || !scannedData?.existingPalletId) return;
    const completed = scannedData;
    const button = document.getElementById('close-completed-pallet');
    if (button) button.disabled = true;
    try {
        const response = await fetch('/api/sort/pallet/close', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({sort_id:currentSort?.id,icc_id:completed.existingData?.id,pallet_id:completed.existingPalletId})
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не вдалося закрити палету');
        completed.existingPalletId = null; completed.existingPallet = null;
        if (scannedData === completed) document.getElementById('completed-pallet-row').hidden = true;
        showToast('Попередню палету закрито. Дані збережені.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { if (button) button.disabled = false; }
}

// Скасувати (не новий товар)
function cancelNewItem() {
    document.getElementById('new-item-modal').style.display = 'none';
    // Повернутись до початку
    resetWorkArea();
    document.getElementById('single-input-section').style.display = 'block';
    focusWorkInput(document.getElementById('icc-code-input'));
}

// Підтвердити новий товар
function confirmNewItem() {
    document.getElementById('new-item-modal').style.display = 'none';
    scannedData.isNewItem = true;
    scannedData.isExisting = false;
    scannedData.existingPallet = null;
    scannedData.existingPalletId = null;
    // Показати вікно підтвердження
    showConfirmationModal();
}

// Показати вікно підтвердження (друге вікно - кількість)
function showConfirmationModal() {
    window.showPresortStepMatches?.(scannedData, currentType);
    const modal = document.getElementById('confirmation-modal');
    const quantityInput = document.getElementById('current-quantity-input');
    const progressInfo = document.getElementById('progress-info-modal2');
    const progressCurrent = document.getElementById('progress-current-modal2');
    const progressTotal = document.getElementById('progress-total-modal2');
    const progressFill = document.getElementById('progress-fill-modal2');

    // Очистити поле
    quantityInput.value = '';

    // Для MIX показати код у заголовку модального вікна
    const modalTitle = modal.querySelector('h2');
    if (currentType === 'mix' && scannedData && scannedData.iccCode) {
        modalTitle.textContent = `Код: ${scannedData.iccCode}`;
    } else {
        modalTitle.textContent = 'Скільки картонів додаємо зараз?';
    }

    // Якщо товар вже існує - показати прогрес
    if (scannedData.isExisting && scannedData.existingData) {
        const current = scannedData.existingData.current_cartons || 0;
        const total = scannedData.existingData.total_cartons || 0;

        progressCurrent.textContent = current;
        progressTotal.textContent = total > 0 ? total : '∞';

        if (total > 0) {
            const percentage = (current / total) * 100;
            progressFill.style.width = percentage + '%';
        } else {
            progressFill.style.width = '50%';
        }

        progressInfo.style.display = 'block';
    } else {
        progressInfo.style.display = 'none';
    }

    modal.style.display = 'flex';
    focusWorkInput(quantityInput);
}

// Перейти до третього вікна (локація)
function proceedToLocation() {
    const currentQuantity = Number(document.getElementById('current-quantity-input').value);

    // Валідація
    if (!Number.isInteger(currentQuantity) || currentQuantity < 1) {
        showToast('Введіть додатну цілу кількість картонів!', 'error');
        focusWorkInput(document.getElementById('current-quantity-input'));
        return;
    }

    // Зберегти кількість
    scannedData.currentQuantity = currentQuantity;

    // Закрити друге вікно, відкрити третє
    document.getElementById('confirmation-modal').style.display = 'none';
    showLocationModal();
}

// Показати третє вікно (локація)
function showLocationModal() {
    window.showPresortStepMatches?.(scannedData, currentType);
    const modal = document.getElementById('location-modal');
    const locationInput = document.getElementById('pallet-location-input');
    const existingPalletInfo = document.getElementById('existing-pallet-info');
    const existingPalletDisplay = document.getElementById('existing-pallet-display');
    const progressInfo = document.getElementById('progress-info-modal3');
    const progressCurrent = document.getElementById('progress-current-modal3');
    const progressTotal = document.getElementById('progress-total-modal3');
    const progressFill = document.getElementById('progress-fill-modal3');

    // Завжди очищаємо поле для вводу
    locationInput.value = '';
    locationInput.placeholder = 'Введіть або відскануйте';
    locationInput.style.background = '';

    // Якщо товар вже існує - показуємо інфо про палету та прогрес
    if (scannedData.isExisting && scannedData.existingPallet) {
        existingPalletDisplay.textContent = scannedData.existingPallet;
        existingPalletInfo.style.display = 'block';
    } else {
        existingPalletInfo.style.display = 'none';
    }

    // Показати прогрес якщо товар існує
    if (scannedData.isExisting && scannedData.existingData) {
        const current = scannedData.existingData.current_cartons || 0;
        const total = scannedData.existingData.total_cartons || 0;

        progressCurrent.textContent = current;
        progressTotal.textContent = total;

        if (total > 0) {
            const percentage = (current / total) * 100;
            progressFill.style.width = percentage + '%';
        } else {
            progressFill.style.width = '0%';
        }

        progressInfo.style.display = 'block';
    } else {
        progressInfo.style.display = 'none';
    }

    modal.style.display = 'flex';
    focusWorkInput(locationInput);
}

// Повернутись до другого вікна (кількість)
function backToQuantity() {
    document.getElementById('location-modal').style.display = 'none';
    document.getElementById('confirmation-modal').style.display = 'flex';
    focusWorkInput(document.getElementById('current-quantity-input'));
}

// Закрити поточну палету як повну і ввести нову
async function closePalletAndNew() {
    if (sortActionBlocked()) return;
    try {
        const res = await fetch('/api/sort/pallet/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_id: currentSort?.id, icc_id: scannedData.existingData?.id, pallet_id: scannedData.existingPalletId })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Помилка закриття палети', 'error');
            return;
        }
        // Скинути прив'язку до старої палети
        scannedData.existingPallet = null;
        scannedData.existingPalletId = null;
        scannedData.isExisting = false;

        document.getElementById('existing-pallet-info').style.display = 'none';
        document.getElementById('progress-info-modal3').style.display = 'none';
        document.getElementById('pallet-location-input').value = '';
        document.getElementById('pallet-location-input').placeholder = 'Введіть нову палету';
        focusWorkInput(document.getElementById('pallet-location-input'));
        showToast(`Палету закрито. Введіть нову локацію.`, 'success', 2500);
    } catch (e) {
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}

// Закрити вікно підтвердження
function cancelConfirmation() {
    if (sortActionBlocked()) return;
    document.getElementById('confirmation-modal').style.display = 'none';
    document.getElementById('location-modal').style.display = 'none';
    resetWorkArea();
    if (currentType === 'mix') {
        document.getElementById('mix-input-section').style.display = 'block';
        focusWorkInput(document.getElementById('mix-icc-code-input'));
    } else {
        document.getElementById('single-input-section').style.display = 'block';
        focusWorkInput(document.getElementById('icc-code-input'));
    }
}

// Підтвердити та відправити на сервер
async function confirmAndSubmit() {
    if (sortSaveInFlight) return;
    if (pendingSortSave) return retryPendingSortSave();
    if (!scannedData || !currentSort) { showToast('Спочатку оберіть сорт і введіть наклейку.', 'warning'); return; }
    const currentQuantity = Number(scannedData.currentQuantity);
    const palletLocation = document.getElementById('pallet-location-input').value.trim().toUpperCase();
    if (!palletLocation || !Number.isInteger(currentQuantity) || currentQuantity < 1) {
        showToast('Вкажіть номер палети та додатну цілу кількість картонів.', 'error'); return;
    }
    if (scannedData.isExisting && scannedData.existingPallet && palletLocation !== scannedData.existingPallet) {
        showToast(`Очікується палета ${scannedData.existingPallet}. Підтвердіть її або закрийте повну палету.`, 'error', 4500); return;
    }
    pendingSortSave = Object.freeze({
        sort_id: currentSort.id, type: currentType, icc_code: scannedData.iccCode,
        total_cartons: currentType === 'mix' ? 0 : scannedData.totalCartons,
        location_code: currentType === 'mix' ? null : scannedData.locationCode,
        cartons_count: currentQuantity, pallet_number: palletLocation,
        force_new: !!scannedData.isNewItem, request_id: crypto.randomUUID()
    });
    try { sessionStorage.setItem(sortPendingKey, JSON.stringify(pendingSortSave)); }
    catch (_) {
        pendingSortSave = null;
        showToast('Браузер не дозволив зберегти операцію для безпечного повторення. Дозвольте зберігання даних сайту.', 'error', 4500);
        return;
    }
    return retryPendingSortSave();
}

async function retryPendingSortSave() {
    if (!pendingSortSave || sortSaveInFlight) return;
    const payload = pendingSortSave;
    sortSaveInFlight = true; syncSortSaveControls();
    try {
        const response = await fetch('/api/sort/submit', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            if (response.status === 400 || response.status === 409) {
                clearPendingSortSave();
            }
            throw new Error(response.status === 401 ? 'Сесія завершилась. Увійдіть у той самий акаунт і повторіть збереження.' : result.error || 'Не вдалося підтвердити збереження. Повторіть цю операцію.');
        }
        clearPendingSortSave();
        document.getElementById('confirmation-modal').style.display = 'none';
        document.getElementById('location-modal').style.display = 'none';
        if (currentSort?.id === payload.sort_id) {
            currentType = payload.type;
            window.rememberPresortMatch?.({iccCode: payload.icc_code, locationCode: payload.location_code, totalCartons: payload.total_cartons}, payload.type);
            resetWorkArea();
            document.getElementById(payload.type === 'mix' ? 'mix-input-section' : 'single-input-section').style.display = 'block';
            focusWorkInput(document.getElementById(payload.type === 'mix' ? 'mix-icc-code-input' : 'icc-code-input'));
        }
        const progress = result.total_cartons ? `\nПрогрес: ${result.current_cartons}/${result.total_cartons}` : '';
        showToast(`✓ Додано ${payload.cartons_count} картонів на палету ${payload.pallet_number}${progress}${result.is_completed ? '\nЗбір цього товару завершено.' : ''}`, 'success', 4000);
    } catch (failure) {
        showToast(failure.message || 'Збереження не підтверджене. Повторіть цю операцію.', 'error', 5000);
    } finally {
        sortSaveInFlight = false; syncSortSaveControls();
    }
}

// Автоматична перевірка ICC коду після введення/сканування
document.addEventListener('DOMContentLoaded', () => {
    const iccInput = document.getElementById('icc-code-input');
    if (iccInput) {
        iccInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                // Перехід до наступного поля
                focusWorkInput(document.getElementById('cartons-count-input'));
            }
        });
    }

    const cartonsInput = document.getElementById('cartons-count-input');
    if (cartonsInput) {
        cartonsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                focusWorkInput(document.getElementById('location-code-input'));
            }
        });
    }

    const locationInput = document.getElementById('location-code-input');
    if (locationInput) {
        locationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitSingleData();
            }
        });
    }

    const mixIccInput = document.getElementById('mix-icc-code-input');
    if (mixIccInput) {
        mixIccInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitMixData();
            }
        });
    }

    const currentQuantityInput = document.getElementById('current-quantity-input');
    if (currentQuantityInput) {
        currentQuantityInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                proceedToLocation();
            }
        });
    }

    const palletLocationInput = document.getElementById('pallet-location-input');
    if (palletLocationInput) {
        palletLocationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmAndSubmit();
            }
        });
    }
});

// Перевірити ICC код
async function checkICCCode() {
    const iccCode = document.getElementById('icc-code-input').value.trim();

    if (!iccCode) {
        return;
    }

    try {
        const response = await fetch('/api/icc/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ icc_code: iccCode, type: currentType })
        });

        const data = await response.json();

        if (data.status === 'completed') {
            alert(data.message);
            // Очистити поле для нового сканування
            document.getElementById('icc-code-input').value = '';
            focusWorkInput(document.getElementById('icc-code-input'));
            return;
        }

        if (data.status === 'new') {
            // Новий ICC код
            currentICCCode = iccCode;
            showNewICCForm();
        } else {
            // Існуючий ICC код
            currentICCCode = iccCode;
            currentICCData = data.icc_data;
            showExistingICCForm(data);
        }
    } catch (error) {
        alert('Помилка перевірки ICC коду');
    }
}

// Показати форму нового ICC
function showNewICCForm() {
    document.getElementById('icc-input-section').style.display = 'none';
    document.getElementById('new-icc-section').style.display = 'block';

    // Для Mix не потрібна загальна кількість
    if (currentType === 'mix') {
        document.getElementById('total-cartons-group').style.display = 'none';
        // Одразу створити ICC для Mix
        createNewICC();
    } else {
        document.getElementById('total-cartons-group').style.display = 'block';
        // Автофокус на поле кількості
        setTimeout(() => {
            focusWorkInput(document.getElementById('total-cartons-input'));
        }, 100);
    }
}

// Створити новий ICC
async function createNewICC() {
    let totalCartons = 0;

    if (currentType !== 'mix') {
        totalCartons = parseInt(document.getElementById('total-cartons-input').value);
        if (!totalCartons || totalCartons < 1) {
            return;
        }
    }

    try {
        const response = await fetch('/api/icc/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                icc_code: currentICCCode,
                type: currentType,
                total_cartons: totalCartons
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Очистити поле
            document.getElementById('total-cartons-input').value = '';
            // Перезавантажити як існуючий
            checkICCCode();
        } else {
            alert(data.error || 'Помилка створення ICC коду');
        }
    } catch (error) {
        alert('Помилка створення ICC коду');
    }
}

// Показати форму існуючого ICC
function showExistingICCForm(data) {
    document.getElementById('icc-input-section').style.display = 'none';
    document.getElementById('existing-icc-section').style.display = 'block';

    document.getElementById('display-icc-code').textContent = currentICCCode;
    updateProgress(data.icc_data);

    // Зберегти номер палети для відображення
    if (data.open_pallet) {
        currentPalletNumber = data.open_pallet.pallet_number;
        document.getElementById('pallet-location-display').textContent = currentPalletNumber;
        document.getElementById('pallet-location-info').style.display = 'block';
    } else {
        currentPalletNumber = null;
        document.getElementById('pallet-location-info').style.display = 'none';
    }

    // Показати поле для введення КІЛЬКОСТІ (спочатку)
    document.getElementById('cartons-input-group').style.display = 'block';
    document.getElementById('location-input-group').style.display = 'none';
    document.getElementById('pallet-confirm-group').style.display = 'none';

    // Автофокус на поле кількості картонів
    setTimeout(() => {
        focusWorkInput(document.getElementById('current-cartons-input'));
    }, 100);
}

// Оновити прогрес
function updateProgress(iccData) {
    const current = iccData.current_cartons;
    const total = iccData.total_cartons;

    document.getElementById('current-cartons').textContent = current;

    if (currentType === 'mix') {
        document.getElementById('total-cartons').textContent = '∞';
        document.getElementById('progress-fill').style.width = '50%';
    } else {
        document.getElementById('total-cartons').textContent = total;
        const percentage = (current / total) * 100;
        document.getElementById('progress-fill').style.width = percentage + '%';
    }

    // Показати значок завершення
    if (iccData.is_completed) {
        document.getElementById('completion-badge').style.display = 'flex';
    } else {
        document.getElementById('completion-badge').style.display = 'none';
    }
}

// Після введення кількості - перейти до введення номера локації
function proceedToLocationInput() {
    const cartonsCount = parseInt(document.getElementById('current-cartons-input').value);

    if (!cartonsCount || cartonsCount < 1) {
        return;
    }

    // Зберегти кількість картонів
    pendingCartonsCount = cartonsCount;

    // Сховати поле кількості, показати поле для номера локації
    document.getElementById('cartons-input-group').style.display = 'none';

    // Якщо вже є відкрита палета - показати підтвердження
    if (currentPalletNumber) {
        showConfirmLocation();
    } else {
        // Якщо немає палети - запитати нову
        document.getElementById('location-input-group').style.display = 'block';
        setTimeout(() => {
            focusWorkInput(document.getElementById('new-pallet-number-input'));
        }, 100);
    }
}

// Показати підтвердження локації
function showConfirmLocation() {
    document.getElementById('pallet-confirm-group').style.display = 'block';
    document.getElementById('pallet-confirm-display').textContent = currentPalletNumber;

    // Автофокус на поле підтвердження
    setTimeout(() => {
        focusWorkInput(document.getElementById('pallet-confirm-input'));
    }, 100);
}

// Обробка введення номера нової палети
function processNewPalletNumber() {
    const newPalletNumber = document.getElementById('new-pallet-number-input').value.trim();

    if (!newPalletNumber) {
        return;
    }

    // Зберегти як поточний номер палети
    currentPalletNumber = newPalletNumber;

    // Показати підтвердження
    document.getElementById('location-input-group').style.display = 'none';
    showConfirmLocation();
}

// Додати картони після підтвердження локації
async function addCartonsWithConfirmation() {
    const confirmedPallet = document.getElementById('pallet-confirm-input').value.trim();

    if (!confirmedPallet) {
        return;
    }

    if (confirmedPallet !== currentPalletNumber) {
        alert(`ПОМИЛКА! Палета не співпадає!\nОчікується: ${currentPalletNumber}\nВведено: ${confirmedPallet}`);
        document.getElementById('pallet-confirm-input').value = '';
        focusWorkInput(document.getElementById('pallet-confirm-input'));
        return;
    }

    // Підтвердження пройшло, додаємо картони
    try {
        const response = await fetch('/api/pallet/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                icc_code: currentICCCode,
                cartons_count: pendingCartonsCount,
                pallet_number: currentPalletNumber
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Показати успіх
            showSuccessAndReset();

            // Оновити прогрес в фоні
            currentICCData.current_cartons = data.current_cartons;
            currentICCData.total_cartons = data.total_cartons;
            currentICCData.is_completed = data.is_completed;
        } else {
            alert(data.error || 'Помилка додавання картонів');
            // Повернутись до введення
            backToCartonsInput();
        }
    } catch (error) {
        alert('Помилка додавання картонів');
        backToCartonsInput();
    }
}

// Показати успіх і скинути до початку
function showSuccessAndReset() {
    // Показати повідомлення успіху
    const successMsg = document.createElement('div');
    successMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #28a745; color: white; padding: 2rem 3rem; border-radius: 12px; font-size: 1.5rem; font-weight: bold; z-index: 10000; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
    successMsg.textContent = '✓ УСПІШНО ДОДАНО';
    document.body.appendChild(successMsg);

    setTimeout(() => {
        successMsg.remove();
        // Повернутись на початок - поле ICC коду
        resetWorkArea();
        document.getElementById('work-area').style.display = 'block';
        document.getElementById('icc-input-section').style.display = 'block';
        setTimeout(() => {
            focusWorkInput(document.getElementById('icc-code-input'));
        }, 100);
    }, 1000);
}

// Повернутись до введення кількості
function backToCartonsInput() {
    document.getElementById('pallet-confirm-group').style.display = 'none';
    document.getElementById('location-input-group').style.display = 'none';
    document.getElementById('cartons-input-group').style.display = 'block';
    document.getElementById('pallet-confirm-input').value = '';
    document.getElementById('new-pallet-number-input').value = '';
    pendingCartonsCount = null;
    setTimeout(() => {
        focusWorkInput(document.getElementById('current-cartons-input'));
    }, 100);
}

// Обробка Enter для полів введення
document.addEventListener('DOMContentLoaded', () => {
    // Поле кількості картонів
    const currentCartonsInput = document.getElementById('current-cartons-input');
    if (currentCartonsInput) {
        currentCartonsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                proceedToLocationInput();
            }
        });
    }

    // Поле номера нової палети
    const newPalletInput = document.getElementById('new-pallet-number-input');
    if (newPalletInput) {
        newPalletInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                processNewPalletNumber();
            }
        });
    }

    // Поле підтвердження палети
    const palletConfirmInput = document.getElementById('pallet-confirm-input');
    if (palletConfirmInput) {
        palletConfirmInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCartonsWithConfirmation();
            }
        });
    }

    // Поле загальної кількості
    const totalCartonsInput = document.getElementById('total-cartons-input');
    if (totalCartonsInput) {
        totalCartonsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                createNewICC();
            }
        });
    }
});

// Завантажити тільки статистику при завантаженні сторінки
loadStats();

// ============================================
// CAMERA SCANNER FUNCTIONALITY
// ============================================

let cameraStream = null;
let cameraGeneration = 0;
let flashEnabled = false;

// Перемкнути спалах
async function toggleFlash() {
    if (!cameraStream) {
        return;
    }

    try {
        const videoTrack = cameraStream.getVideoTracks()[0];
        const capabilities = videoTrack.getCapabilities();

        if (!capabilities.torch) {
            alert('Спалах не підтримується вашим пристроєм');
            return;
        }

        flashEnabled = !flashEnabled;
        await videoTrack.applyConstraints({
            advanced: [{ torch: flashEnabled }]
        });

        const flashBtn = document.getElementById('flash-toggle-btn');
        if (flashEnabled) {
            flashBtn.textContent = '🔆 Спалах ВКЛ';
            flashBtn.style.background = '#ffc107';
            flashBtn.style.color = '#333';
        } else {
            flashBtn.textContent = '🔆 Спалах';
            flashBtn.style.background = '';
            flashBtn.style.color = '';
        }

        console.log('Спalax:', flashEnabled ? 'увімкнено' : 'вимкнено');
    } catch (error) {
        console.error('Помилка перемикання спалаху:', error);
        alert('Помилка перемикання спалаху');
    }
}

// Відкрити модальне вікно камери
async function openCameraScanner() {
    if (sortActionBlocked()) return;
    // Показати тільки для режиму Single
    if (!['single','vevor'].includes(currentType)) {
        showToast('Оберіть Single або Vevor для цієї форми наклейки.', 'warning');
        return;
    }

    const generation = ++cameraGeneration;
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');

    modal.style.display = 'flex';
    statusDiv.textContent = 'Завантаження камери...';
    statusDiv.className = 'scan-status scanning';

    try {
        // Запитати доступ до камери
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // Задня камера на телефоні
                width: { ideal: 1920 },
                height: { ideal: 1440 },
                aspectRatio: { ideal: 4/3 }
            }
        });

        if (generation !== cameraGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
        cameraStream = stream;
        video.srcObject = cameraStream;

        // Скинути стан кнопки спалаху
        flashEnabled = false;
        const flashBtn = document.getElementById('flash-toggle-btn');
        if (flashBtn) {
            flashBtn.textContent = '🔆 Спалах';
            flashBtn.style.background = '';
            flashBtn.style.color = '';
        }

        statusDiv.textContent = 'Камера готова. Наведіть на наклейку і натисніть кнопку фото.';
        statusDiv.className = 'scan-status';

    } catch (error) {
        if (generation !== cameraGeneration) return;
        console.error('Помилка доступу до камери:', error);
        statusDiv.textContent = 'Помилка доступу до камери. Дозвольте доступ у налаштуваннях браузера.';
        statusDiv.className = 'scan-status error';
    }
}

// Закрити камеру
async function closeCameraScanner() {
    cameraGeneration++;
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');
    const resultDiv = document.getElementById('scan-result');
    const flashBtn = document.getElementById('flash-toggle-btn');

    // Stopping tracks also releases the torch; no delayed stream may reopen this view.
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;

    // Скинути стан кнопки спалаху
    flashEnabled = false;
    if (flashBtn) {
        flashBtn.textContent = '🔆 Спалах';
        flashBtn.style.background = '';
        flashBtn.style.color = '';
    }

    video.srcObject = null;
    modal.style.display = 'none';
    statusDiv.textContent = '';
    statusDiv.className = 'scan-status';
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
}

// Зробити фото і розпізнати текст через сервер (EasyOCR)
async function capturePhoto() {
    const generation = cameraGeneration;
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const statusDiv = document.getElementById('scan-status');
    const resultDiv = document.getElementById('scan-result');

    // Встановити розмір canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Намалювати кадр з відео на canvas
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Показати статус
    statusDiv.textContent = '📤 Відправка на сервер...';
    statusDiv.className = 'scan-status scanning';
    resultDiv.style.display = 'none';

    ocrFocusDepth++;
    document.activeElement?.blur?.();
    try {
        // Конвертувати canvas в blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));

        // Створити FormData
        const formData = new FormData();
        formData.append('image', blob, 'scan.jpg');
        formData.append('type', currentType); // single, mix, або vevor

        // Відправити на сервер
        statusDiv.textContent = '🔍 Розпізнавання...';

        const response = await fetch('/api/ocr/recognize', {
            method: 'POST',
            body: formData
        });

        const extractedData = await response.json();
        if (generation !== cameraGeneration) return;

        if (!response.ok) {
            statusDiv.textContent = extractedData.error || 'Помилка розпізнавання. Спробуйте ще раз.';
            statusDiv.className = 'scan-status error';
            return;
        }
        // Guided collection consumes a complete scan directly. Closing the
        // camera invalidates other responses from this capture session.
        if (await window.confirmCollectionScan?.(extractedData, currentType)) return;

        console.log('Розпізнані дані з сервера:', extractedData);

        // Для MIX потрібен тільки ICC код
        if (currentType === 'mix') {
            if (extractedData.cell) {
                document.getElementById('mix-icc-code-input').value = extractedData.cell;
                window.refreshPresortMatches?.();
                await closeCameraScanner();
                await submitMixData();
            } else {
                statusDiv.textContent = '⚠️ ' + (extractedData.error || 'MIX код не розпізнано. Спробуйте ще раз.');
                statusDiv.className = 'scan-status error';
            }
        } else {
            // Для Single - перевірити всі поля
            if (extractedData.cell && extractedData.qtyPack && extractedData.prefix && extractedData.zone) {
                await fillICCFromScan(extractedData);

            } else {
                const missing = [];
                if (!extractedData.cell) missing.push('комірку (4 цифри)');
                if (!extractedData.qtyPack) missing.push('кількість PACK');
                if (!extractedData.prefix || !extractedData.zone) missing.push('кодові букви');

                statusDiv.textContent = `⚠️ Не розпізнано: ${missing.join(', ')}`;
                statusDiv.className = 'scan-status error';

                if (extractedData.cell || extractedData.qtyPack || (extractedData.prefix && extractedData.zone)) {
                    displayScanResults(extractedData);
                }
            }
        }

    } catch (error) {
        console.error('Помилка розпізнавання:', error);
        statusDiv.textContent = '❌ Помилка розпізнавання. Спробуйте ще раз.';
        statusDiv.className = 'scan-status error';
    } finally {
        ocrFocusDepth--;
    }
}

// Клонувати canvas для окремої обробки
function cloneCanvas(originalCanvas) {
    const clonedCanvas = document.createElement('canvas');
    clonedCanvas.width = originalCanvas.width;
    clonedCanvas.height = originalCanvas.height;
    const ctx = clonedCanvas.getContext('2d');
    ctx.drawImage(originalCanvas, 0, 0);
    return clonedCanvas;
}

// Метод 1: Високий контраст + чорно-біле
function enhanceImageHighContrast(ctx, canvas) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = ((gray - 128) * 2) + 128; // Дуже високий контраст
        gray = gray > 130 ? 255 : 0;

        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
}

// Метод 2: Середній контраст + адаптивний поріг
function enhanceImageMediumContrast(ctx, canvas) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = ((gray - 128) * 1.5) + 128;
        gray = gray > 140 ? 255 : 0;

        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
}

// Метод 3: Легке покращення
function enhanceImageLight(ctx, canvas) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = ((gray - 128) * 1.2) + 128;
        gray = gray > 150 ? 255 : 0;

        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
}

// Вибрати найкращий результат з кількох спроб
function chooseBestResult(allData) {
    // Оцінити кожен результат
    const scored = allData.map(data => {
        let score = 0;

        // Бали за наявність полів
        if (data.cell) score += 30;
        if (data.qtyPack) score += 30;
        if (data.prefix && data.zone) score += 30;

        // Бали за confidence
        score += (data.confidence || 0) * 0.1;

        return { data, score };
    });

    // Відсортувати за score
    scored.sort((a, b) => b.score - a.score);

    console.log('Оцінки результатів:', scored.map(s => ({ method: s.data.method, score: s.score })));

    // Повернути найкращий
    return scored[0].data;
}

// Автокорекція типових помилок OCR
function autoCorrectData(data) {
    const corrected = { ...data };

    // Корекція комірки (має бути 4 цифри)
    if (corrected.cell) {
        corrected.cell = corrected.cell
            .replace(/O/g, '0')
            .replace(/o/g, '0')
            .replace(/I/g, '1')
            .replace(/l/g, '1')
            .replace(/S/g, '5')
            .replace(/Z/g, '2')
            .replace(/B/g, '8');
    }

    // Корекція кількості PACK
    if (corrected.qtyPack) {
        const qtyStr = String(corrected.qtyPack)
            .replace(/O/g, '0')
            .replace(/o/g, '0')
            .replace(/I/g, '1')
            .replace(/l/g, '1');
        corrected.qtyPack = parseInt(qtyStr) || corrected.qtyPack;
    }

    // Корекція префіксу
    if (corrected.prefix) {
        corrected.prefix = corrected.prefix
            .replace(/0/g, 'O')  // 0 → O
            .replace(/1/g, 'I')  // 1 → I
            .replace(/5/g, 'S')  // 5 → S
            .replace(/8/g, 'B'); // 8 → B
    }

    // Корекція зони (має бути одна літера)
    if (corrected.zone) {
        corrected.zone = corrected.zone
            .replace(/0/g, 'O')
            .replace(/1/g, 'I')
            .replace(/5/g, 'S')
            .replace(/8/g, 'B')
            .charAt(0); // Тільки перша літера
    }

    return corrected;
}

// Витягти дані з розпізнаного тексту
function extractDataFromText(text) {
    const data = {
        sku: null,
        cell: null,           // Комірка (з чорного квадрата)
        zone: null,           // Буква зони (A, E тощо)
        prefix: null,         // Префікс (IZ-, BH-, EM-, KN- тощо)
        qtyPack: null,        // Кількість PACK (з верхньої строки)
        qtyPcs: null          // Кількість PCS (з нижньої строки)
    };

    // Очистити текст від зайвих символів, але зберегти структуру
    const cleanText = text.toUpperCase();

    console.log('Оригінальний текст:', text);
    console.log('Очищений текст:', cleanText);

    // Шукати SKU (формат: 6TL1657RD)
    const skuPattern = /\b(\d+[A-Z]+\d+[A-Z]*)\b/g;
    const skuMatches = cleanText.match(skuPattern);
    if (skuMatches) {
        data.sku = skuMatches.reduce((a, b) => a.length > b.length ? a : b);
    }

    // Шукати всі 4-значні числа
    const allFourDigits = cleanText.match(/\b\d{4}\b/g);
    if (allFourDigits && allFourDigits.length > 0) {
        // Перше 4-значне число зазвичай комірка
        data.cell = allFourDigits[0];
    }

    // Шукати PACK більш гнучко - може бути "15 PACK", "15PACK", "PACK 15"
    const packPatterns = [
        /(\d{1,3})\s*PACK/i,           // "15 PACK" або "15PACK"
        /PACK\s*(\d{1,3})/i,           // "PACK 15"
        /(\d{1,3})\s*P[A4]CK/i,        // Якщо A розпізнане як 4
    ];

    for (let pattern of packPatterns) {
        const match = cleanText.match(pattern);
        if (match && match[1]) {
            data.qtyPack = parseInt(match[1]);
            break;
        }
    }

    // Шукати PCS аналогічно
    const pcsPatterns = [
        /(\d{1,3})\s*PCS/i,
        /PCS\s*(\d{1,3})/i,
    ];

    for (let pattern of pcsPatterns) {
        const match = cleanText.match(pattern);
        if (match && match[1]) {
            data.qtyPcs = parseInt(match[1]);
            break;
        }
    }

    // Шукати префікс-зону більш гнучко
    // Варіанти: "IZ-A", "IZ- A", "IZ -A", "I Z-A", "BH-A", "EM-A", "KN-E"
    const zonePrefixPatterns = [
        /\b([A-Z]{2})\s*-\s*([A-Z])\b/,      // "IZ-A", "IZ- A", "IZ -A"
        /\b([A-Z])\s*([A-Z])\s*-\s*([A-Z])\b/, // "I Z-A" (розпізнано окремо)
        /([A-Z]{2})([A-Z])\b/,                 // "IZA" (без дефіса)
    ];

    for (let pattern of zonePrefixPatterns) {
        const match = cleanText.match(pattern);
        if (match) {
            if (match.length === 3) {
                // Звичайний формат "IZ-A"
                data.prefix = match[1] + '-';
                data.zone = match[2];
            } else if (match.length === 4) {
                // Роздільний формат "I Z-A"
                data.prefix = match[1] + match[2] + '-';
                data.zone = match[3];
            }
            break;
        }
    }

    // Якщо не знайшли prefix, але знайшли окрему літеру після чисел
    if (!data.prefix && !data.zone) {
        // Шукаємо просто букву після чисел
        const singleLetterPattern = /\b([A-Z])\b/g;
        const letters = cleanText.match(singleLetterPattern);
        if (letters && letters.length > 0) {
            // Беремо останню знайдену букву (зазвичай це зона)
            data.zone = letters[letters.length - 1];
        }
    }

    console.log('Розпізнані дані:', data);

    return data;
}

// Відобразити результати сканування
function displayScanResults(data) {
    const resultDiv = document.getElementById('scan-result');

    let html = '<h3>Розпізнані дані:</h3>';

    if (data.sku) {
        html += `<div class="result-item"><span>SKU код:</span><span>${data.sku}</span></div>`;
    }

    if (data.cell) {
        html += `<div class="result-item"><span>Комірка (код):</span><span>${data.cell}</span></div>`;
    }

    if (data.qtyPack) {
        html += `<div class="result-item"><span>Кількість (PACK):</span><span>${data.qtyPack}</span></div>`;
    }

    if (data.prefix && data.zone) {
        const location = data.prefix + data.zone;
        html += `<div class="result-item"><span>Кодові букви:</span><span>${location}</span></div>`;
    }

    resultDiv.innerHTML = html;
    resultDiv.style.display = 'block';
}

// Заповнити всі поля з результатів сканування
async function fillICCFromScan(data) {
    // 1. Заповнити "Ведіть код" = Комірка з чорного квадрата (4 цифри)
    if (data.cell) {
        document.getElementById('icc-code-input').value = data.cell;
    }

    // 2. Заповнити "кількість" = PACK (верхня строка)
    if (data.qtyPack) {
        document.getElementById('cartons-count-input').value = data.qtyPack;
    }

    // 3. Заповнити "Кодові букви" = Префікс + Буква (наприклад: IZ-A, BH-A, EM-A)
    if (data.prefix && data.zone) {
        const locationCode = data.prefix + '-' + data.zone;
        document.getElementById('location-code-input').value = locationCode;
    }

    window.refreshPresortMatches?.();
    // Закрити камеру
    await closeCameraScanner();
    if (data.cell && data.qtyPack && data.prefix && data.zone) await submitSingleData();
}

// ============================================
// ФУНКЦІЇ ДЛЯ MIX
// ============================================

// Почати нову палету для MIX (без прив'язки до ICC — просто очищення поля)
function startNewMixPallet() {
    if (sortActionBlocked()) return;
    document.getElementById('mix-icc-code-input').value = '';
    focusWorkInput(document.getElementById('mix-icc-code-input'));
    showToast('Код очищено. Введіть або відскануйте наступну наклейку.', 'info', 2000);
}

// Відкрити камеру для сканування MIX наклейки
async function openCameraScannerMix() {
    if (sortActionBlocked()) return;
    if (currentType !== 'mix') {
        alert('Ця функція доступна тільки для режиму MIX');
        return;
    }

    const generation = ++cameraGeneration;
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');

    modal.style.display = 'flex';
    statusDiv.textContent = 'Завантаження камери...';
    statusDiv.className = 'scan-status scanning';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        if (generation !== cameraGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
        cameraStream = stream;
        video.srcObject = cameraStream;
        video.play();

        statusDiv.textContent = '📸 Наведіть на MIX наклейку';
        statusDiv.className = 'scan-status ready';

    } catch (error) {
        if (generation !== cameraGeneration) return;
        console.error('Помилка доступу до камери:', error);
        statusDiv.textContent = '❌ Помилка доступу до камери';
        statusDiv.className = 'scan-status error';
        setTimeout(() => { if (generation === cameraGeneration) closeCameraScanner(); }, 2000);
    }
}

// Зробити фото MIX наклейки
async function takePictureMix() {
    return capturePhoto();
}

// Відправити дані MIX картону
async function submitMixData() {
    if (sortActionBlocked()) return;
    const iccCode = document.getElementById('mix-icc-code-input').value.trim().toUpperCase();

    if (!iccCode) {
        showToast('⚠️ Введіть ICC код MIX!', 'error');
        focusWorkInput(document.getElementById('mix-icc-code-input'));
        return;
    }

    if (!/^[A-Z]\d{5,7}$/.test(iccCode)) {
        showToast('⚠️ Неправильний формат MIX коду!\nОчікується: літера + 5-7 цифр (наприклад: D980989)', 'error', 4000);
        focusWorkInput(document.getElementById('mix-icc-code-input'));
        return;
    }

    const checkGeneration = ++sortCheckGeneration;
    const checkedSortId = currentSort?.id;
    try {
        const checkResponse = await fetch('/api/sort/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_id: currentSort?.id, icc_code: iccCode, type: 'mix', total_cartons: 0, location_code: null })
        });

        const checkData = await checkResponse.json();
        if (checkGeneration !== sortCheckGeneration || checkedSortId !== currentSort?.id || currentType !== 'mix') return;

        if (!checkResponse.ok) {
            showToast(checkData.error || 'Помилка перевірки коду', 'error');
            return;
        }

        scannedData = {
            iccCode: iccCode,
            totalCartons: 0,
            locationCode: null,
            isMix: true
        };

        if (checkData.status === 'exists') {
            scannedData.existingData = checkData.icc_data;
            scannedData.isExisting = true;
            if (checkData.open_pallet) {
                scannedData.existingPallet = checkData.open_pallet.pallet_number;
                scannedData.existingPalletId = checkData.open_pallet.id;
            }
        } else {
            scannedData.isExisting = false;
        }

        showConfirmationModal();

    } catch (error) {
        if (checkGeneration !== sortCheckGeneration) return;
        console.error('Помилка перевірки MIX ICC:', error);
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    syncSortSaveControls();
    await loadCurrentSort();
    syncSortSaveControls();
});
