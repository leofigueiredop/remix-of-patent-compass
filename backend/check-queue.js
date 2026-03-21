const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const pendings = await prisma.documentDownloadJob.count({ where: { status: 'pending' } });
    const notFounds = await prisma.documentDownloadJob.count({ where: { status: 'not_found' } });
    console.log("Pendings:", pendings);
    console.log("Not Founds:", notFounds);
}
run().then(() => prisma.$disconnect());
