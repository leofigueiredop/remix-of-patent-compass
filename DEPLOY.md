# Deploy Guide: Hostinger VPS (Ubuntu 22.04/24.04)

This guide walks you through setting up the project on a Hostinger VPS (KVM 8 plan recommended) running Ubuntu.

## 1. Initial Server Setup

Connect to your VPS via SSH:
```bash
ssh root@<YOUR_VPS_IP>
```

Update the system:
```bash
apt update && apt upgrade -y
```

## 2. Install Docker & Docker Compose

Run the following convenience script to install Docker Engine:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

Verify installation:
```bash
docker --version
docker compose version
```

## 3. Upload Project Code

You can clone from GitHub (recommended) or upload files via SFTP/SCP.

### Option A: Via GitHub (Recommended)
1.  Generate an SSH key on the VPS (optional, if repo is private):
    ```bash
    ssh-keygen -t ed25519 -C "vps-deploy"
    cat ~/.ssh/id_ed25519.pub
    # Add this key to your GitHub Deploy Keys
    ```
2.  Clone the repository:
    ```bash
    git clone <YOUR_REPO_URL> /opt/patent-compass
    cd /opt/patent-compass
    ```

### Option B: Via SCP (Local Upload)
From your local machine:
```bash
scp -r . root@<YOUR_VPS_IP>:/opt/patent-compass
```

## 4. Configuration

Navigate to the project directory:
```bash
cd /opt/patent-compass
```

Create the `.env` file from the example:
```bash
cp .env.example .env
# Edit secrets (Postgres password, OPS keys, etc.)
nano .env
```

## 5. Startup

Run the application in production mode (Build + Detached):
```bash
docker compose up -d --build
```
*Note: The first run takes a few minutes to download the base images and build the backend.*

## 6. Model Setup (First Run Only)

Once the containers are running, you need to pull the specific AI models into Ollama.

1.  Check if services are running:
    ```bash
    docker compose ps
    ```
2.  Pull the models inside the `ollama` container:
    ```bash
    # Pull the primary model (Analysis/Briefing)
    docker compose exec ollama ollama pull qwen2.5:14b-instruct-q4_K_M

    # Pull the secondary model (Strategy/Keywords)
    docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_K_M
    ```

## 7. Accessing the App

*   **Frontend**: `http://<YOUR_VPS_IP>:5173`
*   **API**: `http://<YOUR_VPS_IP>:3000`

### Troubleshooting

*   **Logs**: Check logs for a specific service:
    ```bash
    docker compose logs -f api
    docker compose logs -f ollama
    ```
*   **Restart**:
    ```bash
    docker compose restart
    ```
*   **Update Code**:
    ```bash
    git pull
    docker compose up -d --build
    ```
