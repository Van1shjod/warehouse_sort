let currentType = null;
let currentICCCode = null;
let currentICCData = null;
let currentPalletNumber = null;
let pendingCartonsCount = null;
let scannedData = null; // Зберігаємо дані після сканування
let currentContainer = null; // Поточний обраний контейнер
let currentSort = null; // Поточний обраний сорт

// Функція для показу toast повідомлень (замість alert)
function showToast(message, type = 'info', duration = 2500) {
    const toast = document.getElementById('toast-message');

    // Очистити попередні класи
    toast.className = 'toast-message';

    // Додати тип (error, success, warning, info)
    toast.classList.add(type);
    toast.classList.add('show');

    // Встановити текст
    toast.innerHTML = message.replace(/\n/g, '<br>');

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

        document.getElementById('single-pallets').textContent = data.single_pallets;
        document.getElementById('mix-pallets').textContent = data.mix_pallets;
        document.getElementById('vevor-pallets').textContent = data.vevor_pallets;
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
                if (sort.status === 'active') {
                    currentSort = sort;
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

    sortName.textContent = sort.name;

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

    sortDetails.textContent = `${typeLabel} • Розвантаження: ${unloadDate}`;
    infoDiv.style.display = 'block';
}

// Сховати інформацію про сорт
function hideCurrentSortInfo() {
    document.getElementById('current-sort-info').style.display = 'none';
}

// Перевірити сорт і показати меню Sort
async function checkContainerAndShowSortMenu() {
    // Завжди показувати вибір сорту після натискання SORT
    await showSortSelection();
}

// Показати вибір сорту
async function showSortSelection() {
    try {
        const response = await fetch('/api/sorts');
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

            btn.innerHTML = `
                <div style="font-size: 1.3rem; font-weight: bold;">${sort.name}</div>
                <div style="font-size: 1rem; opacity: 0.9;">${typeLabel} • ${unloadDate}</div>
                ${sort.description ? `<div style="font-size: 0.9rem; opacity: 0.8;">${sort.description}</div>` : ''}
                ${progressText}
            `;
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
    try {
        const response = await fetch(`/api/sorts/${sortId}`);
        const data = await response.json();

        if (response.ok) {
            currentSort = data;
            localStorage.setItem('currentSortId', sortId);
            showCurrentSortInfo(data);
            document.getElementById('sort-selection').style.display = 'none';
            showToast('Сорт обрано: ' + data.name, 'success');

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
    if (confirm('Ви впевнені, що хочете змінити сорт? Поточна робота буде збережена.')) {
        localStorage.removeItem('currentSortId');
        currentSort = null;
        hideCurrentSortInfo();
        await showSortSelection();
    }
}

// Показати меню Sort
function showSortMenu() {
    document.getElementById('sort-menu').style.display = 'flex';
}

// Закрити меню Sort
function closeSortMenu() {
    document.getElementById('sort-menu').style.display = 'none';
}

// Вибрати тип
function selectType(type) {
    currentType = type;
    document.getElementById('current-type').textContent = type.toUpperCase();
    closeSortMenu();
    document.getElementById('work-area').style.display = 'block';
    resetWorkArea();

    // Показуємо відповідну секцію для кожного типу
    if (type === 'single') {
        document.getElementById('single-input-section').style.display = 'block';
        setTimeout(() => {
            document.getElementById('icc-code-input').focus();
        }, 100);
    } else if (type === 'mix') {
        document.getElementById('mix-input-section').style.display = 'block';
        setTimeout(() => {
            document.getElementById('mix-icc-code-input').focus();
        }, 100);
    }
}

// Закрити робочу область
function closeWorkArea() {
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
    // Сховати обидві секції
    document.getElementById('single-input-section').style.display = 'none';
    document.getElementById('mix-input-section').style.display = 'none';

    // Очистити поля Single
    document.getElementById('icc-code-input').value = '';
    document.getElementById('cartons-count-input').value = '';
    document.getElementById('location-code-input').value = '';

    // Очистити поля MIX
    document.getElementById('mix-icc-code-input').value = '';

    // Скинути змінні
    currentICCCode = null;
    currentICCData = null;
    currentPalletNumber = null;
    pendingCartonsCount = null;
    scannedData = null;
}

// Функція для відправки даних після натискання "Продовжити"
async function submitSingleData() {
    const iccCode = document.getElementById('icc-code-input').value.trim();
    const totalCartons = parseInt(document.getElementById('cartons-count-input').value);
    const locationCode = document.getElementById('location-code-input').value.trim().toUpperCase();

    // Валідація
    if (!iccCode || iccCode.length !== 4) {
        showToast('Введіть 4 цифри коду!', 'error');
        document.getElementById('icc-code-input').focus();
        return;
    }

    if (!totalCartons || totalCartons < 1) {
        showToast('Введіть загальну кількість (PACK)!', 'error');
        document.getElementById('cartons-count-input').focus();
        return;
    }

    if (!locationCode) {
        showToast('Введіть кодові букви (наприклад: IZ-A)!', 'error');
        document.getElementById('location-code-input').focus();
        return;
    }

    // Зберігаємо дані для підтвердження
    scannedData = {
        iccCode: iccCode,
        totalCartons: totalCartons,
        locationCode: locationCode
    };

    // Перевіряємо чи існує ICC код з такими ж параметрами
    try {
        const checkResponse = await fetch('/api/icc/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                icc_code: iccCode,
                type: currentType,
                total_cartons: totalCartons,
                location_code: locationCode
            })
        });

        const checkData = await checkResponse.json();

        // Якщо ICC завершений - питаємо чи це новий товар
        if (checkData.status === 'completed') {
            showNewItemModal();
            return;
        }

        // Якщо існує товар з такими ж параметрами - показуємо відкриту палету
        if (checkData.status === 'exists') {
            scannedData.existingData = checkData.icc_data;
            scannedData.isExisting = true;
            if (checkData.open_pallet) {
                scannedData.existingPallet = checkData.open_pallet.pallet_number;
            }
        } else {
            scannedData.isExisting = false;
        }

        // Показуємо вікно підтвердження
        showConfirmationModal();

    } catch (error) {
        console.error('Помилка перевірки ICC:', error);
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}

// Показати вікно "Це новий товар?"
function showNewItemModal() {
    document.getElementById('new-item-modal').style.display = 'flex';
}

// Скасувати (не новий товар)
function cancelNewItem() {
    document.getElementById('new-item-modal').style.display = 'none';
    // Повернутись до початку
    resetWorkArea();
    document.getElementById('single-input-section').style.display = 'block';
    document.getElementById('icc-code-input').focus();
}

// Підтвердити новий товар
function confirmNewItem() {
    document.getElementById('new-item-modal').style.display = 'none';
    scannedData.isNewItem = true;
    // Показати вікно підтвердження
    showConfirmationModal();
}

// Показати вікно підтвердження (друге вікно - кількість)
function showConfirmationModal() {
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
        modalTitle.textContent = 'Скільки є зараз?';
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
    setTimeout(() => quantityInput.focus(), 100);
}

// Перейти до третього вікна (локація)
function proceedToLocation() {
    const currentQuantity = parseInt(document.getElementById('current-quantity-input').value);

    // Валідація
    if (!currentQuantity || currentQuantity < 1) {
        showToast('Введіть скільки є зараз!', 'error');
        document.getElementById('current-quantity-input').focus();
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
    setTimeout(() => locationInput.focus(), 100);
}

// Повернутись до другого вікна (кількість)
function backToQuantity() {
    document.getElementById('location-modal').style.display = 'none';
    document.getElementById('confirmation-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('current-quantity-input').focus(), 100);
}

// Закрити поточну палету як повну і ввести нову
async function closePalletAndNew() {
    try {
        const res = await fetch('/api/pallet/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icc_code: scannedData.iccCode, type: currentType })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Помилка закриття палети', 'error');
            return;
        }
        // Скинути прив'язку до старої палети
        scannedData.existingPallet = null;
        scannedData.isExisting = false;

        document.getElementById('existing-pallet-info').style.display = 'none';
        document.getElementById('progress-info-modal3').style.display = 'none';
        document.getElementById('pallet-location-input').value = '';
        document.getElementById('pallet-location-input').placeholder = 'Введіть нову палету';
        document.getElementById('pallet-location-input').focus();
        showToast(`Палету закрито. Введіть нову локацію.`, 'success', 2500);
    } catch (e) {
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}

// Закрити вікно підтвердження
function cancelConfirmation() {
    document.getElementById('confirmation-modal').style.display = 'none';
    document.getElementById('location-modal').style.display = 'none';
    resetWorkArea();
    if (currentType === 'mix') {
        document.getElementById('mix-input-section').style.display = 'block';
        document.getElementById('mix-icc-code-input').focus();
    } else {
        document.getElementById('single-input-section').style.display = 'block';
        document.getElementById('icc-code-input').focus();
    }
}

// Підтвердити та відправити на сервер
async function confirmAndSubmit() {
    const currentQuantity = scannedData.currentQuantity; // Беремо збережену кількість з другого вікна
    let palletLocation = document.getElementById('pallet-location-input').value.trim().toUpperCase();

    // Валідація: поле не може бути пустим
    if (!palletLocation) {
        showToast('Введіть номер палети для підтвердження!', 'error');
        document.getElementById('pallet-location-input').focus();
        return;
    }

    // Якщо товар вже існує - ОБОВ'ЯЗКОВО перевірити чи локація співпадає
    if (scannedData.isExisting && scannedData.existingPallet) {
        if (palletLocation !== scannedData.existingPallet) {
            showToast(`❌ ПОМИЛКА! Локація не співпадає!<br><br>📍 Очікується: <strong>${scannedData.existingPallet}</strong><br>❌ Введено: <strong>${palletLocation}</strong><br><br>⚠️ Введіть правильний номер палети`, 'error', 5000);
            document.getElementById('pallet-location-input').value = '';
            document.getElementById('pallet-location-input').focus();
            return;
        }
    }

    try {
        // Якщо це новий товар або ICC ще не існує - створюємо
        if (scannedData.isNewItem || !scannedData.isExisting) {
            const createResponse = await fetch('/api/icc/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    icc_code: scannedData.iccCode,
                    type: currentType,
                    total_cartons: scannedData.totalCartons,
                    location_code: scannedData.locationCode,
                    force_new: scannedData.isNewItem || false
                })
            });

            if (!createResponse.ok) {
                const errorData = await createResponse.json();
                showToast(errorData.error || 'Помилка створення ICC коду', 'error');
                return;
            }
        }

        // Додаємо поточну кількість картонів на палету
        const addResponse = await fetch('/api/pallet/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                icc_code: scannedData.iccCode,
                cartons_count: currentQuantity,
                pallet_number: palletLocation,
                type: currentType
            })
        });

        const addData = await addResponse.json();

        if (addResponse.ok) {
            // Закрити модальні вікна
            document.getElementById('confirmation-modal').style.display = 'none';
            document.getElementById('location-modal').style.display = 'none';

            // Перевірити чи завершено збір
            if (addData.is_completed) {
                showToast(`🎉 Сортування завершено!<br><br>Зібрано: ${addData.current_cartons}/${addData.total_cartons} картонів`, 'success', 4000);
            } else {
                showToast(`✓ Додано ${currentQuantity} картонів на палету ${palletLocation}<br><br>Прогрес: ${addData.current_cartons}/${addData.total_cartons}`, 'success', 3000);
            }

            // Повернутись до початку для нового сканування
            resetWorkArea();
            if (currentType === 'mix') {
                document.getElementById('mix-input-section').style.display = 'block';
                document.getElementById('mix-icc-code-input').focus();
            } else {
                document.getElementById('single-input-section').style.display = 'block';
                document.getElementById('icc-code-input').value = '';
                document.getElementById('cartons-count-input').value = '';
                document.getElementById('location-code-input').value = '';
                document.getElementById('icc-code-input').focus();
            }
        } else {
            showToast(addData.error || 'Помилка додавання картонів', 'error');
        }

    } catch (error) {
        console.error('Помилка відправки даних:', error);
        showToast('Помилка з\'єднання з сервером', 'error');
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
                document.getElementById('cartons-count-input').focus();
            }
        });
    }

    const cartonsInput = document.getElementById('cartons-count-input');
    if (cartonsInput) {
        cartonsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('location-code-input').focus();
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
            document.getElementById('icc-code-input').focus();
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
            document.getElementById('total-cartons-input').focus();
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
        document.getElementById('current-cartons-input').focus();
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
            document.getElementById('new-pallet-number-input').focus();
        }, 100);
    }
}

// Показати підтвердження локації
function showConfirmLocation() {
    document.getElementById('pallet-confirm-group').style.display = 'block';
    document.getElementById('pallet-confirm-display').textContent = currentPalletNumber;

    // Автофокус на поле підтвердження
    setTimeout(() => {
        document.getElementById('pallet-confirm-input').focus();
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
        document.getElementById('pallet-confirm-input').focus();
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
            document.getElementById('icc-code-input').focus();
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
        document.getElementById('current-cartons-input').focus();
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
    // Показати тільки для режиму Single
    if (currentType !== 'single') {
        alert('Сканування камерою доступне тільки для режиму Single');
        return;
    }

    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');

    modal.style.display = 'flex';
    statusDiv.textContent = 'Завантаження камери...';
    statusDiv.className = 'scan-status scanning';

    try {
        // Запитати доступ до камери
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // Задня камера на телефоні
                width: { ideal: 1920 },
                height: { ideal: 1440 },
                aspectRatio: { ideal: 4/3 }
            }
        });

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
        console.error('Помилка доступу до камери:', error);
        statusDiv.textContent = 'Помилка доступу до камери. Дозвольте доступ у налаштуваннях браузера.';
        statusDiv.className = 'scan-status error';
    }
}

// Закрити камеру
async function closeCameraScanner() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');
    const resultDiv = document.getElementById('scan-result');
    const flashBtn = document.getElementById('flash-toggle-btn');

    // Вимкнути спалах перед закриттям
    if (cameraStream) {
        try {
            const videoTrack = cameraStream.getVideoTracks()[0];
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.torch) {
                await videoTrack.applyConstraints({
                    advanced: [{ torch: false }]
                });
                console.log('Спалах вимкнено');
            }
        } catch (flashError) {
            console.log('Помилка вимкнення спалаху:', flashError);
        }

        // Зупинити відеопотік
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

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

        console.log('Розпізнані дані з сервера:', extractedData);

        // Для MIX потрібен тільки ICC код
        if (currentType === 'mix') {
            if (extractedData.cell) {
                statusDiv.textContent = '✅ MIX код розпізнано!';
                statusDiv.className = 'scan-status success';

                // Показати toast замість alert
                showToast(`✅ Розпізнано: ${extractedData.cell}`, 'success', 2000);

                // Закрити камеру через 1 секунду
                setTimeout(() => {
                    closeCameraScanner();
                }, 1000);

                // Заповнити поле ICC коду
                document.getElementById('mix-icc-code-input').value = extractedData.cell;
            } else {
                statusDiv.textContent = '⚠️ ' + (extractedData.error || 'MIX код не розпізнано. Спробуйте ще раз.');
                statusDiv.className = 'scan-status error';
            }
        } else {
            // Для Single - перевірити всі поля
            if (extractedData.cell && extractedData.qtyPack && extractedData.prefix && extractedData.zone) {
                statusDiv.textContent = '✓ Всі дані розпізнано!';
                statusDiv.className = 'scan-status success';

                displayScanResults(extractedData);

                setTimeout(() => {
                    fillICCFromScan(extractedData);
                }, 1500);

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
function fillICCFromScan(data) {
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

    // Закрити камеру
    closeCameraScanner();

    // Показати повідомлення про успішне розпізнавання
    const successMsg = document.createElement('div');
    successMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #28a745; color: white; padding: 1.5rem 2rem; border-radius: 12px; font-size: 1.2rem; font-weight: bold; z-index: 10001; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
    successMsg.textContent = '✓ Дані розпізнано! Перевірте і натисніть "Продовжити"';
    document.body.appendChild(successMsg);

    setTimeout(() => {
        successMsg.remove();
    }, 2000);

    // Встановити фокус на кнопку "Продовжити"
    setTimeout(() => {
        const continueBtn = document.querySelector('.btn-large.btn-success');
        if (continueBtn) {
            continueBtn.focus();
        }
    }, 500);
}

// ============================================
// ФУНКЦІЇ ДЛЯ MIX
// ============================================

// Почати нову палету для MIX (без прив'язки до ICC — просто очищення поля)
function startNewMixPallet() {
    document.getElementById('mix-icc-code-input').value = '';
    document.getElementById('mix-icc-code-input').focus();
    showToast('Введіть перший ICC код нової палети', 'info', 2000);
}

// Відкрити камеру для сканування MIX наклейки
async function openCameraScannerMix() {
    if (currentType !== 'mix') {
        alert('Ця функція доступна тільки для режиму MIX');
        return;
    }

    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');

    modal.style.display = 'flex';
    statusDiv.textContent = 'Завантаження камери...';
    statusDiv.className = 'scan-status scanning';

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        video.srcObject = cameraStream;
        video.play();

        statusDiv.textContent = '📸 Наведіть на MIX наклейку';
        statusDiv.className = 'scan-status ready';

    } catch (error) {
        console.error('Помилка доступу до камери:', error);
        statusDiv.textContent = '❌ Помилка доступу до камери';
        statusDiv.className = 'scan-status error';
        setTimeout(() => closeCameraScanner(), 2000);
    }
}

// Зробити фото MIX наклейки
async function takePictureMix() {
    const video = document.getElementById('camera-video');
    const statusDiv = document.getElementById('scan-status');
    
    statusDiv.textContent = '📷 Обробка...';
    statusDiv.className = 'scan-status scanning';

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('image', blob, 'mix_scan.jpg');
        formData.append('type', 'mix');

        try {
            const response = await fetch('/api/scan_carton', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok && result.cell) {
                statusDiv.textContent = '✅ Розпізнано!';
                statusDiv.className = 'scan-status success';

                closeCameraScanner();

                // Заповнити поле ICC коду
                document.getElementById('mix-icc-code-input').value = result.cell;

                alert(`✅ MIX код розпізнано: ${result.cell}`);
            } else {
                statusDiv.textContent = '⚠️ ' + (result.error || 'Не вдалося розпізнати');
                statusDiv.className = 'scan-status error';
                setTimeout(() => {
                    statusDiv.textContent = '📸 Спробуйте ще раз';
                    statusDiv.className = 'scan-status ready';
                }, 2000);
            }
        } catch (error) {
            console.error('Помилка сканування:', error);
            statusDiv.textContent = '❌ Помилка з\'єднання';
            statusDiv.className = 'scan-status error';
            setTimeout(() => {
                statusDiv.textContent = '📸 Спробуйте ще раз';
                statusDiv.className = 'scan-status ready';
            }, 2000);
        }
    }, 'image/jpeg', 0.95);
}

// Відправити дані MIX картону
async function submitMixData() {
    const iccCode = document.getElementById('mix-icc-code-input').value.trim().toUpperCase();

    if (!iccCode) {
        showToast('⚠️ Введіть ICC код MIX!', 'error');
        document.getElementById('mix-icc-code-input').focus();
        return;
    }

    if (!/^[A-Z]\d{5,7}$/.test(iccCode)) {
        showToast('⚠️ Неправильний формат MIX коду!\nОчікується: літера + 5-7 цифр (наприклад: D980989)', 'error', 4000);
        document.getElementById('mix-icc-code-input').focus();
        return;
    }

    try {
        const checkResponse = await fetch('/api/icc/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icc_code: iccCode, type: 'mix' })
        });

        const checkData = await checkResponse.json();

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
            }
        } else {
            scannedData.isExisting = false;
        }

        showConfirmationModal();

    } catch (error) {
        console.error('Помилка перевірки MIX ICC:', error);
        showToast('Помилка з\'єднання з сервером', 'error');
    }
}
