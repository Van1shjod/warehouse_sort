let allUsers = [];
let selectedUserId = null;
let currentEditingICCId = null;
let confirmCallback = null; // Callback для підтвердження
let allPallets = [];
let currentPalletFilter = 'all';
let adminTaskRequest = 0;
let creatingSort = false;
let sortDeletionPending = false;
const adminText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function readAdminJson(url) {
    const response = await fetch(url);
    if (response.status === 401) throw new Error('Сесія завершилась. Увійдіть знову.');
    if (response.status === 403) throw new Error('Для перегляду потрібні права адміністратора.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не вдалося завантажити дані');
    return data;
}

function showTableMessage(id, message, columns = 7) {
    const tbody = document.getElementById(id);
    tbody.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.style.cssText = 'text-align: center; padding: 2rem; color: #666;';
    cell.textContent = message;
    row.append(cell); tbody.append(row);
}

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
    toastElement.textContent = String(message);
    toastElement.style.whiteSpace = 'pre-line';

    // Автоматично сховати через duration мілісекунд
    setTimeout(() => {
        toastElement.classList.remove('show');
    }, duration);
}

// Функція для показу кастомного confirm (замість confirm())
function showConfirm(message, title = '⚠️ Підтвердження') {
    if (confirmCallback) return Promise.resolve(false);
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleElement = document.getElementById('confirm-title');
        const messageElement = document.getElementById('confirm-message');

        titleElement.textContent = title;
        messageElement.textContent = message;
        messageElement.style.whiteSpace = 'pre-line';

        confirmCallback = resolve;

        modal.style.display = 'flex';
        document.getElementById('confirm-no-btn')?.focus?.();
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
    [...btns].find(button => button.getAttribute('onclick')?.includes(`'${tab}'`))?.classList.add('active');

    if (tab === 'sort') {
        const visible = [...document.querySelectorAll('.sort-subtab-content')].find(node => node.style.display !== 'none');
        showSortSubtab(visible ? visible.id.replace('admin-', '') : 'sorting');
    } else if (tab === 'presort') {
        window.loadAdminPresort?.();
    } else if (tab === 'inventory') {
        window.loadInventoryAdmin?.();
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
    [...btns].find(button => button.getAttribute('onclick')?.includes(`'${subtab}'`))?.classList.add('active');

    if (subtab === 'sorting') {
        loadSortingData();
    } else if (subtab === 'completed') {
        loadCompletedData();
    } else if (subtab === 'pallets') {
        loadPallets();
    } else if (subtab === 'id-pack') {
        window.loadAdminIdPack?.();
    } else if (subtab === 'create-sort') {
        loadActiveSorts();
    }
}

async function loadPallets() {
    showTableMessage('pallets-table-body', 'Завантаження палет…');
    try {
        allPallets = await readAdminJson('/api/lider/pallets');
        if (!Array.isArray(allPallets)) throw new Error('Сервер повернув некоректний список палет');
        filterPallets(currentPalletFilter);
    } catch (error) {
        allPallets = [];
        document.getElementById('pallets-summary').textContent = '';
        showTableMessage('pallets-table-body', error.message);
    }
}

function filterPallets(filter = 'all') {
    if (!['all', 'open', 'closed', 'single', 'mix', 'vevor'].includes(filter)) return;
    currentPalletFilter = filter;
    document.querySelectorAll('.pallet-filter-btn').forEach(button => {
        button.classList.toggle('active', button.getAttribute('onclick')?.includes(`'${filter}'`));
    });
    const closed = allPallets.filter(item => Number(item.pallet.is_closed) === 1).length;
    const cartons = allPallets.reduce((sum, item) => sum + Number(item.pallet.cartons_count || 0), 0);
    document.getElementById('pallets-summary').textContent = `Палет SORT: ${allPallets.length} · Відкрито: ${allPallets.length - closed} · Закрито: ${closed} · Картонів: ${cartons}`;
    const filtered = allPallets.filter(({pallet}) => filter === 'all'
        || (filter === 'open' && Number(pallet.is_closed) === 0)
        || (filter === 'closed' && Number(pallet.is_closed) === 1)
        || pallet.type === filter);
    if (!filtered.length) {
        showTableMessage('pallets-table-body', allPallets.length ? 'Немає палет за вибраним фільтром.' : 'Палет SORT ще немає. Вони з’являться після додавання картонів у SORT.');
        return;
    }
    const tbody = document.getElementById('pallets-table-body'); tbody.replaceChildren();
    const labels = ['Номер палети', 'Тип', 'Товар / локація', 'Картонів', 'Працівник', 'Статус', 'Створено'];
    for (const {pallet, icc, user} of filtered) {
        const row = document.createElement('tr');
        const date = new Date(String(pallet.created_at || '').replace(' ', 'T') + 'Z');
        const itemLabel = icc ? [icc.last_4_digits, icc.location_code, icc.total_cartons > 0 ? icc.total_cartons + ' PACK' : ''].filter(Boolean).join(' · ') : 'Товар недоступний';
        const values = [pallet.pallet_number, String(pallet.type || '').toUpperCase(), itemLabel,
            pallet.cartons_count || 0, user?.username || 'Користувач видалений',
            Number(pallet.is_closed) === 1 ? 'Закрита' : 'Відкрита', Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('uk-UA')];
        for (const [index, value] of values.entries()) {
            const cell = document.createElement('td'); cell.dataset.label = labels[index]; cell.textContent = String(value);
            if ([0,2,4].includes(index)) cell.dataset.noTranslate='';
            row.append(cell);
        }
        tbody.append(row);
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
                <td data-no-translate>${adminText(user.username)}</td>
                <td><span class="badge badge-${user.role === 'admin' ? 'admin' : 'user'}">${roleLabel}</span></td>
                <td>${statusBadge}</td>
                <td>${user.total_cartons}</td>
                <td>${new Date(user.created_at).toLocaleString('uk-UA')}</td>
                <td>
                    ${canDelete ? '<button class="btn btn-small btn-danger">Видалити</button>' : '-'}
                </td>
            `;
            if (canDelete) row.querySelector('button')?.addEventListener('click',()=>deleteUser(user.id,user.username));
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
                        <span><strong data-no-translate>${adminText(user.username)}</strong></span>
                        <span class="badge badge-${user.role === 'admin' ? 'admin' : 'user'}" style="font-size: 0.7rem;">${user.role === 'admin' ? 'Admin' : 'User'}</span>
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
                        <span><strong data-no-translate>${adminText(user.username)}</strong></span>
                        <span class="badge badge-${user.role === 'admin' ? 'admin' : 'user'}" style="font-size: 0.7rem;">${user.role === 'admin' ? 'Admin' : 'User'}</span>
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
                <td><strong data-no-translate>${adminText(username)}</strong></td>
                <td>${adminText(log.action)}</td>
                <td>${adminText(log.details || '-')}</td>
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
    showTableMessage('sorting-table-body', 'Завантаження товарів…');
    try {
        const iccCodes = await readAdminJson('/api/admin/icc_codes');
        if (!Array.isArray(iccCodes)) throw new Error('Не вдалося прочитати список товарів');

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

            const locationDisplay = adminText(icc.location_code) || '<span style="color: #999;">—</span>';
            const openPalletsDisplay = icc.open_pallets_count > 0
                ? `<span class="badge badge-warning">${icc.open_pallets_count} відкритих</span>`
                : `<span style="color: #999;">—</span>`;

            const statusBadge = percentage >= 100
                ? '<span class="badge badge-success">Готово до закриття</span>'
                : `<span class="badge badge-info">${percentage}%</span>`;

            row.innerHTML = `
                <td><strong>${adminText(icc.last_4_digits)}</strong></td>
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
        showTableMessage('sorting-table-body', error.message);
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

        if (icc.sort_id) {
            showAdminTab('inventory');
            await window.openInventoryJob?.(icc.sort_id);
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
    showTableMessage('completed-table-body', 'Завантаження завершених товарів…');
    try {
        const iccCodes = await readAdminJson('/api/admin/icc_codes');
        if (!Array.isArray(iccCodes)) throw new Error('Не вдалося прочитати список завершених товарів');

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

            const locationDisplay = adminText(icc.location_code) || '<span style="color: #999;">—</span>';
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
                <td><strong>${adminText(icc.last_4_digits)}</strong></td>
                <td>${typeBadge}</td>
                <td>
                    <span class="badge badge-success">${quantity}</span>
                </td>
                <td>${locationDisplay}</td>
                <td>${totalPallets}</td>
                <td style="font-size: 0.85rem;">${dateStr}</td>
                <td>
                    <button class="btn btn-small btn-primary" onclick="viewCompletedDetails(${icc.id})">Переглянути</button>
                    ${icc.sort_id ? '' : `<button class="btn btn-small btn-danger" onclick="deleteCompletedICC(${icc.id})">Видалити</button>`}
                </td>
            `;

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Помилка завантаження завершених:', error);
        showTableMessage('completed-table-body', error.message);
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
        if (icc.sort_id) {
            showAdminTab('inventory');
            await window.openInventoryJob?.(icc.sort_id);
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
    document.querySelector(`.ocr-filter-btn[onclick*="'${filter}'"]`)?.classList.add('active');
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
                <strong>${scan.carton_type?.toUpperCase() || '?'} &nbsp; <span class="ocr-badge ${statusClass}">${statusLabel}</span>${scan.corrected_data ? ' · Виправлено вручну' : ''}</strong>
                <span>${date} &nbsp;·&nbsp; user ${scan.user_id}</span>
                <span style="display:block;margin-top:0.2rem;color:#444;">${adminText(extSummary)}</span>
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
        `<tr><td style="padding:0.4rem 0.8rem;font-weight:600;color:#555;white-space:nowrap;">${adminText(k)}</td><td style="padding:0.4rem 0.8rem;word-break:break-all;">${adminText(v)}</td></tr>`
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
                    <div>ICC: <strong>${adminText(ext.cell || '—')}</strong> &nbsp; PACK: <strong>${adminText(ext.qtyPack || '—')}</strong> &nbsp; Зона: <strong>${adminText(ext.prefix || '—')}${ext.zone ? '-' + adminText(ext.zone) : ''}</strong></div>
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
        <form id="ocr-correction-form" style="margin-top:1.5rem;">
            <h3>Правильні дані з наклейки</h3>
            <p>Звірте поля з фото. Виправлення зберігаються окремо від результату OCR.</p>
            <div style="display:flex;gap:1rem;flex-wrap:wrap;">
                <div class="form-group"><label for="ocr-correct-cell">ICC код</label><input id="ocr-correct-cell" required></div>
                <div class="form-group"><label for="ocr-correct-qty">PACK</label><input id="ocr-correct-qty" type="number" min="1" step="1"></div>
                <div class="form-group"><label for="ocr-correct-prefix">Префікс</label><input id="ocr-correct-prefix"></div>
                <div class="form-group"><label for="ocr-correct-zone">Зона</label><input id="ocr-correct-zone"></div>
            </div>
            <p id="ocr-correction-status" role="status"></p>
            <button class="btn btn-primary" type="submit">Зберегти виправлення</button>
        </form>
        <div style="margin-top:1.5rem;text-align:right;">
            <button class="btn btn-danger" onclick="deleteOcrScan(${idx})">Видалити лог</button>
        </div>
    `;

    const corrected = scan.corrected_data || ext;
    for (const [field, id] of Object.entries({cell: 'cell', qtyPack: 'qty', prefix: 'prefix', zone: 'zone'})) {
        document.getElementById(`ocr-correct-${id}`).value = corrected[field] ?? '';
    }
    if (scan.corrected_data) {
        document.getElementById('ocr-correction-status').textContent = 'Ручне виправлення збережено';
    }
    document.getElementById('ocr-correction-form').addEventListener('submit', event => {
        event.preventDefault();
        saveOcrCorrection(idx);
    });
    modal.style.display = 'flex';
}

async function saveOcrCorrection(idx) {
    const scan = allOcrScans[idx];
    if (!scan) return;
    const form = document.getElementById('ocr-correction-form');
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById('ocr-correction-status');
    const value = id => document.getElementById(`ocr-correct-${id}`).value.trim();
    const correctedData = {
        cell: value('cell'),
        qtyPack: value('qty') ? Number(value('qty')) : null,
        prefix: value('prefix') || null,
        zone: value('zone') || null
    };
    const filename = scan.json_path.replace(/\\/g, '/').split('/').pop();
    button.disabled = true;
    status.textContent = 'Збереження…';
    try {
        const response = await fetch(`/api/admin/training_data/${encodeURIComponent(filename)}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({carton_type: scan.carton_type, corrected_data: correctedData})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не вдалося зберегти виправлення');
        scan.corrected_data = data.corrected_data;
        scan.corrected_at = data.corrected_at;
        renderOcrScans();
        status.textContent = 'Виправлення збережено';
    } catch (error) {
        status.textContent = error.message || 'Помилка з’єднання';
    } finally {
        button.disabled = false;
    }
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

window.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(window.location.search).get('tab') === 'create-sort') {
        showAdminTab('sort');
        showSortSubtab('create-sort');
        document.getElementById('sort-mode').value = 'presort';
        updateSortPreview();
    }
});

// Оновити попередній перегляд сорту
function updateSortPreview() {
    const modeLabel = document.getElementById('sort-mode').value === 'presort' ? 'PRE-SORT' : 'SORT';
    document.getElementById('create-sort-submit').textContent = `✓ Створити ${modeLabel}`;
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

    previewText.textContent = `${modeLabel} · ${location} — ${types.join(' + ')}`;
    preview.style.display = 'block';
}

// Завантажити активні сорти
async function loadActiveSorts() {
    const request = ++adminTaskRequest;
    const container = document.getElementById('active-sorts-list');
    container.textContent = 'Завантаження завдань…';
    try {
        const sorts = await readAdminJson('/api/sorts/all');
        if (request !== adminTaskRequest) return;
        if (!Array.isArray(sorts)) throw new Error('Не вдалося прочитати список завдань');
        const filter = document.getElementById('admin-task-status')?.value || 'all';
        const visibleSorts = sorts.filter(sort => filter === 'all' || sort.status === filter);
        if (visibleSorts.length === 0) {
            container.textContent = sorts.length ? 'За вибраним статусом завдань немає.' : 'Завдань ще немає. Створіть SORT або Pre-sort у формі нижче.';
            return;
        }
        container.replaceChildren();
        for (const sort of visibleSorts) {
            const presort = sort.mode === 'presort';
            const card = document.createElement('article'); card.className = 'admin-task-card';
            const title = document.createElement('h4');
            title.dataset.noTranslate=''; title.textContent = `#${sort.id} · ${presort ? 'PRE-SORT' : 'SORT'} · ${sort.name}`;
            const status = document.createElement('p');
            status.textContent = `${{active:'Активний',closed:'Закритий',paused:'Призупинений'}[sort.status] || sort.status}${sort.unload_date ? ' · ' + sort.unload_date : ''}`;
            card.append(title, status);
            if (sort.description) {
                const notes = document.createElement('p'); notes.textContent = sort.description; notes.dataset.noTranslate=''; card.append(notes);
            }
            const types = document.createElement('p');
            types.textContent = `Типи картонів: ${String(sort.type || '').split(',').filter(Boolean).map(type => type.toUpperCase()).join(', ') || 'не вказано'}`;
            const source = document.createElement('p');
            source.textContent = presort ? 'Етап: розвантаження по палетах → закриття → SORT'
                : sort.has_presort_source || sort.has_presort_data ? 'Є дані Pre-sort для пошуку початкових палет.' : 'Звичайний SORT без даних Pre-sort.';
            card.append(types, source);
            const actions = document.createElement('div'); actions.className = 'admin-task-actions';
            const action = (label, className, handler) => {
                const button = document.createElement('button'); button.className = `btn btn-small ${className}`;
                button.textContent = label; button.onclick = handler; actions.append(button);
            };
            if (presort) {
                const link = document.createElement('a'); link.className = 'btn btn-small btn-primary';
                link.href = `/presort?sort_id=${sort.id}`; link.textContent = 'Відкрити Pre-sort'; actions.append(link);
            }
            if (presort || sort.has_presort_source || sort.has_presort_data) {
                action('Картони Pre-sort', 'btn-secondary', () => openAdminPresortJob(sort.id));
            }
            if (sort.status !== 'closed') action(`Закрити ${presort ? 'Pre-sort' : 'SORT'}`, 'btn-warning', () => closeSortConfirm(sort.id, sort.name));
            if (presort && sort.status === 'closed') action('Перевести в SORT', 'btn-success', () => convertPresortToSort(sort.id));
            action('Видалити завдання', 'btn-danger', event => deleteSortConfirm(sort.id, sort.name, event?.currentTarget));
            card.append(actions); container.append(card);
        }
    } catch (error) {
        if (request !== adminTaskRequest) return;
        console.error('Помилка завантаження сортів:', error);
        container.textContent = error.message;
    }
}

// Створити новий сорт
async function convertPresortToSort(sortId) {
    if (!confirm('Перевести закритий Pre-sort в SORT? Дані наклейок і номери палет збережуться.')) return;
    try {
        const response = await fetch(`/api/sorts/${sortId}/convert-to-sort`, {method: 'POST'});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не вдалося перевести в SORT');
        showToast('Pre-sort переведено в SORT. Дані палет збережено.', 'success');
        await loadActiveSorts();
    } catch (error) { showToast(error.message, 'error'); }
}

async function createNewSort() {
    if (creatingSort) return;
    const mode = document.getElementById('sort-mode').value;
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

    creatingSort = true;
    const submit = document.getElementById('create-sort-submit');
    submit.disabled = true;
    try {
        const response = await fetch('/api/sorts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mode: mode,
                name: location,
                type: types.join(','), // Зберігаємо як рядок через кому
                unload_date: unloadDate || new Date().toISOString().split('T')[0],
                description: notes
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast((mode === 'presort' ? 'Pre-sort' : 'Сорт') + ' створено: ' + location, 'success');

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
    } finally { creatingSort = false; submit.disabled = false; }
}

// Підтвердження закриття сорту
function closeSortConfirm(sortId, sortName) {
    if (confirm(`Ви впевнені, що хочете закрити сорт "${sortName}"?\n\nЗакритий сорт більше не буде доступний для користувачів.`)) {
        updateSortStatus(sortId, 'closed');
    }
}

// Підтвердження видалення сорту
async function deleteSortConfirm(sortId, sortName, button) {
    if (sortDeletionPending) return;
    sortDeletionPending = true;
    if (button) button.disabled = true;
    try {
        if (await showConfirm(`Ви точно хочете видалити цей сорт?\n\n#${sortId} · ${sortName}`, 'Видалити сорт?')) {
            await deleteSort(sortId);
        }
    } finally {
        sortDeletionPending = false;
        if (button) button.disabled = false;
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
            await loadActiveSorts();
        } else {
            showToast(data.error || 'Помилка видалення сорту', 'error');
        }
    } catch (error) {
        console.error('Помилка видалення сорту:', error);
        showToast('Помилка видалення сорту', 'error');
    }
}

