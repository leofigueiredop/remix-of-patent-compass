#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi
  echo "Este script precisa de root (ou sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  wget \
  fonts-liberation \
  libasound2t64 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/google-linux-signing-keyring.gpg ]]; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-linux-signing-keyring.gpg
fi

cat >/etc/apt/sources.list.d/google-chrome.list <<EOF
deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux-signing-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main
EOF

apt-get update
if apt-get install -y --no-install-recommends google-chrome-stable; then
  echo "Chrome instalado: $(command -v google-chrome-stable)"
else
  echo "Falha ao instalar google-chrome-stable. Tentando chromium-browser..." >&2
  apt-get install -y --no-install-recommends chromium-browser || apt-get install -y --no-install-recommends chromium
fi

apt-get clean
rm -rf /var/lib/apt/lists/*

echo "OK. Defina no ambiente:"
echo "PUPPETEER_EXECUTABLE_PATH=$(command -v google-chrome-stable || command -v google-chrome || command -v chromium-browser || command -v chromium)"
