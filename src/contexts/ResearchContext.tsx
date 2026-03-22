import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ─── Types ─────────────────────────────────────────────────────
export interface StructuredBriefing {
    problemaTecnico: string;
    solucaoProposta: string;
    diferenciais: string;
    aplicacoes: string;
}

export interface PatentResult {
    publicationNumber: string;
    title: string;
    applicant: string;
    date: string;
    abstract: string;
    classification?: string;
    source: 'Espacenet' | 'INPI';
    url?: string;
}

export interface AnalyzedPatent extends PatentResult {
    id: string;
    selected: boolean;
    riskLevel: 'high' | 'medium' | 'low';
    score: number;
    justificativa: string;
}

export interface TechBlock {
    id: string;
    name: string;
    description: string;
}

export interface SearchLevel {
    level: number;
    label: string;
    cql: string;
    inpi: string;
}

export interface IpcCode {
    code: string;
    justification: string;
}

export interface SearchStrategy {
    techBlocks?: TechBlock[];
    blocks?: {
        id: string;
        connector: "AND" | "OR";
        groups: {
            id: string;
            terms_pt: string[];
            terms_en: string[];
        }[];
    }[];
    searchLevels?: SearchLevel[];
    ipc_codes: (string | IpcCode)[];
    // Legacy fallback
    keywords_pt?: string[];
    keywords_en?: string[];
}

interface ResearchState {
    rawInput: string;
    inputMode: 'audio' | 'text' | 'files';
    transcription: string;
    briefing: StructuredBriefing | null;
    strategy: SearchStrategy | null;
    cqlQuery: string;
    searchResults: {
        espacenet: PatentResult[];
        inpi: PatentResult[];
    };
    analyzedPatents: AnalyzedPatent[];
}

interface ResearchContextType extends ResearchState {
    setRawInput: (input: string) => void;
    setInputMode: (mode: 'audio' | 'text' | 'files') => void;
    setTranscription: (text: string) => void;
    setBriefing: (briefing: StructuredBriefing) => void;
    setStrategy: (strategy: SearchStrategy) => void;
    setCqlQuery: (query: string) => void;
    setSearchResults: (results: { espacenet: PatentResult[]; inpi: PatentResult[] }) => void;
    setAnalyzedPatents: (patents: AnalyzedPatent[]) => void;
    trackJourneyStep: (stepKey: string, eventType: 'view' | 'complete') => void;
    getJourneyMetrics: () => Record<string, { views: number; completes: number; lastEventAt: string }>;
    resetResearch: () => void;
}

// ─── Initial State ─────────────────────────────────────────────
const initialState: ResearchState = {
    rawInput: '',
    inputMode: 'text',
    transcription: '',
    briefing: null,
    strategy: null,
    cqlQuery: '',
    searchResults: { espacenet: [], inpi: [] },
    analyzedPatents: [],
};

// ─── Context ───────────────────────────────────────────────────
const ResearchContext = createContext<ResearchContextType | undefined>(undefined);

export function ResearchProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ResearchState>(initialState);
    const journeyStorageKey = 'research_journey_metrics_v1';

    const setRawInput = useCallback((rawInput: string) => setState(s => ({ ...s, rawInput })), []);
    const setInputMode = useCallback((inputMode: 'audio' | 'text' | 'files') => setState(s => ({ ...s, inputMode })), []);
    const setTranscription = useCallback((transcription: string) => setState(s => ({ ...s, transcription })), []);
    const setBriefing = useCallback((briefing: StructuredBriefing) => setState(s => ({ ...s, briefing })), []);
    const setStrategy = useCallback((strategy: SearchStrategy) => setState(s => ({ ...s, strategy })), []);
    const setCqlQuery = useCallback((cqlQuery: string) => setState(s => ({ ...s, cqlQuery })), []);
    const setSearchResults = useCallback((searchResults: { espacenet: PatentResult[]; inpi: PatentResult[] }) =>
        setState(s => ({ ...s, searchResults })), []);
    const setAnalyzedPatents = useCallback((analyzedPatents: AnalyzedPatent[]) =>
        setState(s => ({ ...s, analyzedPatents })), []);
    const getJourneyMetrics = useCallback(() => {
        try {
            const raw = localStorage.getItem(journeyStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
            return {};
        } catch {
            return {};
        }
    }, []);
    const trackJourneyStep = useCallback((stepKey: string, eventType: 'view' | 'complete') => {
        if (!stepKey) return;
        const current = getJourneyMetrics();
        const item = current[stepKey] || { views: 0, completes: 0, lastEventAt: new Date().toISOString() };
        if (eventType === 'view') item.views += 1;
        if (eventType === 'complete') item.completes += 1;
        item.lastEventAt = new Date().toISOString();
        current[stepKey] = item;
        localStorage.setItem(journeyStorageKey, JSON.stringify(current));
    }, [getJourneyMetrics]);
    const resetResearch = useCallback(() => setState(initialState), []);

    return (
        <ResearchContext.Provider value={{
            ...state,
            setRawInput, setInputMode, setTranscription, setBriefing,
            setStrategy, setCqlQuery, setSearchResults, setAnalyzedPatents,
            trackJourneyStep, getJourneyMetrics, resetResearch
        }}>
            {children}
        </ResearchContext.Provider>
    );
}

export function useResearch(): ResearchContextType {
    const ctx = useContext(ResearchContext);
    if (!ctx) throw new Error('useResearch must be used within ResearchProvider');
    return ctx;
}
