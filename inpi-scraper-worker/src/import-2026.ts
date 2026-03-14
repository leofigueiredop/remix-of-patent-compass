import { processRpi } from './rpi-crawler.js';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function bulkImport() {
    console.log("=== INPI 2026 Bulk Import Started ===");
    
    // RPI numbers for 2026 approximately start around 2870
    // 2879 is the latest known as of March 10.
    const latestRpi = 2879;
    const startRpi = 2870; 
    
    for (let current = startRpi; current <= latestRpi; current++) {
        try {
            console.log(`\n[Bulk] Processing RPI ${current}...`);
            await processRpi(current);
            console.log(`[Bulk] RPI ${current} completed.`);
            
            // Random delay to be safe
            const delay = Math.floor(Math.random() * 3000) + 2000;
            await sleep(delay);
        } catch (error: any) {
            console.error(`[Bulk] Error in RPI ${current}:`, error.message);
        }
    }

    console.log("\n=== Bulk Import Finished ===");
    process.exit(0);
}

bulkImport();
