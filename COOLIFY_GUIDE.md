# Guia de Deploy com Coolify (VPS High Performance)

Este guia explica como implantar a stack do **Patent Scope Remix** (Frontend, Backend, Ollama, Whisper) na sua nova VPS Contabo usando **Coolify**.

## Pré-requisitos
- VPS Contabo instalada com **Ubuntu 22.04** ou **24.04**.
- Acesso root via SSH.
- Um domínio (ex: `app.seudominio.com`) apontado para o IP da VPS.

## 0. Configurar DNS (Apontar Domínio)
Antes de tudo, você precisa ir no painel onde comprou seu domínio (Godaddy, Registro.br, Hostinger, etc.) e criar os apontamentos para o IP da sua nova VPS Contabo.

Supondo que seu domínio seja `meusite.com` e o IP da VPS seja `123.456.78.90`:

| Tipo | Nome (Host) | Valor (Destino) | O que faz? |
| :--- | :--- | :--- | :--- |
| **A** | `painel` | `123.456.78.90` | Acessar o Coolify em `painel.meusite.com` |
| **A** | `app` | `123.456.78.90` | Acessar o Frontend em `app.meusite.com` |
| **A** | `api` | `123.456.78.90` | Acessar o Backend em `api.meusite.com` |

*Aguarde alguns minutos após criar os registros para que a propagação ocorra.*

## 0.1 Configurar Firewall (UFW)
O script de instalação não altera o firewall automaticamente para evitar conflitos. Na Contabo, você deve liberar as portas manualmente. Conecte-se via SSH e rode:

```bash
ufw allow 8000/tcp  # Painel Coolify
ufw allow 80/tcp    # HTTP (Traefik)
ufw allow 443/tcp   # HTTPS (Traefik)
ufw allow 3000/tcp  # API Backend
ufw allow 5173/tcp  # Frontend
ufw allow 22/tcp    # SSH (Evitar bloqueio)
ufw enable          # Ativa o firewall se estiver desligado
```

---

## 1. Instalar o Coolify
Conecte-se na sua VPS e rode o comando oficial de instalação:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Após a instalação, acesse o painel no navegador: `http://<IP_DA_VPS>:8000`. Crie sua conta de administrador.

---

## 2. Criar o Projeto
1. No painel do Coolify, vá em **Projects** -> **+ New Project**.
2. Dê um nome (ex: "PatentScope").
3. Selecione o ambiente "Production".
4. Clique em **+ New Resource**.

---

## 3. Importar Docker Compose
O método mais fácil é usar a opção "Docker Compose".

1. Selecione **Docker Compose**.
2. Copie o conteúdo do nosso arquivo `docker-compose.yml` (já otimizado para sua máquina de 12 cores):

```yaml
services:
  # Frontend (Vite)
  web:
    build: .
    ports:
      - "5173" # Coolify vai gerenciar a porta externa
    environment:
      - VITE_API_URL=https://api.seudominio.com # Ajuste para seu domínio real
    depends_on:
      - api

  # Backend Orchestrator (Node.js)
  api:
    build: ./backend
    ports:
      - "3000"
    environment:
      - PORT=3000
      - OLLAMA_BASE_URL=http://ollama:11434
      - WHISPER_BASE_URL=http://whisper:8000
    depends_on:
      - ollama
      - whisper

  # Local LLM Service (DeepSeek R1)
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_NUM_PARALLEL=4        # 4 requisições simultâneas
      - OLLAMA_MAX_LOADED_MODELS=2   # Mantém chat e embedding prontos
      - OLLAMA_KEEP_ALIVE=24h        # Mantém na RAM (48GB permite isso!)

  # Speech-to-Text Service (Whisper)
  whisper:
    image: fedirz/faster-whisper-server:latest-cpu
    ports:
      - "8000"
    environment:
      - WHISPER_MODEL=medium         # Modelo equilibrado
      - WHISPER_BEAM_SIZE=5
      - WHISPER_COMPUTE_TYPE=int8    # OTIMIZAÇÃO: Usa int8 para CPU rápida
      - WHISPER_DEVICE=cpu
      - WHISPER_NUM_WORKERS=4        # Dedica 4 cores para transcrever
    volumes:
      - whisper_cache:/root/.cache/huggingface

volumes:
  ollama_data:
  whisper_cache:
```

3. Cole na área de configuração do Coolify.

---

## 4. Configurar Domínios (Domains)
O Coolify detecta os serviços que expõem portas. Você precisa configurar as URLs públicas:

1. **Service: web**
   - Domain: `https://app.seudominio.com`
2. **Service: api**
   - Domain: `https://api.seudominio.com`

*Nota: Ollama e Whisper não precisam de domínio público se a API se comunica com eles via rede interna do Docker (http://ollama:11434), o que é mais seguro e rápido.*

---

## 5. Deploy Inicial (Subir os Containers)
**IMPORTANTE:** Você pode achar estranho, mas precisamos fazer o deploy *antes* de ter os modelos.
Motivo: Os modelos (LLMs) ficam dentro do container do Ollama. Se o container não estiver rodando ("Deployed"), não temos onde salvar os modelos.

1. Clique no botão **Deploy** no canto superior direito.
2. Acompanhe os logs. O Coolify vai baixar as imagens e subir os 4 serviços.
3. Aguarde até que todos fiquem com status **"Healthy"** (Verde).

---

## 6. Instalar a Inteligência (Baixar Modelos)
Agora que o "corpo" (Container) está vivo, vamos dar o "cérebro" (Modelos) a ele.

1. No painel do Coolify, clique no serviço **ollama**.
2. Vá na aba **Terminal/Console** (dentro do próprio Coolify).
3. Clique em **Connect**.
4. Cole e rode os comandos abaixo (um por vez):

```bash
# Baixa o modelo primário de análise (Pode demorar uns 10-15min dependendo da rede)
ollama pull qwen2.5:14b-instruct-q4_K_M

# Baixa o modelo secundário de estruturação
ollama pull llama3.1:8b-instruct-q4_K_M
```

*Dica: Você verá uma barra de progresso no terminal. Quando terminar, o sistema estará 100% pronto.*

---

## Por que essa configuração é ideal?
- **Zero Downtime**: O `OLLAMA_KEEP_ALIVE=24h` garante que o modelo não é descarregado entre perguntas.
- **Paralelismo Real**: Dedicamos 4 cores só para o Whisper e deixamos o restante para o Ollama/Sistema. Você pode transcrever uma reunião enquanto conversa com o chat.
- **Gestão Simplificada**: Se precisar atualizar, basta clicar em "Redeploy" no Coolify. SSL e renovação de certificados são automáticos.
