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
        const response = await api.post('/briefing', { text }, { timeout: 240000 });
        return response.data;
    },

    /**
     * Generates specific fields of the technical briefing via separate routes.
     */
    generateBriefingProblem: async (text: string): Promise<string> => {
        const response = await api.post('/briefing/problem', { text }, { timeout: 120000 });
        return response.data.problemaTecnico;
    },
    generateBriefingSolution: async (text: string): Promise<string> => {
        const response = await api.post('/briefing/solution', { text }, { timeout: 120000 });
        return response.data.solucaoProposta;
    },
    generateBriefingHighlights: async (text: string): Promise<string> => {
        const response = await api.post('/briefing/highlights', { text }, { timeout: 120000 });
        return response.data.diferenciais;
    },
    generateBriefingApplications: async (text: string): Promise<string> => {
        const response = await api.post('/briefing/applications', { text }, { timeout: 120000 });
        return response.data.aplicacoes;
    },

    /**
     * Generates search keywords, tech blocks, search levels, and IPC codes from a briefing.
     */
    generateStrategy: async (briefing: any): Promise<{
        techBlocks?: {
            id: string;
            name: string;
            description: string;
        }[];
        blocks: {
            id: string;
            connector: "AND" | "OR";
            groups: {
                id: string;
                terms_pt: string[];
                terms_en: string[];
            }[];
        }[];
        searchLevels?: {
            level: number;
            label: string;
            cql: string;
            inpi: string;
        }[];
        ipc_codes: ({ code: string; justification: string } | string)[];
    }> => {
        const response = await api.post('/strategy', { briefing }, { timeout: 60000 });
        return response.data;
    },

    /**
     * Searches patents across Espacenet and INPI in parallel.
     */
    searchPatents: async (cql: string, inpiQuery: string, ipcCodes: string[], ignoreSecret: boolean = false): Promise<{
        espacenet: any[];
        inpi: any[];
    }> => {
        const response = await api.post('/search', {
            cql,
            inpiQuery,
            ipc_codes: ipcCodes,
            ignoreSecret
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
