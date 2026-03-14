// State management for the INPI Scraper Worker
export let state = {
    status: 'Booting',
    totalProcessed: 0,
    errors: 0,
    lastPatentProcessed: null as string | null,
    currentRPI: null as number | null,
};

export function updateWorkerState(updates: Partial<typeof state>) {
    state = { ...state, ...updates };
}
