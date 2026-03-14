import { processRpi } from './rpi-crawler.js';

async function test() {
    const rpiToTest = '2879'; // Latest we found
    console.log(`Testing RPI ${rpiToTest} processor...`);
    try {
        await processRpi(rpiToTest);
        console.log("Test finished successfully!");
    } catch (err) {
        console.error("Test failed:", err);
    }
}

test();
