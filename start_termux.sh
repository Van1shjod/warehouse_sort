#!/data/data/com.termux/files/usr/bin/bash
# Run from the project directory with: bash start_termux.sh
set -Eeuo pipefail

container_name=warehouse-ubuntu
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# These entry points run inside the dedicated Ubuntu container.
if [[ "${1:-}" == --prepare ]]; then
    runtime_dir=/opt/warehouse-runtime
    python_bin="$runtime_dir/venv/bin/python"
    if [[ ! -f "$runtime_dir/ready-v1" ]] || ! "$python_bin" -c 'import flask, waitress, rapidocr_onnxruntime, cv2, numpy, PIL, onnxruntime' 2>/dev/null; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y python3 python3-venv ca-certificates libgl1 libglib2.0-0t64 libgomp1
        mkdir -p "$runtime_dir"
        python3 -m venv "$runtime_dir/venv"
        "$python_bin" -m pip install --upgrade pip
        "$python_bin" -m pip install --only-binary=numpy,opencv-python,onnxruntime,Pillow \
            'Flask==3.0.0' 'Werkzeug==3.0.1' 'waitress>=3.0,<4' \
            'rapidocr-onnxruntime==1.2.3' 'numpy>=1.26,<2' \
            'opencv-python>=4.8,<5' 'onnxruntime>=1.17,<2' 'Pillow>=10,<13'
        "$python_bin" -c 'import flask, waitress, rapidocr_onnxruntime, cv2, numpy, PIL, onnxruntime'
        touch "$runtime_dir/ready-v1"
    fi
    exit 0
fi

if [[ "${1:-}" == --serve ]]; then
    cd -- "$project_dir"
    export PYTHONUNBUFFERED=1
    exec /opt/warehouse-runtime/venv/bin/waitress-serve \
        --listen="127.0.0.1:$2" --threads=4 app:app
fi

if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
    printf '%s\n' 'Запуск у Termux: bash start_termux.sh' \
        'Інший порт: PORT=5050 bash start_termux.sh' \
        'Перший запуск встановлює Ubuntu 24.04, Python, OCR та Cloudflare.' \
        'Папка проєкту має бути в домашній папці Termux.' \
        'Зупинка сервера й тунелю: Ctrl+C.'
    exit 0
fi

if ! command -v pkg >/dev/null || [[ -z "${PREFIX:-}" ]]; then
    printf '%s\n' 'Цей файл потрібно запускати в Termux на Android.' >&2
    exit 1
fi
if [[ ! -f "$project_dir/app.py" || ! -f "$project_dir/database.py" ]]; then
    printf '%s\n' 'Помістіть start_termux.sh у папку Warehouse System поруч з app.py.' >&2
    exit 1
fi
case "$project_dir" in
    /storage/*|/sdcard/*|/mnt/media_rw/*)
        printf '%s\n' 'Скопіюйте всю папку проєкту в домашню папку Termux, наприклад ~/warehouse-system.' >&2
        exit 1
        ;;
esac
case "$(uname -m)" in
    aarch64|x86_64) ;;
    *) printf '%s\n' 'Для цього запуску OCR потрібен 64-бітний Termux (aarch64 або x86_64).' >&2; exit 1 ;;
esac

site_port="${PORT:-5000}"
if [[ ! "$site_port" =~ ^[0-9]{1,5}$ ]] || ((10#$site_port < 1024 || 10#$site_port > 65535)); then
    printf '%s\n' 'PORT має бути числом від 1024 до 65535.' >&2
    exit 1
fi
site_port="$((10#$site_port))"

missing_packages=()
for package in python cloudflared proot-distro; do
    command -v "$package" >/dev/null || missing_packages+=("$package")
done
command -v flock >/dev/null || missing_packages+=(util-linux)
if ((${#missing_packages[@]})); then
    pkg update -y
    pkg install -y "${missing_packages[@]}"
fi

state_dir="$project_dir/.termux"
mkdir -p "$state_dir"
exec 9>"$state_dir/start.lock"
if ! flock -n 9; then
    printf '%s\n' 'Цей проєкт уже запускається або працює в іншому вікні Termux.' >&2
    exit 1
fi

server_pid=''
tunnel_pid=''
wake_locked=0
cleanup() {
    trap - EXIT INT TERM HUP
    if [[ -n "$tunnel_pid" ]]; then kill "$tunnel_pid" 2>/dev/null || true; fi
    if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
    if [[ -n "$tunnel_pid" ]]; then wait "$tunnel_pid" 2>/dev/null || true; fi
    if [[ -n "$server_pid" ]]; then wait "$server_pid" 2>/dev/null || true; fi
    if ((wake_locked)); then termux-wake-unlock >/dev/null 2>&1 || true; fi
    printf '\n%s\n' 'Запуск Warehouse System завершено.'
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

python - "$site_port" <<'PY'
import socket
import sys
with socket.socket() as sock:
    try:
        sock.bind(('127.0.0.1', int(sys.argv[1])))
    except OSError:
        sys.exit('Порт зайнятий. Запустіть з іншим портом, наприклад PORT=5050 bash start_termux.sh')
PY

if command -v termux-wake-lock >/dev/null && termux-wake-lock; then wake_locked=1; fi

# Ubuntu 24.04 provides Python 3.12 and Linux aarch64 wheels for OCR.
if ! proot-distro login "$container_name" -- /bin/true >/dev/null 2>&1; then
    printf '%s\n' 'Встановлення Ubuntu 24.04 для Warehouse System…'
    proot-distro install ubuntu:24.04 --name "$container_name"
fi
printf '%s\n' 'Перевірка та встановлення залежностей…'
proot-distro login --bind "$project_dir:/opt/warehouse-system" "$container_name" -- \
    bash /opt/warehouse-system/start_termux.sh --prepare

# Take a consistent SQLite backup before app.py can run schema migrations.
python - "$project_dir" <<'PY'
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
root = Path(sys.argv[1])
source = root / 'warehouse.db'
if source.exists():
    backups = root / '.termux' / 'backups'
    backups.mkdir(exist_ok=True)
    name = datetime.now(timezone.utc).strftime('warehouse-%Y%m%d-%H%M%S-%f.db')
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(backups / name) as backup:
            original.backup(backup)
    print('Резервна копія бази:', backups / name, flush=True)
PY

printf '{}\n' > "$state_dir/quick-tunnel.yml"
proot-distro login --bind "$project_dir:/opt/warehouse-system" "$container_name" -- \
    bash /opt/warehouse-system/start_termux.sh --serve "$site_port" \
    > "$state_dir/server.log" 2>&1 &
server_pid=$!

server_ready=0
for ((attempt=0; attempt<90; attempt++)); do
    kill -0 "$server_pid" 2>/dev/null || break
    if python - "$site_port" <<'PY' >/dev/null 2>&1
import sys
import urllib.request
with urllib.request.urlopen('http://127.0.0.1:' + sys.argv[1] + '/', timeout=1) as response:
    assert response.status == 200
PY
    then server_ready=1; break; fi
    sleep 1
done
if ((!server_ready)); then
    printf '%s\n' 'Сервер не запустився. Останні повідомлення:' >&2
    tail -n 30 "$state_dir/server.log" >&2
    exit 1
fi

printf '%s\n' 'Сервер працює. Створення Cloudflare Tunnel…'
cloudflared tunnel --config "$state_dir/quick-tunnel.yml" --no-autoupdate \
    --protocol http2 --url "http://127.0.0.1:$site_port" \
    > "$state_dir/cloudflared.log" 2>&1 &
tunnel_pid=$!

public_url=''
for ((attempt=0; attempt<90; attempt++)); do
    kill -0 "$server_pid" 2>/dev/null && kill -0 "$tunnel_pid" 2>/dev/null || break
    public_url="$(python - "$state_dir/cloudflared.log" <<'PY'
import re
import sys
from pathlib import Path
urls = re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', Path(sys.argv[1]).read_text(errors='replace'))
print(urls[0] if urls else '')
PY
    )"
    [[ -n "$public_url" ]] && break
    sleep 1
done
if [[ -z "$public_url" ]]; then
    printf '%s\n' 'Cloudflare не надав посилання. Останні повідомлення:' >&2
    tail -n 30 "$state_dir/cloudflared.log" >&2
    exit 1
fi

printf '%s\n' "$public_url" > "$state_dir/last-url.txt"
printf '\n%s\n%s\n\n' 'Адреса вашого сайту' "$public_url"
printf '%s\n' 'Після нового запуску Cloudflare адреса зміниться.' \
    'Залишайте Termux відкритим. Для зупинки натисніть Ctrl+C.' \
    "Журнали зберігаються в $state_dir"
if command -v termux-open-url >/dev/null; then termux-open-url "$public_url" || true; fi

while kill -0 "$server_pid" 2>/dev/null && kill -0 "$tunnel_pid" 2>/dev/null; do
    sleep 3
done
printf '%s\n' 'Сервер або тунель зупинився. Останні повідомлення:' >&2
tail -n 15 "$state_dir/server.log" "$state_dir/cloudflared.log" >&2
exit 1
