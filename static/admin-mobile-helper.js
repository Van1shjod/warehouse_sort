// Автоматичне додавання data-label атрибутів для мобільних таблиць
function addMobileTableLabels() {
    // Таблиця користувачів
    const usersTable = document.querySelector('#users-table-body');
    if (usersTable) {
        const labels = ['ID', 'Логін', 'Роль', 'Статус', 'Картонів', 'Реєстрація', 'Дії'];
        usersTable.querySelectorAll('tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (labels[index]) td.setAttribute('data-label', labels[index]);
            });
        });
    }

    // Таблиця активності
    const activityTable = document.querySelector('#activity-table-body');
    if (activityTable) {
        const labels = ['Час', 'Користувач', 'Дія', 'Деталі'];
        activityTable.querySelectorAll('tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (labels[index]) td.setAttribute('data-label', labels[index]);
            });
        });
    }

    // Таблиця сортування (в процесі)
    const sortingTable = document.querySelector('#sorting-table-body');
    if (sortingTable) {
        const labels = ['ICC Код', 'Тип', 'Прогрес', 'Локація', 'Відкриті палети', 'Статус', 'Дії'];
        sortingTable.querySelectorAll('tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (labels[index]) td.setAttribute('data-label', labels[index]);
            });
        });
    }

    // Таблиця завершених
    const completedTable = document.querySelector('#completed-table-body');
    if (completedTable) {
        const labels = ['ICC Код', 'Тип', 'Кількість', 'Локація', 'Палет', 'Створено', 'Дії'];
        completedTable.querySelectorAll('tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (labels[index]) td.setAttribute('data-label', labels[index]);
            });
        });
    }

    // Таблиця палет
    const palletsTable = document.querySelector('#pallets-table-body');
    if (palletsTable) {
        const labels = ['Номер палети', 'Тип', 'Товар / локація', 'Картонів', 'Працівник', 'Статус', 'Створено'];
        palletsTable.querySelectorAll('tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (labels[index]) td.setAttribute('data-label', labels[index]);
            });
        });
    }
}

// MutationObserver для автоматичного оновлення при зміні вмісту таблиць
const tableObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // Затримка для завершення рендерингу
            setTimeout(() => addMobileTableLabels(), 50);
        }
    });
});

// Спостереження за змінами в tbody елементах
document.addEventListener('DOMContentLoaded', () => {
    addMobileTableLabels();

    // Спостерігаємо за всіма tbody
    const tableBodyIds = [
        'users-table-body',
        'activity-table-body',
        'sorting-table-body',
        'completed-table-body',
        'pallets-table-body'
    ];

    tableBodyIds.forEach(id => {
        const tbody = document.getElementById(id);
        if (tbody) {
            tableObserver.observe(tbody, {
                childList: true,
                subtree: true
            });
        }
    });

    // Також додаємо при переключенні табів
    const tabButtons = document.querySelectorAll('.tab-btn, .sort-subtab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(() => addMobileTableLabels(), 100);
        });
    });
});

// Покращення для мобільних пристроїв
document.addEventListener('DOMContentLoaded', () => {
    // Плавний скрол для табів
    const adminTabs = document.querySelector('.admin-tabs');
    const sortSubtabs = document.querySelector('.sort-subtabs');

    if (adminTabs) {
        let isDown = false;
        let startX;
        let scrollLeft;

        adminTabs.addEventListener('mousedown', (e) => {
            isDown = true;
            adminTabs.style.cursor = 'grabbing';
            startX = e.pageX - adminTabs.offsetLeft;
            scrollLeft = adminTabs.scrollLeft;
        });

        adminTabs.addEventListener('mouseleave', () => {
            isDown = false;
            adminTabs.style.cursor = 'default';
        });

        adminTabs.addEventListener('mouseup', () => {
            isDown = false;
            adminTabs.style.cursor = 'default';
        });

        adminTabs.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - adminTabs.offsetLeft;
            const walk = (x - startX) * 2;
            adminTabs.scrollLeft = scrollLeft - walk;
        });
    }

    // Автоматичне прокручування активної кнопки в зону видимості
    const scrollActiveIntoView = (container) => {
        const activeBtn = container.querySelector('.active');
        if (activeBtn) {
            activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    };

    if (adminTabs) {
        setTimeout(() => scrollActiveIntoView(adminTabs), 300);
    }

    if (sortSubtabs) {
        setTimeout(() => scrollActiveIntoView(sortSubtabs), 300);
    }

    // Покращена обробка для фільтрів
    const filterContainers = document.querySelectorAll('.filter-buttons, [style*="flex-wrap"]');
    filterContainers.forEach(container => {
        const buttons = container.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                setTimeout(() => {
                    const activeBtn = container.querySelector('.active');
                    if (activeBtn) {
                        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }, 100);
            });
        });
    });

    // Додати індикатор завантаження для кращого UX
    const showLoadingIndicator = (element) => {
        if (element) {
            element.style.opacity = '0.5';
            element.style.pointerEvents = 'none';
        }
    };

    const hideLoadingIndicator = (element) => {
        if (element) {
            element.style.opacity = '1';
            element.style.pointerEvents = 'auto';
        }
    };

    // Перехоплення fetch для показу індикатора завантаження
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const container = document.querySelector('.container');
        showLoadingIndicator(container);

        return originalFetch.apply(this, args)
            .finally(() => {
                hideLoadingIndicator(container);
            });
    };
});

// Функція для покращення відображення великих таблиць на мобільних
function optimizeLargeTables() {
    const tables = document.querySelectorAll('.data-table');
    tables.forEach(table => {
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length > 50) {
            // Віртуалізація для великих таблиць (показуємо по 20 записів)
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'btn btn-secondary';
            showMoreBtn.textContent = 'Показати більше';
            showMoreBtn.style.width = '100%';
            showMoreBtn.style.marginTop = '1rem';

            let visibleCount = 20;

            const updateVisibility = () => {
                rows.forEach((row, index) => {
                    row.style.display = index < visibleCount ? '' : 'none';
                });

                if (visibleCount >= rows.length) {
                    showMoreBtn.style.display = 'none';
                }
            };

            showMoreBtn.addEventListener('click', () => {
                visibleCount += 20;
                updateVisibility();
            });

            updateVisibility();
            table.parentElement.appendChild(showMoreBtn);
        }
    });
}

// Покращення для touch-пристроїв
if ('ontouchstart' in window) {
    document.addEventListener('DOMContentLoaded', () => {
        // Додати клас для touch-пристроїв
        document.body.classList.add('touch-device');

        // Покращити натискання для кнопок
        const allButtons = document.querySelectorAll('button, .btn');
        allButtons.forEach(btn => {
            btn.addEventListener('touchstart', function() {
                this.style.transform = 'scale(0.95)';
            });

            btn.addEventListener('touchend', function() {
                this.style.transform = '';
            });
        });
    });
}
