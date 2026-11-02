// Показати таб Lider
const liderText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function showLiderTab(tab) {
    const tabs = document.querySelectorAll('.admin-tab-content');
    const btns = document.querySelectorAll('.tab-btn');

    tabs.forEach(t => t.style.display = 'none');
    btns.forEach(b => b.classList.remove('active'));

    const panel=document.getElementById('lider-' + tab);
    if(!panel)return;
    panel.style.display = 'block';
    document.querySelector(`.tab-btn[onclick*="'${tab}'"]`)?.classList.add('active');

    if (tab === 'sorts') {
        loadSorts();
    } else if (tab === 'containers') {
        loadContainers();
    } else if (tab === 'pallets') {
        loadPallets();
    } else if (tab === 'icc') {
        loadICCCodes();
    } else if (tab === 'users') {
        loadUsersActivity();
    }
}

// Завантажити сорти
async function loadSorts() {
    try {
        const response = await fetch('/api/sorts/all');
        const sorts = await response.json();

        const tbody = document.getElementById('sorts-table-body');
        tbody.innerHTML = '';

        if (sorts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">Немає сортів. Натисніть "Відкрити новий сорт" щоб створити.</td></tr>';
            return;
        }

        sorts.forEach(sort => {
            const row = document.createElement('tr');

            // Список користувачів, які працюють
            let workingUsersHTML = '';
            if (sort.working_users && sort.working_users.length > 0) {
                workingUsersHTML = sort.working_users.map(u => {
                    const time = new Date(u.started_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
                    return `<div style="background: #e3f2fd; padding: 0.5rem; border-radius: 6px; margin-bottom: 0.5rem;">
                        👤 <strong data-no-translate>${liderText(u.username)}</strong> <span style="color: #666; font-size: 0.85rem;">(з ${time})</span>
                    </div>`;
                }).join('');
            } else {
                workingUsersHTML = '<span style="color: #999;">Немає активних</span>';
            }

            // Прогрес
            let progressHTML = '';
            if (sort.icc_count > 0) {
                const completedPercent = sort.completed_count > 0 ? Math.round((sort.completed_count / sort.icc_count) * 100) : 0;
                progressHTML = `
                    <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.25rem;">
                        ${sort.completed_count} / ${sort.icc_count} ICC кодів
                    </div>
                    <div class="mini-progress">
                        <div class="mini-progress-fill" style="width: ${completedPercent}%"></div>
                    </div>
                `;
            } else {
                progressHTML = '<span style="color: #999;">Немає ICC кодів</span>';
            }

            // Статус
            let statusBadge = '';
            if (sort.status === 'active') {
                statusBadge = '<span class="badge badge-success">Активний</span>';
            } else if (sort.status === 'closed') {
                statusBadge = '<span class="badge badge-info">Закритий</span>';
            } else if (sort.status === 'paused') {
                statusBadge = '<span class="badge badge-warning">Призупинений</span>';
            }

            // Тип
            const typeLabels = {
                'single': 'Single',
                'mix': 'Mix',
                'single,mix': 'Single / Mix'
            };
            const typeLabel = typeLabels[sort.type] || sort.type;

            // Форматування дати
            const unloadDate = new Date(sort.unload_date).toLocaleDateString('uk-UA', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            // Дії
            const actionsHTML = `
                <div style="display: flex; gap: 0.5rem; flex-direction: column;">
                    ${sort.status === 'active' ?
                        '<button class="btn btn-small btn-warning" onclick="updateSortStatus(' + sort.id + ', \'paused\')">⏸ Призупинити</button>' : ''}
                    ${sort.status === 'paused' ?
                        '<button class="btn btn-small btn-success" onclick="updateSortStatus(' + sort.id + ', \'active\')">▶ Активувати</button>' : ''}
                    ${sort.status !== 'closed' ?
                        '<button class="btn btn-small btn-primary" onclick="updateSortStatus(' + sort.id + ', \'closed\')">✓ Закрити</button>' : ''}
                    <button class="btn btn-small btn-danger" data-delete-sort>🗑 Видалити</button>
                </div>
            `;

            row.innerHTML = `
                <td><strong data-no-translate style="font-size: 1.1rem;">${liderText(sort.name)}</strong></td>
                <td>${liderText(typeLabel)}</td>
                <td><strong>${unloadDate}</strong></td>
                <td style="max-width: 200px; white-space: pre-wrap; font-size: 0.9rem;">${liderText(sort.description) || '<span style="color: #999;">—</span>'}</td>
                <td>${workingUsersHTML}</td>
                <td>${progressHTML}</td>
                <td>${statusBadge}</td>
                <td>${actionsHTML}</td>
            `;
            row.querySelector('[data-delete-sort]').onclick=()=>deleteSortConfirm(sort.id,sort.name);
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Помилка завантаження сортів:', error);
        alert('Помилка завантаження сортів');
    }
}

// Показати модальне вікно створення сорту
function showCreateSortModal() {
    // Встановити сьогоднішню дату за замовчуванням
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('new-sort-date').value = today;

    document.getElementById('create-sort-modal').style.display = 'flex';
    setTimeout(() => {
        document.getElementById('new-sort-name').focus();
    }, 100);
}

// Закрити модальне вікно створення сорту
function closeCreateSortModal() {
    document.getElementById('create-sort-modal').style.display = 'none';
    document.getElementById('new-sort-name').value = '';
    document.getElementById('new-sort-type').value = 'single';
    document.getElementById('new-sort-date').value = '';
    document.getElementById('new-sort-description').value = '';
}

// Створити сорт
async function createSort() {
    const name = document.getElementById('new-sort-name').value.trim();
    const type = document.getElementById('new-sort-type').value;
    const unloadDate = document.getElementById('new-sort-date').value;
    const description = document.getElementById('new-sort-description').value.trim();

    if (!name) {
        alert('Введіть назву зони/рампи');
        return;
    }

    if (!unloadDate) {
        alert('Вкажіть дату розвантаження');
        return;
    }

    try {
        const response = await fetch('/api/sorts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                type: type,
                unload_date: unloadDate,
                description: description
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Сорт створено: ' + name);
            closeCreateSortModal();
            loadSorts();
        } else {
            alert(data.error || 'Помилка створення сорту');
        }
    } catch (error) {
        console.error('Помилка створення сорту:', error);
        alert('Помилка створення сорту');
    }
}

// Оновити статус сорту
async function updateSortStatus(sortId, newStatus) {
    const statusNames = {
        'active': 'активувати',
        'paused': 'призупинити',
        'closed': 'закрити'
    };

    if (!confirm(`Ви впевнені, що хочете ${statusNames[newStatus]} цей сорт?`)) {
        return;
    }

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
            alert('Статус оновлено');
            loadSorts();
        } else {
            alert(data.error || 'Помилка оновлення статусу');
        }
    } catch (error) {
        console.error('Помилка оновлення статусу:', error);
        alert('Помилка оновлення статусу');
    }
}

// Підтвердження видалення сорту
function deleteSortConfirm(sortId, sortName) {
    if (confirm(`Ви впевнені, що хочете видалити сорт "${sortName}"?\n\nУВАГА: Це видалить всі пов'язані дані!`)) {
        deleteSort(sortId);
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
            alert('Сорт видалено');
            loadSorts();
        } else {
            alert(data.error || 'Помилка видалення сорту');
        }
    } catch (error) {
        console.error('Помилка видалення сорту:', error);
        alert('Помилка видалення сорту');
    }
}

// Завантажити контейнери
async function loadContainers() {
    try {
        const response = await fetch('/api/containers/all');
        const containers = await response.json();

        const tbody = document.getElementById('containers-table-body');
        tbody.innerHTML = '';

        if (containers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">Немає контейнерів</td></tr>';
            return;
        }

        containers.forEach(container => {
            const row = document.createElement('tr');

            // Список користувачів, які працюють
            let workingUsersHTML = '';
            if (container.working_users && container.working_users.length > 0) {
                workingUsersHTML = container.working_users.map(u => {
                    const time = new Date(u.started_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
                    return `<div style="background: #e3f2fd; padding: 0.5rem; border-radius: 6px; margin-bottom: 0.5rem;">
                        👤 <strong data-no-translate>${liderText(u.username)}</strong> <span style="color: #666; font-size: 0.85rem;">(з ${time})</span>
                    </div>`;
                }).join('');
            } else {
                workingUsersHTML = '<span style="color: #999;">Немає активних</span>';
            }

            // Статус контейнера
            let statusBadge = '';
            if (container.status === 'active') {
                statusBadge = '<span class="badge badge-success">Активний</span>';
            } else if (container.status === 'completed') {
                statusBadge = '<span class="badge badge-info">Завершений</span>';
            } else if (container.status === 'paused') {
                statusBadge = '<span class="badge badge-warning">Призупинений</span>';
            }

            // Дії
            const actionsHTML = `
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${container.status === 'active' ?
                        '<button class="btn btn-small btn-warning" onclick="updateContainerStatus(' + container.id + ', \'paused\')">⏸ Призупинити</button>' : ''}
                    ${container.status === 'paused' ?
                        '<button class="btn btn-small btn-success" onclick="updateContainerStatus(' + container.id + ', \'active\')">▶ Активувати</button>' : ''}
                    ${container.status !== 'completed' ?
                        '<button class="btn btn-small btn-primary" onclick="updateContainerStatus(' + container.id + ', \'completed\')">✓ Завершити</button>' : ''}
                </div>
            `;

            row.innerHTML = `
                <td><strong style="font-size: 1.1rem;">${liderText(container.container_number)}</strong></td>
                <td>${workingUsersHTML}</td>
                <td>${statusBadge}</td>
                <td>${new Date(container.created_at).toLocaleString('uk-UA')}</td>
                <td>${actionsHTML}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Помилка завантаження контейнерів:', error);
        alert('Помилка завантаження контейнерів');
    }
}

// Показати модальне вікно створення контейнера
function showCreateContainerModal() {
    document.getElementById('create-container-modal').style.display = 'flex';
    setTimeout(() => {
        document.getElementById('new-container-number').focus();
    }, 100);
}

// Закрити модальне вікно створення контейнера
function closeCreateContainerModal() {
    document.getElementById('create-container-modal').style.display = 'none';
    document.getElementById('new-container-number').value = '';
}

// Створити контейнер
async function createContainer() {
    const containerNumber = document.getElementById('new-container-number').value.trim().toUpperCase();

    if (!containerNumber) {
        alert('Введіть номер контейнера');
        return;
    }

    try {
        const response = await fetch('/api/containers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ container_number: containerNumber })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Контейнер створено: ' + containerNumber);
            closeCreateContainerModal();
            loadContainers();
        } else {
            alert(data.error || 'Помилка створення контейнера');
        }
    } catch (error) {
        console.error('Помилка створення контейнера:', error);
        alert('Помилка створення контейнера');
    }
}

// Оновити статус контейнера
async function updateContainerStatus(containerId, newStatus) {
    const statusNames = {
        'active': 'активувати',
        'paused': 'призупинити',
        'completed': 'завершити'
    };

    if (!confirm(`Ви впевнені, що хочете ${statusNames[newStatus]} цей контейнер?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/containers/${containerId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Статус оновлено');
            loadContainers();
        } else {
            alert(data.error || 'Помилка оновлення статусу');
        }
    } catch (error) {
        console.error('Помилка оновлення статусу:', error);
        alert('Помилка оновлення статусу');
    }
}

// Enter для створення контейнера
document.addEventListener('DOMContentLoaded', () => {
    const containerInput = document.getElementById('new-container-number');
    if (containerInput) {
        containerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                createContainer();
            }
        });
    }
});

// Завантажити палети
async function loadPallets() {
    try {
        const response = await fetch('/api/lider/pallets');
        const data = await response.json();

        const tbody = document.getElementById('pallets-table-body');
        tbody.innerHTML = '';

        data.forEach(item => {
            const pallet = item.pallet;
            const icc = item.icc;
            const user = item.user;

            const row = document.createElement('tr');
            const statusText = pallet.is_closed ? 'Закрита' : 'Відкрита';
            const statusClass = pallet.is_closed ? 'badge-success' : 'badge-warning';

            row.innerHTML = `
                <td data-no-translate>${liderText(pallet.pallet_number)}</td>
                <td data-no-translate>${icc ? liderText(icc.icc_code) : '-'}</td>
                <td>${pallet.type.toUpperCase()}</td>
                <td>${pallet.cartons_count}</td>
                <td data-no-translate>${user ? liderText(user.username) : '-'}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>${new Date(pallet.created_at).toLocaleString('uk-UA')}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Помилка завантаження палет');
    }
}

// Завантажити ICC коди
async function loadICCCodes() {
    try {
        const response = await fetch('/api/lider/icc_codes');
        const codes = await response.json();

        const tbody = document.getElementById('icc-table-body');
        tbody.innerHTML = '';

        codes.forEach(icc => {
            const row = document.createElement('tr');

            let progressText;
            let progressBar;
            if (icc.type === 'mix') {
                progressText = `${icc.current_cartons} картонів`;
                progressBar = '<div class="mini-progress"><div class="mini-progress-fill" style="width: 50%"></div></div>';
            } else {
                const percentage = (icc.current_cartons / icc.total_cartons) * 100;
                progressText = `${icc.current_cartons} / ${icc.total_cartons}`;
                progressBar = `<div class="mini-progress"><div class="mini-progress-fill" style="width: ${percentage}%"></div></div>`;
            }

            const statusText = icc.is_completed ? 'Готово ✓' : 'В процесі';
            const statusClass = icc.is_completed ? 'badge-success' : 'badge-info';

            row.innerHTML = `
                <td><strong data-no-translate>${liderText(icc.icc_code)}</strong></td>
                <td>${icc.type.toUpperCase()}</td>
                <td>${progressBar}</td>
                <td>${progressText}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>${new Date(icc.created_at).toLocaleString('uk-UA')}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Помилка завантаження ICC кодів');
    }
}

// Завантажити активність користувачів
async function loadUsersActivity() {
    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();

        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');

            const roleLabel = user.role === 'admin' ? 'Admin' :
                            user.role === 'lider' ? 'Lider' : 'User';

            row.innerHTML = `
                <td data-no-translate>${liderText(user.username)}</td>
                <td><span class="badge badge-${user.role}">${roleLabel}</span></td>
                <td><strong>${user.total_cartons}</strong> картонів</td>
                <td>${new Date(user.created_at).toLocaleString('uk-UA')}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        alert('Помилка завантаження користувачів');
    }
}

// Завантажити сорти при завантаженні
loadSorts();
