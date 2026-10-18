// Перемикання між формами входу та реєстрації
function showTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => btn.classList.remove('active'));

    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        tabBtns[0].classList.add('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        tabBtns[1].classList.add('active');
    }

    clearError();
}

// Показати помилку
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Очистити помилку
function clearError() {
    const errorDiv = document.getElementById('error-message');
    errorDiv.style.display = 'none';
}

// Обробка входу
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            window.location.href = '/dashboard';
        } else {
            showError(data.error || 'Помилка входу');
        }
    } catch (error) {
        showError('Помилка підключення до сервера');
    }
});

// Обробка реєстрації
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;

    if (password !== passwordConfirm) {
        showError('Паролі не співпадають');
        return;
    }

    if (password.length < 4) {
        showError('Пароль має бути не менше 4 символів');
        return;
    }

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Реєстрація успішна! Тепер можете увійти.');
            showTab('login');
            document.getElementById('login-username').value = username;
        } else {
            showError(data.error || 'Помилка реєстрації');
        }
    } catch (error) {
        showError('Помилка підключення до сервера');
    }
});
