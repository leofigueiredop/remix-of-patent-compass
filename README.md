# Patent Scope Remix

Platform for Patent Research and Analysis powered by Local AI.
This system acts as an "AI Assistant" for patents, capable of transcribing audio, generating technical briefings, and creating search strategies using open-source models (DeepSeek, Phi-3, Whisper) running locally or on a standard VPS.

## 🏗 Architecture & Infrastructure

The project is composed of 4 main containers managed by Docker Compose:

1.  **Frontend (Web)**: React + Vite + Tailwind CSS.
2.  **Backend (API)**: Node.js (Fastify). Orchestrates calls between the frontend and AI services.
3.  **Ollama**: Inference server for LLMs (DeepSeek-R1, Phi-3.5).
4.  **Faster-Whisper-Server**: High-performance audio transcription server.

**Recommended Requirements**:
- 8 vCPUs
- 32GB RAM
- No GPU required (CPU-only optimization)

## 🔄 AI Workflows (Step-by-Step)

Each step of the process uses a specific AI model optimized for the task:

### 1. Audio Transcription
-   **Input**: Audio file (mp3, wav, m4a, etc.) containing the description of an invention.
-   **Model**: `faster-whisper-server` (Model `medium`).
-   **Goal**: Accurately convert speech to text for processing.
-   **Flow**:
    1.  Frontend sends audio to Backend `/transcribe`.
    2.  Backend streams audio to Whisper service.
    3.  Whisper returns raw text.

### 2. Technical Briefing Generation
-   **Input**: Transcribed text or raw text provided by the user.
-   **Model**: `deepseek-r1:7b` (via Ollama).
-   **Goal**: Structure unstructured information into a standard patent briefing format.
-   **Output (JSON)**:
    -   `problema_tecnico`: What problem does the invention solve?
    -   `solucao_proposta`: How does it solve it?
    -   `diferenciais`: What makes it unique compared to the state of the art?
-   **Flow**:
    1.  Frontend sends text to Backend `/briefing`.
    2.  Backend constructs a prompt for DeepSeek-R1.
    3.  Model analyzes and extracts the 3 key fields.

### 3. Search Strategy Creation
-   **Input**: Structured Briefing (JSON from the previous step).
-   **Model**: `phi3.5` (via Ollama).
-   **Goal**: Convert the technical concept into search terms and classification codes.
-   **Output (JSON)**:
    -   `keywords`: 5 optimized search terms in English.
    -   `ipc_codes`: 3 relevant International Patent Classification (IPC) codes.
-   **Flow**:
    1.  Frontend sends the Briefing to Backend `/strategy`.
    2.  Backend prompts Phi-3.5 to derive keywords and IPCs.
    3.  The result is used to query patent databases (Espacenet/INPI).

## 🚀 Development Setup

1.  **Environment**:
    Copy `.env.example` to `.env` (backend) if necessary.

2.  **Start Services**:
    ```bash
    docker-compose up --build
    ```
    *Note: The setup is optimized for CPU usage (AVX2), no GPU configuration needed.*

3.  **Access**:
    -   Web: `http://localhost:5173`
    -   API: `http://localhost:3000`
