const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    await prisma.documentDownloadJob.updateMany({
        where: { status: 'not_found' },
        data: { status: 'pending', error: null, attempts: 0 }
    });
    console.log("Requeued!");
}
run().then(() => prisma.$disconnect());
