import { prisma } from './dist/db.js';

async function count() {
    try {
        const patents = await prisma.inpiPatent.count();
        const publications = await prisma.inpiPublication.count();
        console.log(`Patents: ${patents}`);
        console.log(`Publications: ${publications}`);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

count();
