import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
});

export const aiService = {
    /**
     * Uploads an audio file for transcription using Whisper.
     */
    transcribeAudio: async (file: File): Promise<{ text: string }> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await api.post('/transcribe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
        });
        return response.data;
    },

    /**
     * Generates a structured technical briefing from raw text using the primary LLM.
     */
    generateBriefing: async (text: string): Promise<{
        problemaTecnico: string;
        solucaoProposta: string;
        diferenciais: string;
        aplicacoes: string;
    }> => {
        const response = await api.post('/briefing', { text }, { timeout: 180000 });
        return response.data;
    },

    /**
     * Generates search keywords and IPC codes from a briefing using the secondary LLM.
     */
    generateStrategy: async (briefing: any): Promise<{
        keywords_pt: string[];
        keywords_en: string[];
        ipc_codes: string[];
    }> => {
        const response = await api.post('/strategy', { briefing }, { timeout: 60000 });
        return response.data;
    },

    /**
     * Searches patents across Espacenet and INPI in parallel.
     */
    searchPatents: async (cql: string, keywords: string[], ipcCodes: string[]): Promise<{
        espacenet: any[];
        inpi: any[];
    }> => {
        const response = await api.post('/search', {
            cql,
            keywords,
            ipc_codes: ipcCodes
        }, { timeout: 60000 });
        return response.data;
    },

    /**
     * Analyzes selected patents against the invention briefing using the primary LLM.
     */
    analyzePatents: async (patents: any[], briefing: any): Promise<{
        patents: any[];
    }> => {
        const response = await api.post('/analyze', { patents, briefing }, { timeout: 300000 });
        return response.data;
    },

    /**
     * Check if backend is up
     */
    checkHealth: async (): Promise<boolean> => {
        try {
            await api.get('/health', { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }
};
