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

export interface SearchStrategy {
    keywords_pt: string[];
    keywords_en: string[];
    ipc_codes: string[];
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
    const resetResearch = useCallback(() => setState(initialState), []);

    return (
        <ResearchContext.Provider value={{
            ...state,
            setRawInput, setInputMode, setTranscription, setBriefing,
            setStrategy, setCqlQuery, setSearchResults, setAnalyzedPatents,
            resetResearch
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
