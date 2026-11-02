async function testAPI() {
    const resultDiv = document.getElementById('result');

    try {
        const response = await fetch('/api/data');
        const data = await response.json();

        resultDiv.innerHTML = `<strong>Відповідь API:</strong> ${data.message}`;
        resultDiv.classList.add('show');
    } catch (error) {
        resultDiv.innerHTML = `<strong>Помилка:</strong> ${error.message}`;
        resultDiv.classList.add('show');
    }
}
