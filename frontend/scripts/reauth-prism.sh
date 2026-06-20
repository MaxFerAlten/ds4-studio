#!/usr/bin/env bash
set -euo pipefail

# Reauth Prism: extract cookies directly from Chrome's SQLite database
# No headless Chrome needed — decrypts cookies offline using Local State key.
# Usage: ./reauth-prism.sh

CONFIG_FILE=${HOME}/.config/prism-pp-cli/config.toml
CHROME_USER_DATA=${PRISM_CHROME_USER_DATA:-${HOME}/.config/google-chrome}
CHROME_PROFILE="${PRISM_CHROME_PROFILE:-Profile 1}"
PRISM_REAUTH_URL="${PRISM_REAUTH_URL:-https://prism.openai.com/}"
PRISM_REAUTH_WAIT_SECONDS="${PRISM_REAUTH_WAIT_SECONDS:-180}"
PRISM_REAUTH_POLL_SECONDS="${PRISM_REAUTH_POLL_SECONDS:-2}"
TMP_DB=/tmp/reauth-prism-cookies.db
TMP_PY=/tmp/reauth-prism-extract.py

resolve_python() {
    if [[ -n "${PRISM_REAUTH_PYTHON:-}" ]]; then
        if [[ -x "$PRISM_REAUTH_PYTHON" ]]; then
            printf '%s\n' "$PRISM_REAUTH_PYTHON"
            return 0
        fi
        echo "ERROR: PRISM_REAUTH_PYTHON is set but not executable: $PRISM_REAUTH_PYTHON" >&2
        return 127
    fi

    if [[ -x /tmp/pyenve/bin/python3 ]]; then
        printf '%s\n' /tmp/pyenve/bin/python3
        return 0
    fi

    if command -v python3 >/dev/null 2>&1; then
        command -v python3
        return 0
    fi

    echo "ERROR: python3 not found. Install python3 or set PRISM_REAUTH_PYTHON=/path/to/python3." >&2
    return 127
}

PYTHON="$(resolve_python)"

cleanup() {
    rm -f "$TMP_DB" "${TMP_DB}-wal" "${TMP_DB}-shm" "$TMP_PY"
}
trap cleanup EXIT

COOKIES_SRC="$CHROME_USER_DATA/$CHROME_PROFILE/Cookies"

copy_cookies_db() {
    if [[ ! -f "$COOKIES_SRC" ]]; then
        echo "ERROR: Chrome cookies DB not found: $COOKIES_SRC" >&2
        return 1
    fi

    rm -f "$TMP_DB" "${TMP_DB}-wal" "${TMP_DB}-shm"
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$COOKIES_SRC" ".backup '$TMP_DB'"
    else
        cp "$COOKIES_SRC" "$TMP_DB"
        cp "${COOKIES_SRC}-wal" "${TMP_DB}-wal" 2>/dev/null || true
        cp "${COOKIES_SRC}-shm" "${TMP_DB}-shm" 2>/dev/null || true
    fi
}

open_prism_login_tab() {
    echo "Opening Prism login tab: $PRISM_REAUTH_URL" >&2

    if [[ -n "${PRISM_REAUTH_BROWSER:-}" ]]; then
        "$PRISM_REAUTH_BROWSER" "$PRISM_REAUTH_URL" >/dev/null 2>&1 &
        return 0
    fi

    local browser
    for browser in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
        if command -v "$browser" >/dev/null 2>&1; then
            "$browser" \
                --user-data-dir="$CHROME_USER_DATA" \
                --profile-directory="$CHROME_PROFILE" \
                "$PRISM_REAUTH_URL" >/dev/null 2>&1 &
            return 0
        fi
    done

    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$PRISM_REAUTH_URL" >/dev/null 2>&1 &
        return 0
    fi

    echo "ERROR: no browser opener found. Open $PRISM_REAUTH_URL manually, sign in, then rerun Reauth." >&2
    return 127
}

# 2. Write Python decryption script
cat << 'EOF' > "$TMP_PY"
import sqlite3
import json
import sys
import os
import hashlib
import subprocess
import urllib.error
import urllib.request

CONFIG_FILE = os.path.expanduser('~/.config/prism-pp-cli/config.toml')
TMP_DB = '/tmp/reauth-prism-cookies.db'
DOMAIN_FILTER = 'prism.openai.com'
VALIDATE_URL = os.environ.get('PRISM_REAUTH_VALIDATE_URL', 'https://prism.openai.com/api/projects')
VALIDATE_TIMEOUT = float(os.environ.get('PRISM_REAUTH_VALIDATE_TIMEOUT', '10'))

def derive_chrome_key(password):
    if isinstance(password, str):
        password = password.encode('utf-8')
    return hashlib.pbkdf2_hmac('sha1', password, b'saltysalt', 1, dklen=16)

def lookup_secret_tool_password():
    """Return Chrome's libsecret password via secret-tool when python-secretstorage is unavailable."""
    commands = [
        ['secret-tool', 'lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2', 'application', 'chrome'],
        ['secret-tool', 'lookup', 'application', 'chrome'],
    ]
    for command in commands:
        try:
            secret = subprocess.check_output(command, stderr=subprocess.DEVNULL, timeout=2).rstrip(b'\n')
        except (FileNotFoundError, subprocess.SubprocessError):
            continue
        if secret:
            return secret
    return None

def get_chrome_password():
    """Return Chrome's Safe Storage password on Linux."""
    try:
        import secretstorage
        bus = secretstorage.dbus_init()
        collection = secretstorage.get_default_collection(bus)
        if collection.is_locked():
            collection.unlock()
        for item in collection.get_all_items():
            if item.get_label() == 'Chrome Safe Storage':
                return item.get_secret()
    except Exception:
        pass

    password = lookup_secret_tool_password()
    if password:
        return password

    return b'peanuts'

def get_chrome_key():
    """Return the AES key Chrome uses to encrypt cookie values on Linux."""
    return derive_chrome_key(get_chrome_password())

def is_cookie_value_safe(value):
    if not value:
        return False
    for ch in value:
        code = ord(ch)
        if code < 0x21 or code > 0x7e or ch in '",;\\':
            return False
    return True

def toml_basic_string(value):
    return json.dumps(value, ensure_ascii=False)

def validate_cookie_header(cookie_str):
    if os.environ.get('PRISM_REAUTH_SKIP_VALIDATE') == '1':
        return 200

    request = urllib.request.Request(
        VALIDATE_URL,
        headers={
            'Accept': 'application/json',
            'Cookie': cookie_str,
            'User-Agent': 'ds4-studio-prism-reauth/1.0',
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=VALIDATE_TIMEOUT) as response:
            status = response.getcode()
            if 200 <= status < 300:
                return status
            print(f'ERROR: prism cookies rejected by /api/projects: HTTP {status}', file=sys.stderr)
            sys.exit(2 if status in (401, 403) else 1)
    except urllib.error.HTTPError as e:
        detail = e.read(240).decode('utf-8', errors='replace')
        print(f'ERROR: prism cookies rejected by /api/projects: HTTP {e.code}: {detail}', file=sys.stderr)
        sys.exit(2 if e.code in (401, 403) else 1)
    except Exception as e:
        print(f'ERROR: prism cookie validation failed: {e}', file=sys.stderr)
        sys.exit(1)

def decrypt_cookie_value(host_key, plain_value, encrypted_value, key):
    """Decrypt a Chrome cookie value on Linux."""
    if plain_value and is_cookie_value_safe(plain_value):
        return plain_value
    if not encrypted_value:
        return ''
    if encrypted_value[:3] in (b'v10', b'v11'):
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            # Linux Chrome v10 and v11 both use AES-128-CBC with IV = 16 spaces.
            # The key is derived via PBKDF2(sha1, password, 'saltysalt', 1, 16).
            iv = b' ' * 16
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
            decryptor = cipher.decryptor()
            decrypted = decryptor.update(encrypted_value[3:]) + decryptor.finalize()
            
            # Remove PKCS7 padding
            pad_len = decrypted[-1]
            if not 1 <= pad_len <= 16:
                return ''
            decrypted = decrypted[:-pad_len]

            # Chrome stores SHA256(host_key) before the actual cookie value.
            # Verify it so a wrong Safe Storage key cannot turn into random cookies.
            if len(decrypted) < 32:
                return ''
            expected_digest = hashlib.sha256(host_key.encode('utf-8')).digest()
            if decrypted[:32] != expected_digest:
                return ''

            value = decrypted[32:].decode('utf-8')
            return value if is_cookie_value_safe(value) else ''
        except Exception as e:
            return ''
    try:
        value = encrypted_value.decode('utf-8')
        return value if is_cookie_value_safe(value) else ''
    except Exception:
        return ''

# --- Main ---
key = get_chrome_key()

conn = sqlite3.connect(f'file:{TMP_DB}?mode=ro', uri=True)
cursor = conn.cursor()
cursor.execute(
    'SELECT host_key, name, value, encrypted_value FROM cookies '
    'WHERE host_key LIKE ?',
    (f'%{DOMAIN_FILTER}%',)
)
rows = cursor.fetchall()
conn.close()

cookies = []
for host_key, name, plain_value, encrypted_value in rows:
    value = decrypt_cookie_value(host_key, plain_value, encrypted_value, key)
    if value:
        cookies.append({'name': name, 'value': value, 'domain': host_key})

cookies.sort(key=lambda c: c['name'])

if not cookies:
    print('ERROR: no prism cookies found in Chrome profile', file=sys.stderr)
    sys.exit(2)

cookie_str = '; '.join([f'{c["name"]}={c["value"]}' for c in cookies])
validation_status = validate_cookie_header(cookie_str)

os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
with open(CONFIG_FILE, 'w') as f:
    f.write(f"""base_url = 'https://prism.openai.com'
access_token = ''
refresh_token = ''
token_expiry = 0001-01-01T00:00:00Z
client_id = ''
client_secret = ''
auth_header = ''
cookies = {toml_basic_string(cookie_str)}
""")

# Write matching browser session proof
import datetime
proof_file = os.path.join(os.path.dirname(CONFIG_FILE), 'browser-session-proof.json')
fingerprint = hashlib.sha256(cookie_str.encode('utf-8')).hexdigest()[:16]
verified_at = datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
proof_data = {
    'api_name': 'prism',
    'cookie_domain': '.prism.openai.com',
    'validation_method': 'GET',
    'validation_path': '/api/projects',
    'status_code': validation_status,
    'auth_source': 'browser',
    'credential_fingerprint': fingerprint,
    'verified_at': verified_at
}
with open(proof_file, 'w') as f:
    json.dump(proof_data, f, indent=2)

print(f'OK: {len(cookies)} cookies extracted ({len(cookie_str)} chars) and proof updated')
EOF

run_extractor() {
    copy_cookies_db || return $?
    "$PYTHON" "$TMP_PY"
}

if run_extractor; then
    exit 0
else
    status=$?
fi

if [[ "$status" -ne 2 ]]; then
    exit "$status"
fi

open_prism_login_tab
echo "Waiting up to ${PRISM_REAUTH_WAIT_SECONDS}s for Prism cookies in Chrome profile '$CHROME_PROFILE'..." >&2

deadline=$(( $(date +%s) + PRISM_REAUTH_WAIT_SECONDS ))
while [[ "$(date +%s)" -le "$deadline" ]]; do
    sleep "$PRISM_REAUTH_POLL_SECONDS"
    if run_extractor; then
        exit 0
    else
        status=$?
    fi
    if [[ "$status" -ne 2 ]]; then
        exit "$status"
    fi
done

echo "ERROR: no prism cookies found after opening Prism. Complete login in the opened tab and run Reauth again." >&2
exit 2
