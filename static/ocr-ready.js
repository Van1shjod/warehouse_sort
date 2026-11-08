/* Ignore readiness responses from closed/reopened camera sessions. */
(() => {
    let generation = 0;
    let ready = false;
    const panel = () => document.getElementById('ocr-preparation');
    const capture = () => document.getElementById('camera-capture');
    const failure = 'Не вдалося підготувати сканер. Закрийте камеру та спробуйте ще раз.';
    window.ocrReadiness = {
        get ready() { return ready; },
        cancel() {
            generation++;
            ready = false;
            panel().hidden = true;
            capture().disabled = true;
        },
        async prepare() {
            const session = ++generation;
            ready = false;
            panel().hidden = false;
            try {
                let response = await fetch('/api/ocr/status', {cache: 'no-store'});
                if (!response.ok) throw new Error(failure);
                let data = await response.json();
                if (session !== generation) return false;
                if (!data.ready) {
                    response = await fetch('/api/ocr/prepare', {method: 'POST'});
                    if (!response.ok) throw new Error(failure);
                    data = await response.json();
                }
                if (session !== generation) return false;
                if (data.ready !== true) throw new Error(failure);
                ready = true;
                panel().hidden = true;
                // Preparation is informational; capture may already be waiting on the server.
                return true;
            } catch (_) {
                if (session !== generation) return false;
                panel().hidden = true;
                throw new Error(failure);
            }
        }
    };
})();
