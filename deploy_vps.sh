#!/bin/bash
# ─────────────────────────────────────────────────────
# Patent Scope — Deploy Completo na VPS
# Uso: curl -fsSL <raw_url> | bash
# Ou:  bash deploy_vps.sh
# ─────────────────────────────────────────────────────
set -e

REPO_URL="https://github.com/leofigueiredop/remix-of-patent-compass.git"
APP_DIR="/opt/patent-scope"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   🔬 Patent Scope — Deploy Automático   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 1. Dependências ───────────────────────────────
echo "📦 [1/6] Verificando dependências..."
if ! command -v docker &> /dev/null; then
    echo "   → Instalando Docker..."
    curl -fsSL https://get.docker.com | bash
else
    echo "   ✅ Docker já instalado ($(docker --version | cut -d' ' -f3))"
fi

if ! docker compose version &> /dev/null; then
    echo "   ❌ Docker Compose não encontrado. Instale com: apt install docker-compose-plugin"
    exit 1
fi
echo "   ✅ Docker Compose OK"

# ─── 2. Clone / Pull ──────────────────────────────
echo ""
echo "📥 [2/6] Baixando código..."
if [ -d "$APP_DIR/.git" ]; then
    echo "   → Repositório já existe, atualizando..."
    cd "$APP_DIR"
    git pull --ff-only
else
    echo "   → Clonando repositório..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# ─── 3. Configuração (.env) ───────────────────────
echo ""
echo "⚙️  [3/6] Configurando ambiente..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "   ✅ .env criado a partir do .env.example"
    echo ""
    echo "   ⚠️  EDITE O .env ANTES DE CONTINUAR se quiser:"
    echo "      - Mudar senhas do Postgres"
    echo "      - Adicionar chaves da API Espacenet (OPS)"
    echo "      - Configurar VITE_API_URL para seu domínio"
    echo ""
    echo "   Para editar: nano $APP_DIR/.env"
    echo ""
    read -p "   Pressione ENTER para continuar com os defaults, ou Ctrl+C para editar primeiro... "
else
    echo "   ✅ .env já existe"
fi

# ─── 4. Build & Deploy ────────────────────────────
echo ""
echo "🐳 [4/6] Construindo e subindo containers..."
echo "   (Isso pode demorar 2-5 min na primeira vez)"
docker compose up -d --build

# ─── 5. Aguardar serviços ─────────────────────────
echo ""
echo "⏳ [5/6] Aguardando serviços ficarem prontos..."
sleep 10

# Verificar status dos containers
echo ""
echo "   Status dos containers:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# ─── 6. Baixar modelos LLM ────────────────────────
echo ""
echo "🧠 [6/6] Baixando modelos de IA (isso demora ~15min)..."

# Pega o nome dos modelos do .env ou usa defaults
PRIMARY_MODEL=$(grep OLLAMA_PRIMARY_MODEL .env 2>/dev/null | cut -d'=' -f2 || echo "qwen2.5:14b-instruct-q4_K_M")
SECONDARY_MODEL=$(grep OLLAMA_SECONDARY_MODEL .env 2>/dev/null | cut -d'=' -f2 || echo "llama3.1:8b-instruct-q4_K_M")

echo "   → Baixando modelo primário: $PRIMARY_MODEL"
docker compose exec -T ollama ollama pull "$PRIMARY_MODEL"

echo "   → Baixando modelo secundário: $SECONDARY_MODEL"
docker compose exec -T ollama ollama pull "$SECONDARY_MODEL"

# ─── Pronto! ──────────────────────────────────────
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || echo "<IP_DA_VPS>")

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         ✅ Deploy Concluído!             ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  Frontend: http://$VPS_IP:5173       ║"
echo "║  API:      http://$VPS_IP:3000       ║"
echo "║                                          ║"
echo "║  Logs:  docker compose logs -f           ║"
echo "║  Parar: docker compose down              ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
