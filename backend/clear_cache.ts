import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('Clearing SearchResultCache...');
    const result = await (prisma as any).searchResultCache.deleteMany({});
    console.log(`Deleted ${result.count} records.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
