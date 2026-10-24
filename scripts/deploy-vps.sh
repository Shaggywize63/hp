#!/usr/bin/env bash
#
# One-shot deploy for the HP Dynamic Screensaver Dashboard on a Hostinger VPS
# (or any Ubuntu/Debian VPS). Serves the app under /hp and keeps it running
# with PM2. Run it on the VPS — either over SSH, or from hPanel's
# "Browser terminal" (VPS -> Overview -> Browser terminal).
#
#   curl -fsSL https://raw.githubusercontent.com/Shaggywize63/hp/main/scripts/deploy-vps.sh | sudo bash
#
# Override defaults with env vars, e.g.:
#   sudo BASE_PATH=/hp PORT=3000 APP_DIR=/var/www/hp bash deploy-vps.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Shaggywize63/hp.git}"
APP_DIR="${APP_DIR:-/var/www/hp}"
APP_NAME="${APP_NAME:-hp-dashboard}"
BASE_PATH="${BASE_PATH:-/hp}"
PORT="${PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-22}"

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (use: sudo bash $0)" >&2
  exit 1
fi

say "Installing prerequisites (Node ${NODE_MAJOR}, git, nginx, PM2) …"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git nginx
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 >/dev/null 2>&1 || npm install -g pm2

say "Fetching the application into ${APP_DIR} …"
if [ -d "${APP_DIR}/.git" ]; then
  git -C "${APP_DIR}" pull --ff-only
else
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone "${REPO_URL}" "${APP_DIR}"
fi
cd "${APP_DIR}"
npm install --omit=dev

# Persist a JWT secret across redeploys
SECRET_FILE="${APP_DIR}/.jwt_secret"
if [ ! -f "${SECRET_FILE}" ]; then
  (openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n') > "${SECRET_FILE}"
  chmod 600 "${SECRET_FILE}"
fi
JWT_SECRET="$(cat "${SECRET_FILE}")"

say "Starting the app under PM2 (BASE_PATH=${BASE_PATH}, PORT=${PORT}) …"
JWT_SECRET="${JWT_SECRET}" BASE_PATH="${BASE_PATH}" PORT="${PORT}" \
  pm2 start server/index.js --name "${APP_NAME}" --update-env || \
JWT_SECRET="${JWT_SECRET}" BASE_PATH="${BASE_PATH}" PORT="${PORT}" \
  pm2 restart "${APP_NAME}" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

say "Done. The app is running on 127.0.0.1:${PORT}${BASE_PATH}"
cat <<EOF

────────────────────────────────────────────────────────────────────────
  FINAL STEP — expose it on your domain (nginx).
  Add this INSIDE the existing  server { }  block for your domain
  (on Hostinger VPS the vhost is usually /etc/nginx/sites-available/<domain>),
  then run:  nginx -t && systemctl reload nginx

    location = ${BASE_PATH} { return 301 ${BASE_PATH}/; }
    location ${BASE_PATH}/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 2100m;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
    }

  Then open:  https://<your-domain>${BASE_PATH}/
  Log in as  s@kinematicapp.com / Manvik@1221  and change the password.
────────────────────────────────────────────────────────────────────────
EOF
