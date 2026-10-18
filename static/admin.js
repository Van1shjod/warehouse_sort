let allUsers = [];
let selectedUserId = null;
let currentEditingICCId = null;
let confirmCallback = null; // Callback для підтвердження

// Функція для показу toast повідомлень (замість alert)
function showToast(message, type = 'info', duration = 2500) {
    const toast = document.getElementById('toast-message');

    if (!toast) {
        // Якщо toast елемент не існує - створюємо його
        const toastEl = document.createElement('div');
        toastEl.id = 'toast-message';
        toastEl.className = 'toast-message';
        document.body.appendChild(toastEl);
    }

    const toastElement = document.getElementById('toast-message');

    // Очистити попередні класи
    toastElement.className = 'toast-message';

    // Додати тип (error, success, warning, info)
    toastElement.classList.add(type);
    toastElement.classList.add('show');

    // Встановити текст
    toastElement.innerHTML = message.replace(/\n/g, '<br>');

    // Автоматично сховати через duration мілісекунд
    setTimeout(() => {
        toastElement.classList.remove('show');
    }, duration);
}

// Функція для показу кастомного confirm (замість confirm())
function showConfirm(message, title = '⚠️ Підтвердження') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleElement = document.getElementById('confirm-title');
        const messageElement = document.getElementById('confirm-message');

        titleElement.textContent = title;
        messageElement.innerHTML = message.replace(/\n/g, '<br>');

        confirmCallback = resolve;

        modal.style.display = 'flex';
    });
}

// Закрити модальне вікно підтвердження
function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'none';
    if (confirmCallback) {
        confirmCallback(false);
        confirmCallback = null;
    }
}

// Підтвердити дію
function confirmAction() {
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'none';
    if (confirmCallback) {
        confirmCallback(true);
        confirmCallback = null;
    }
}

// Показати таб адміна
function showAdminTab(tab) {
    const tabs = document.querySelectorAll('.admin-tab-content');
    const btns = document.querySelectorAll('.tab-btn');

    tabs.forEach(t => t.style.display = 'none');
    btns.forEach(b => b.classList.remove('active'));

    document.getElementById('admin-' + tab).style.display = 'block';
    event.target.classList.add('active');

    if (tab === 'sort') {
        loadSortingData();
    } else if (tab === 'users') {
        loadUsers();
    } else if (tab === 'activity') {
        loadUsersForActivity();
        loadActivity();
    } else if (tab === 'ocr') {
        if (allOcrScans.length === 0) loadOcrScans();
    }
}

// Показати підвкладку сортування
function showSortSubtab(subtab) {
    const subtabs = document.querySelectorAll('.sort-subtab-content');
    const btns = document.querySelectorAll('.sort-subtab-btn');

    subtabs.forEach(t => t.style.display = 'none');
    btns.forEach(b => b.classList.remove('active'));

    document.getElementById('admin-' + subtab).style.display = 'block';
    event.target.classList.add('active');

    if (subtab === 'sorting') {
        loadSortingData();
    } else if (subtab === 'completed') {
        loadCompletedData();
    } else if (subtab === 'pallets') {
        loadPallets();
    }
}

// Завантажити користувачів для таблиці
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();
        allUsers = users;

        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');

            const roleLabel = user.role === 'admin' ? 'Admin' : 'User';
            const canDelete = user.role !== 'admin';

            // Визначити статус (онлайн якщо активність менше 5 хв тому)
            const lastActivity = user.last_activity ? new Date(user.last_activity) : null;
            const now = new Date();
            const isOnline = lastActivity && (now - lastActivity) < 5 * 60 * 1000;
            const statusBadge = isOnline
                ? '<span class="badge badge-success">Онлайн</span>'
                : '<span class="badge" style="background: #6c757d; color: white;">Офлайн</span>';

            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td><span class="badge badge-${user.role}">${roleLabel}</span></td>
                <td>${statusBadge}</td>
                <td>${user.total_cartons}</td>
                <td>${new Date(user.created_at).toLocaleString('uk-UA')}</td>
                <td>
                    ${canDelete ? `<button class="btn btn-small btn-danger" onclick="deleteUser(${user.id}, '${user.username}')">Видалити</button>` : '-'}
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        showToast('Помилка завантаження користувачів', 'error');
    }
}

// Завантажити список користувачів для панелі активності
async function loadUsersForActivity() {
    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();
        allUsers = users;

        const usersList = document.getElementById('users-list');
        usersList.innerHTML = '';

        // Кнопка "Вся активність"
        const allActivityBtn = document.createElement('div');
        allActivityBtn.className = 'user-list-item' + (selectedUserId === null ? ' active' : '');
        allActivityBtn.innerHTML = '<strong>Вся активність</strong>';
        allActivityBtn.onclick = () => {
            selectedUserId = null;
            loadActivity();
            document.querySelectorAll('.user-list-item').forEach(item => item.classList.remove('active'));
            allActivityBtn.classList.add('active');
            document.getElementById('activity-title').textContent = 'Вся активність';
        };
        usersList.appendChild(allActivityBtn);

        // Розділити на онлайн та офлайн
        const now = new Date();
        const onlineUsers = users.filter(u => {
            const lastActivity = u.last_activity ? new Date(u.last_activity) : null;
            return lastActivity && (now - lastActivity) < 5 * 60 * 1000;
        });
        const offlineUsers = users.filter(u => {
            const lastActivity = u.last_activity ? new Date(u.last_activity) : null;
            return !lastActivity || (now - lastActivity) >= 5 * 60 * 1000;
        });

        // Онлайн користувачі
        if (onlineUsers.length > 0) {
            const onlineHeader = document.createElement('div');
            onlineHeader.style.cssText = 'padding: 0.75rem 1rem; background: #e8f5e9; font-weight: 600; color: #2e7d32;';
            onlineHeader.textContent = `🟢 Онлайн (${onlineUsers.length})`;
            usersList.appendChild(onlineHeader);

            onlineUsers.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'user-list-item' + (selectedUserId === user.id ? ' active' : '');
                userItem.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span><strong>${user.username}</strong></span>
                        <span class="badge badge-${user.role}" style="font-size: 0.7rem;">${user.role === 'admin' ? 'Admin' : 'User'}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: #666;">Картонів: ${user.total_cartons}</div>
                `;
                userItem.onclick = () => {
                    selectedUserId = user.id;
                    loadActivity(user.id);
                    document.querySelectorAll('.user-list-item').forEach(item => item.classList.remove('active'));
                    userItem.classList.add('active');
                    document.getElementById('activity-title').textContent = `Активність: ${user.username}`;
                };
                usersList.appendChild(userItem);
            });
        }

        // Офлайн користувачі
        if (offlineUsers.length > 0) {
            const offlineHeader = document.createElement('div');
            offlineHeader.style.cssText = 'padding: 0.75rem 1rem; background: #f5f5f5; font-weight: 600; color: #666;';
            offlineHeader.textContent = `⚫ Офлайн (${offlineUsers.length})`;
            usersList.appendChild(offlineHeader);

            offlineUsers.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'user-list-item' + (selectedUserId === user.id ? ' active' : '');
                userItem.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span><strong>${user.username}</strong></span>
                        <span class="badge badge-${user.role}" style="font-size: 0.7rem;">${user.role === 'admin' ? 'Admin' : 'User'}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: #666;">Картонів: ${user.total_cartons}</div>
                `;
                userItem.onclick = () => {
                    selectedUserId = user.id;
                    loadActivity(user.id);
                    document.querySelectorAll('.user-list-item').forEach(item => item.classList.remove('active'));
                    userItem.classList.add('active');
                    document.getElementById('activity-title').textContent = `Активність: ${user.username}`;
                };
                usersList.appendChild(userItem);
            });
        }
    } catch (error) {
        showToast('Помилка завантаження користувачів', 'error');
    }
}

// Видалити користувача
async function deleteUser(userId, username) {
    if (!confirm(`Видалити користувача ${username}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/delete_user/${userId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showToast('✓ Користувача видалено', 'success');
            loadUsers();
        } else {
            showToast(data.error || 'Помилка видалення', 'error');
        }
    } catch (error) {
        showToast('Помилка видалення користувача', 'error');
    }
}

// Завантажити активність (всю або конкретного користувача)
async function loadActivity(userId = null) {
    try {
        const url = userId
            ? `/api/admin/activity/${userId}`
            : '/api/admin/activity';

        const response = await fetch(url);
        const logs = await response.json();

        const tbody = document.getElementById('activity-table-body');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #999;">Немає записів активності</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');

            // Знайти ім'я користувача
            const user = allUsers.find(u => u.id === log.user_id);
            const username = user ? user.username : `User ID: ${log.user_id || 'System'}`;

            row.innerHTML = `
                <td>${new Date(log.timestamp).toLocaleString('uk-UA')}</td>
                <td><strong>${username}</strong></td>
                <td>${log.action}</td>
                <td>${log.details || '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        showToast('Помилка завантаження активності', 'error');
    }
}

// Створити акаунт
document.getElementById('create-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('account-username').value;
    const password = document.getElementById('account-password').value;
    const role = document.getElementById('account-role').value;

    if (password.length < 4) {
        showToast('Пароль має бути не менше 4 символів', 'error');
        return;
    }

    // Перевірка що роль тільки user або admin
    if (role !== 'user' && role !== 'admin') {
        showToast('Невірна роль', 'error');
        return;
    }

    try {
        const response = await fetch('/api/admin/create_account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password, role })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('✓ Акаунт створено успішно!', 'success');
            document.getElementById('create-account-form').reset();
            showAdminTab('users');
        } else {
            showToast(data.error || 'Помилка створення акаунта', 'error');
        }
    } catch (error) {
        showToast('Помилка створення акаунта', 'error');
    }
});

// Завантажити користувачів при завантаженні
loadSortingData();

// ============================================
// ФУНКЦІЇ ДЛЯ ВКЛАДКИ "СОРТУВАННЯ"
// ============================================

// Завантажити дані сортування
async function loadSortingData() {
    try {
        const response = await fetch('/api/admin/icc_codes');
        const iccCodes = await response.json();

        const tbody = document.getElementById('sorting-table-body');
        tbody.innerHTML = '';

        // Фільтруємо тільки незавершені
        const inProgress = iccCodes.filter(icc => icc.is_completed === 0);

        if (inProgress.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2rem; color: #666;">
                        Немає картонів в процесі сортування
                    </td>
                </tr>
            `;
            return;
        }

        inProgress.forEach(icc => {
            const row = document.createElement('tr');

            const typeBadge = {
                'single': '<span class="badge badge-info">Single</span>',
                'mix': '<span class="badge badge-warning">Mix</span>',
                'vevor': '<span class="badge" style="background: #9c27b0; color: white;">Vevor</span>'
            }[icc.type] || '<span class="badge">Unknown</span>';

            const current = icc.current_cartons || 0;
            const total = icc.total_cartons || 0;
            const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

            const progressBar = total > 0
                ? `
                    <div>${current} / ${total}</div>
                    <div class="mini-progress">
                        <div class="mini-progress-fill" style="width: ${percentage}%;"></div>
                    </div>
                `
                : `<div>${current} / ∞</div>`;

            const locationDisplay = icc.location_code || '<span style="color: #999;">—</span>';
            const openPalletsDisplay = icc.open_pallets_count > 0
                ? `<span class="badge badge-warning">${icc.open_pallets_count} відкритих</span>`
                : `<span style="color: #999;">—</span>`;

            const statusBadge = percentage >= 100
                ? '<span class="badge badge-success">Готово до закриття</span>'
                : `<span class="badge badge-info">${percentage}%</span>`;

            row.innerHTML = `
                <td><strong>${icc.last_4_digits}</strong></td>
                <td>${typeBadge}</td>
                <td>${progressBar}</td>
                <td>${locationDisplay}</td>
                <td>${openPalletsDisplay}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-small btn-primary" onclick="openEditICCModal(${icc.id})">Редагувати</button>
                </td>
            `;

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Помилка завантаження даних сортування:', error);
    }
}

// Відкрити модальне вікно редагування ICC
async function openEditICCModal(iccId) {
    try {
        const response = await fetch('/api/admin/icc_codes');
        const iccCodes = await response.json();
        const icc = iccCodes.find(i => i.id === iccId);

        if (!icc) {
            showToast('ICC код не знайдено', 'error');
            return;
        }

        currentEditingICCId = iccId;

        document.getElementById('edit-icc-code').value = icc.last_4_digits;
        document.getElementById('edit-icc-type').value = icc.type.toUpperCase();
        document.getElementById('edit-total-cartons').value = icc.total_cartons;
        document.getElementById('edit-current-cartons').value = icc.current_cartons;
        document.getElementById('edit-location-code').value = icc.location_code || '';

        document.getElementById('edit-icc-modal').style.display = 'flex';

    } catch (error) {
        console.error('Помилка відкриття модального вікна:', error);
        showToast('Помилка завантаження даних', 'error');
    }
}

// Закрити модальне вікно редагування
function closeEditICCModal() {
    document.getElementById('edit-icc-modal').style.display = 'none';
    currentEditingICCId = null;
}

// Зберегти зміни ICC коду
async function saveICCChanges() {
    const totalCartons = parseInt(document.getElementById('edit-total-cartons').value);
    const currentCartons = parseInt(document.getElementById('edit-current-cartons').value);
    const locationCode = document.getElementById('edit-location-code').value.trim().toUpperCase();

    if (!totalCartons || totalCartons < 1) {
        showToast('Введіть загальну кількість!', 'error');
        return;
    }

    if (currentCartons < 0 || currentCartons > totalCartons) {
        showToast('Поточна кількість не може бути більше загальної!', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/icc/${currentEditingICCId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                total_cartons: totalCartons,
                current_cartons: currentCartons,
                location_code: locationCode
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('✓ Зміни збережено!', 'success');
            closeEditICCModal();
            loadSortingData();
        } else {
            showToast(data.error || 'Помилка збереження', 'error');
        }

    } catch (error) {
        console.error('Помилка збереження:', error);
        alert('Помилка з\'єднання з сервером');
    }
}

// Видалити ICC код
async function deleteICC() {
    if (!confirm('⚠️ Ви впевнені? Це видалить ICC код та всі пов\'язані палети!')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/icc/${currentEditingICCId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showToast('✓ ICC код видалено!', 'success');
            closeEditICCModal();
            loadSortingData();
        } else {
            showToast(data.error || 'Помилка видалення', 'error');
        }

    } catch (error) {
        console.error('Помилка видалення:', error);
        alert('Помилка з\'єднання з сервером');
    }
}

// ============================================
// ФУНКЦІЇ ДЛЯ ВКЛАДКИ "ЗАВЕРШЕНІ"
// ============================================

// Завантажити завершені картони
async function loadCompletedData() {
    try {
        const response = await fetch('/api/admin/icc_codes');
        const iccCodes = await response.json();

        const tbody = document.getElementById('completed-table-body');
        tbody.innerHTML = '';

        // Фільтруємо тільки завершені
        const completed = iccCodes.filter(icc => icc.is_completed === 1);

        if (completed.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2rem; color: #666;">
                        Немає завершених картонів
                    </td>
                </tr>
            `;
            return;
        }

        // Сортуємо по даті створення (найновіші спочатку)
        completed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        completed.forEach(icc => {
            const row = document.createElement('tr');

            const typeBadge = {
                'single': '<span class="badge badge-info">Single</span>',
                'mix': '<span class="badge badge-warning">Mix</span>',
                'vevor': '<span class="badge" style="background: #9c27b0; color: white;">Vevor</span>'
            }[icc.type] || '<span class="badge">Unknown</span>';

            const current = icc.current_cartons || 0;
            const total = icc.total_cartons || 0;
            const quantity = total > 0 ? `${current} / ${total}` : `${current}`;

            const locationDisplay = icc.location_code || '<span style="color: #999;">—</span>';
            const totalPallets = icc.total_pallets_count || 0;

            // Форматувати дату
            const createdDate = new Date(icc.created_at);
            const dateStr = createdDate.toLocaleDateString('uk-UA', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            row.innerHTML = `
                <td><strong>${icc.last_4_digits}</strong></td>
                <td>${typeBadge}</td>
                <td>
                    <span class="badge badge-success">${quantity}</span>
                </td>
                <td>${locationDisplay}</td>
                <td>${totalPallets}</td>
                <td style="font-size: 0.85rem;">${dateStr}</td>
                <td>
                    <button class="btn btn-small btn-primary" onclick="viewCompletedDetails(${icc.id})">Переглянути</button>
                    <button class="btn btn-small btn-danger" onclick="deleteCompletedICC(${icc.id})">Видалити</button>
                </td>
            `;

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Помилка завантаження завершених:', error);
    }
}

// Переглянути деталі завершеного картону
async function viewCompletedDetails(iccId) {
    try {
        const response = await fetch('/api/admin/icc_codes');
        const iccCodes = await response.json();
        const icc = iccCodes.find(i => i.id === iccId);

        if (!icc) {
            showToast('ICC код не знайдено', 'error');
            return;
        }

        currentEditingICCId = iccId;

        // Заповнити форму (тільки для перегляду)
        document.getElementById('edit-icc-code').value = icc.last_4_digits;
        document.getElementById('edit-icc-type').value = icc.type.toUpperCase();
        document.getElementById('edit-total-cartons').value = icc.total_cartons;
        document.getElementById('edit-current-cartons').value = icc.current_cartons;
        document.getElementById('edit-location-code').value = icc.location_code || '';

        // Показати модальне вікно
        document.getElementById('edit-icc-modal').style.display = 'flex';

    } catch (error) {
        console.error('Помилка відкриття деталей:', error);
        showToast('Помилка завантаження даних', 'error');
    }
}

// Видалити завершений ICC код
async function deleteCompletedICC(iccId) {
    if (!confirm('⚠️ Ви впевнені? Це видалить ICC код та всі пов\'язані палети!')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/icc/${iccId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showToast('✓ ICC код видалено!', 'success');
            loadCompletedData(); // Оновити таблицю
        } else {
            showToast(data.error || 'Помилка видалення', 'error');
        }

    } catch (error) {
        console.error('Помилка видалення:', error);
        alert('Помилка з\'єднання з сервером');
    }
}

// ============================================================
// OCR SCANS VIEWER
// ============================================================
let allOcrScans = [];
let currentOcrFilter = 'all';
let ocrSortDesc = true;

async function loadOcrScans() {
    const list = document.getElementById('ocr-list');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:2rem;"><div class="spinner"></div></div>';
    try {
        const res = await fetch('/api/admin/ocr_scans?t=' + Date.now());
        allOcrScans = await res.json();
        renderOcrScans();
    } catch (e) {
        list.innerHTML = '<p style="color:red;text-align:center;">Помилка завантаження</p>';
    }
}

function filterOcr(filter) {
    currentOcrFilter = filter;
    document.querySelectorAll('.ocr-filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderOcrScans();
}

function toggleOcrSort() {
    ocrSortDesc = !ocrSortDesc;
    const btn = document.getElementById('ocr-sort-btn');
    if (btn) btn.textContent = ocrSortDesc ? '↓ Нові спочатку' : '↑ Старі спочатку';
    renderOcrScans();
}

function renderOcrScans() {
    const list = document.getElementById('ocr-list');
    if (!list) return;

    let filtered = allOcrScans;
    if (currentOcrFilter === 'single') filtered = allOcrScans.filter(s => s.carton_type === 'single');
    else if (currentOcrFilter === 'mix') filtered = allOcrScans.filter(s => s.carton_type === 'mix');
    else if (currentOcrFilter === 'vevor') filtered = allOcrScans.filter(s => s.carton_type === 'vevor');
    else if (currentOcrFilter === 'success') filtered = allOcrScans.filter(s => s.success);
    else if (currentOcrFilter === 'fail') filtered = allOcrScans.filter(s => !s.success);

    filtered = [...filtered].sort((a, b) => {
        const ta = a.timestamp || '';
        const tb = b.timestamp || '';
        return ocrSortDesc ? tb.localeCompare(ta) : ta.localeCompare(tb);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;">Немає записів</p>';
        return;
    }

    list.innerHTML = filtered.map((scan) => {
        const ts = scan.timestamp || '';
        const date = ts ? `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)}` : '—';
        const statusClass = scan.success ? 'success' : 'fail';
        const statusLabel = scan.success ? 'Успіх' : 'Невдача';
        const imgUrl = scan.image_exists ? `/api/admin/ocr_image?path=${encodeURIComponent(scan.image_path)}` : null;
        const thumbHtml = imgUrl
            ? `<img class="ocr-card-thumb" src="${imgUrl}" alt="scan">`
            : `<div class="ocr-card-thumb-placeholder">📷</div>`;

        const ext = scan.extracted_data;
        const extSummary = ext
            ? `ICC: ${ext.cell || '?'} | PACK: ${ext.qtyPack || '?'} | Зона: ${ext.prefix || '?'}${ext.zone ? '-' + ext.zone : ''}`
            : 'Дані не витягнуті';

        const realIdx = allOcrScans.indexOf(scan);
        return `
        <div class="ocr-card ${statusClass}" onclick="showOcrDetail(${realIdx})">
            ${thumbHtml}
            <div class="ocr-card-info">
                <strong>${scan.carton_type?.toUpperCase() || '?'} &nbsp; <span class="ocr-badge ${statusClass}">${statusLabel}</span></strong>
                <span>${date} &nbsp;·&nbsp; user ${scan.user_id}</span>
                <span style="display:block;margin-top:0.2rem;color:#444;">${extSummary}</span>
            </div>
        </div>`;
    }).join('');
}

function showOcrDetail(idx) {
    const scan = allOcrScans[idx];
    if (!scan) return;
    const modal = document.getElementById('ocr-detail-modal');
    const body = document.getElementById('ocr-detail-body');
    if (!modal || !body) return;

    const ts = scan.timestamp || '';
    const date = ts ? `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)}` : '—';
    const imgUrl = scan.image_exists ? `/api/admin/ocr_image?path=${encodeURIComponent(scan.image_path)}` : null;

    const rawOcr = scan.raw_ocr_results || {};
    const rawRows = Object.entries(rawOcr).map(([k, v]) =>
        `<tr><td style="padding:0.4rem 0.8rem;font-weight:600;color:#555;white-space:nowrap;">${k}</td><td style="padding:0.4rem 0.8rem;word-break:break-all;">${v}</td></tr>`
    ).join('');

    const ext = scan.extracted_data || {};
    body.innerHTML = `
        <div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin-bottom:1.5rem;">
            ${imgUrl
                ? `<img src="${imgUrl}" style="max-width:240px;width:100%;border-radius:10px;object-fit:contain;background:#f5f5f5;align-self:flex-start;cursor:zoom-in;" onclick="openFullscreenImg(this.src)">`
                : `<div style="width:240px;height:160px;border-radius:10px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:3rem;flex-shrink:0;">📷</div>`
            }
            <div style="flex:1;min-width:180px;">
                <div class="form-group" style="margin-bottom:0.75rem;">
                    <label>Тип</label>
                    <div style="font-size:1.1rem;font-weight:600;">${scan.carton_type?.toUpperCase()}</div>
                </div>
                <div class="form-group" style="margin-bottom:0.75rem;">
                    <label>Час</label>
                    <div>${date}</div>
                </div>
                <div class="form-group" style="margin-bottom:0.75rem;">
                    <label>Статус</label>
                    <div><span class="ocr-badge ${scan.success ? 'success' : 'fail'}">${scan.success ? 'Успіх' : 'Невдача'}</span></div>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>Витягнуті дані</label>
                    <div>ICC: <strong>${ext.cell || '—'}</strong> &nbsp; PACK: <strong>${ext.qtyPack || '—'}</strong> &nbsp; Зона: <strong>${ext.prefix || '—'}${ext.zone ? '-' + ext.zone : ''}</strong></div>
                </div>
            </div>
        </div>
        ${rawRows ? `
        <div>
            <label style="font-weight:600;font-size:0.9rem;color:#666;display:block;margin-bottom:0.5rem;">OCR результати по варіантах:</label>
            <div style="border-radius:8px;overflow:hidden;border:1px solid #ddd;">
                <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
                    <tbody>${rawRows}</tbody>
                </table>
            </div>
        </div>` : ''}
        <div style="margin-top:1.5rem;text-align:right;">
            <button class="btn btn-danger" onclick="deleteOcrScan(${idx})">Видалити лог</button>
        </div>
    `;

    modal.style.display = 'flex';
}

function closeOcrDetail() {
    const modal = document.getElementById('ocr-detail-modal');
    if (modal) modal.style.display = 'none';
}

function openFullscreenImg(src) {
    let lb = document.getElementById('ocr-lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'ocr-lightbox';
        lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        lb.innerHTML = '<img id="ocr-lightbox-img" style="max-width:95vw;max-height:95vh;border-radius:8px;object-fit:contain;">';
        lb.addEventListener('click', () => lb.style.display = 'none');
        document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.style.display = 'none'; });
        document.body.appendChild(lb);
    }
    document.getElementById('ocr-lightbox-img').src = src;
    lb.style.display = 'flex';
}

async function deleteOcrScan(idx) {
    const scan = allOcrScans[idx];
    if (!scan) return;
    if (!confirm('Видалити цей лог і фото?')) return;

    // Зберігаємо поточну позицію скролу
    const scrollPosition = window.scrollY || window.pageYOffset;
    const ocrListScrollPosition = document.getElementById('ocr-list')?.scrollTop || 0;

    try {
        const res = await fetch('/api/admin/ocr_scans/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ json_path: scan.json_path, image_path: scan.image_path || '' })
        });
        const data = await res.json();
        if (data.success) {
            allOcrScans.splice(idx, 1);
            closeOcrDetail();
            renderOcrScans();

            // Відновлюємо позицію скролу після рендерингу
            setTimeout(() => {
                window.scrollTo(0, scrollPosition);
                const ocrList = document.getElementById('ocr-list');
                if (ocrList) ocrList.scrollTop = ocrListScrollPosition;
            }, 50);

            showToast('✓ Видалено', 'success', 1500);
        } else {
            showToast(data.error || 'Помилка', 'error');
        }
    } catch (e) {
        showToast('Помилка з\'єднання', 'error');
    }
}

// ============================================
// ФУНКЦІЇ ДЛЯ СТВОРЕННЯ СОРТІВ
// ============================================

// Показати підвкладку створення сортів
function showSortSubtab(subtab) {
    // Сховати всі підвкладки
    const subtabs = document.querySelectorAll('.sort-subtab-content');
    const btns = document.querySelectorAll('.sort-subtab-btn');

    subtabs.forEach(t => t.style.display = 'none');
    btns.forEach(b => b.classList.remove('active'));

    // Показати обрану підвкладку
    document.getElementById('admin-' + subtab).style.display = 'block';
    event.target.classList.add('active');

    // Завантажити дані для підвкладки створення сорту
    if (subtab === 'create-sort') {
        loadActiveSorts();
    }
}

// Оновити опції локацій в залежності від типу
function updateLocationOptions() {
    const locationType = document.getElementById('sort-location-type').value;
    const locationSelect = document.getElementById('sort-location');
    const locationGroup = document.getElementById('location-select-group');
    const locationLabel = document.getElementById('location-label');

    locationSelect.innerHTML = '<option value="">-- Оберіть локацію --</option>';

    if (!locationType) {
        locationGroup.style.display = 'none';
        return;
    }

    locationGroup.style.display = 'block';

    if (locationType === 'zona-single') {
        locationLabel.textContent = 'Zona Single *';
        ['A', 'B', 'C'].forEach(letter => {
            const option = document.createElement('option');
            option.value = 'Zona Single ' + letter;
            option.textContent = 'Zona Single ' + letter;
            locationSelect.appendChild(option);
        });
    } else if (locationType === 'zona-mix') {
        locationLabel.textContent = 'Zona Mix *';
        ['A', 'B', 'C'].forEach(letter => {
            const option = document.createElement('option');
            option.value = 'Zona Mix ' + letter;
            option.textContent = 'Zona Mix ' + letter;
            locationSelect.appendChild(option);
        });
    } else if (locationType === 'rampa') {
        locationLabel.textContent = 'Rampa *';
        for (let i = 1; i <= 9; i++) {
            const option = document.createElement('option');
            option.value = 'Rampa ' + i;
            option.textContent = 'Rampa ' + i;
            locationSelect.appendChild(option);
        }
    }

    updateSortPreview();
}

// Оновити попередній перегляд сорту
function updateSortPreview() {
    const location = document.getElementById('sort-location').value;
    const single = document.getElementById('type-single').checked;
    const mix = document.getElementById('type-mix').checked;
    const vevor = document.getElementById('type-vevor').checked;

    const preview = document.getElementById('sort-preview');
    const previewText = document.getElementById('sort-preview-text');

    if (!location || (!single && !mix && !vevor)) {
        preview.style.display = 'none';
        return;
    }

    const types = [];
    if (single) types.push('Single');
    if (mix) types.push('Mix');
    if (vevor) types.push('Vevor');

    previewText.textContent = `${location} — ${types.join(' + ')}`;
    preview.style.display = 'block';
}

// Завантажити активні сорти
async function loadActiveSorts() {
    try {
        const response = await fetch('/api/sorts/all');
        const sorts = await response.json();

        const activeSorts = sorts.filter(s => s.status === 'active');
        const container = document.getElementById('active-sorts-list');

        if (activeSorts.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; background: #f5f5f5; border-radius: 8px; color: #666;">Немає активних сортів</div>';
            return;
        }

        container.innerHTML = activeSorts.map(sort => {
            const unloadDate = sort.unload_date ?
                new Date(sort.unload_date).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) :
                '';

            const workingUsers = sort.working_users && sort.working_users.length > 0 ?
                sort.working_users.map(u => `👤 ${u.username}`).join(', ') :
                '<span style="color: #999;">Немає активних</span>';

            return `
                <div style="background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #4CAF50;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                        <div>
                            <h4 style="margin: 0; font-size: 1.2rem;">${sort.name}</h4>
                            ${unloadDate ? `<div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">📅 ${unloadDate}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-small btn-warning" onclick="closeSortConfirm(${sort.id}, '${sort.name.replace(/'/g, "\\'")}')">Закрити</button>
                            <button class="btn btn-small btn-danger" onclick="deleteSortConfirm(${sort.id}, '${sort.name.replace(/'/g, "\\'")}')">Видалити</button>
                        </div>
                    </div>
                    ${sort.description ? `<div style="color: #666; font-size: 0.9rem; margin-top: 0.5rem;">${sort.description}</div>` : ''}
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #eee;">
                        <div style="font-size: 0.9rem; color: #666;">Працюють: ${workingUsers}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Помилка завантаження сортів:', error);
        showToast('Помилка завантаження сортів', 'error');
    }
}

// Створити новий сорт
async function createNewSort() {
    const location = document.getElementById('sort-location').value;
    const single = document.getElementById('type-single').checked;
    const mix = document.getElementById('type-mix').checked;
    const vevor = document.getElementById('type-vevor').checked;
    const unloadDate = document.getElementById('sort-unload-date').value;
    const notes = document.getElementById('sort-notes').value.trim();

    // Валідація
    if (!location) {
        showToast('Оберіть локацію', 'error');
        return;
    }

    if (!single && !mix && !vevor) {
        showToast('Оберіть хоча б один тип картонів', 'error');
        return;
    }

    // Сформувати типи
    const types = [];
    if (single) types.push('single');
    if (mix) types.push('mix');
    if (vevor) types.push('vevor');

    try {
        const response = await fetch('/api/sorts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: location,
                type: types.join(','), // Зберігаємо як рядок через кому
                unload_date: unloadDate || new Date().toISOString().split('T')[0],
                description: notes
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Сорт створено: ' + location, 'success');

            // Очистити форму
            document.getElementById('sort-location-type').value = '';
            document.getElementById('sort-location').value = '';
            document.getElementById('location-select-group').style.display = 'none';
            document.getElementById('type-single').checked = false;
            document.getElementById('type-mix').checked = false;
            document.getElementById('type-vevor').checked = false;
            document.getElementById('sort-unload-date').value = '';
            document.getElementById('sort-notes').value = '';
            document.getElementById('sort-preview').style.display = 'none';

            // Оновити список активних сортів
            loadActiveSorts();
        } else {
            showToast(data.error || 'Помилка створення сорту', 'error');
        }
    } catch (error) {
        console.error('Помилка створення сорту:', error);
        showToast('Помилка створення сорту', 'error');
    }
}

// Підтвердження закриття сорту
function closeSortConfirm(sortId, sortName) {
    if (confirm(`Ви впевнені, що хочете закрити сорт "${sortName}"?\n\nЗакритий сорт більше не буде доступний для користувачів.`)) {
        updateSortStatus(sortId, 'closed');
    }
}

// Підтвердження видалення сорту
function deleteSortConfirm(sortId, sortName) {
    if (confirm(`Ви впевнені, що хочете видалити сорт "${sortName}"?\n\nУВАГА: Це видалить всі пов'язані дані!`)) {
        deleteSort(sortId);
    }
}

// Оновити статус сорту
async function updateSortStatus(sortId, newStatus) {
    try {
        const response = await fetch(`/api/sorts/${sortId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Статус оновлено', 'success');
            loadActiveSorts();
        } else {
            showToast(data.error || 'Помилка оновлення статусу', 'error');
        }
    } catch (error) {
        console.error('Помилка оновлення статусу:', error);
        showToast('Помилка оновлення статусу', 'error');
    }
}

// Видалити сорт
async function deleteSort(sortId) {
    try {
        const response = await fetch(`/api/sorts/${sortId}?confirm=true`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Сорт видалено', 'success');
            loadActiveSorts();
        } else {
            showToast(data.error || 'Помилка видалення сорту', 'error');
        }
    } catch (error) {
        console.error('Помилка видалення сорту:', error);
        showToast('Помилка видалення сорту', 'error');
    }
}

