#!/bin/bash
# setup_vps.sh
# Script de preparação para VPS Contabo (12 Cores / 48GB RAM)
# Uso: bash setup_vps.sh

set -e

echo "🚀 [1/4] Atualizando o sistema..."
apt update && apt upgrade -y
apt install -y curl wget git jq build-essential

echo "🧠 [2/4] Otimizando Kernel para AI (Ollama/Elastic)..."
# Aumenta limite de mmap para evitar que modelos grandes travem
if ! grep -q "vm.max_map_count" /etc/sysctl.conf; then
    echo "vm.max_map_count=262144" >> /etc/sysctl.conf
    sysctl -w vm.max_map_count=262144
    echo "✅ vm.max_map_count ajustado."
fi

echo "🐳 [3/4] Instalando Docker e Coolify..."
# Script oficial do Coolify (instala Docker se não existir)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

echo "✨ [4/4] Concluído!"
echo "Acesse o painel em: http://$(curl -s ifconfig.me):8000"
echo "Credenciais iniciais serão solicitadas no primeiro acesso."
echo ""
echo "⚠️  IMPORTANTE: No firewall da VPS, libere as portas 8000 (Coolify), 80/443 (Traefik) e 3000/5173 (Apps)."
