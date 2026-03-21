const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const backgroundWorkers = require('./dist/services/backgroundWorkers');

async function test() {
    const patentId = "BR122025025676";
    console.log("Fetching biblio for", patentId);
    
    // Using the internal function via an export if possible, but let's just write a puppeteer script 
    // to test extraction from the /pt page directly to be sure.
}
test();
