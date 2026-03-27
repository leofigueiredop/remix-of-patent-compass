const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
try {
    process.loadEnvFile?.('.env');
    process.loadEnvFile?.('backend/.env');
} catch {
}

const GP_BACKLOG_STATUSES = [
    'pending',
    'pending_google_patents',
    'running_google_patents',
    'failed_google_patents',
    'pending_ops',
    'running_ops',
    'failed_ops',
    'waiting_inpi',
    'waiting_inpi_text',
    'failed',
    'failed_permanent',
    'not_found'
];
const CHUNK_SIZE = 2000;

function chunk(items, size) {
    const output = [];
    for (let i = 0; i < items.length; i += size) {
        output.push(items.slice(i, i + size));
    }
    return output;
}

async function run() {
    const rows = await prisma.documentDownloadJob.findMany({
        where: {
            status: { in: GP_BACKLOG_STATUSES }
        },
        select: {
            patent_id: true,
            status: true
        }
    });
    const patentIds = Array.from(new Set(rows.map((row) => String(row.patent_id || '').trim()).filter(Boolean)));
    if (!patentIds.length) {
        console.log(JSON.stringify({ found: 0, updatedDocs: 0, queuedInpi: 0 }, null, 2));
        return;
    }
    let updatedDocsCount = 0;
    let queuedInpiCount = 0;
    for (const patentChunk of chunk(patentIds, CHUNK_SIZE)) {
        const updatedDocs = await prisma.documentDownloadJob.updateMany({
            where: {
                patent_id: { in: patentChunk },
                status: { in: GP_BACKLOG_STATUSES }
            },
            data: {
                status: 'waiting_inpi',
                error: 'REQUEUE_INPI_FIRST_FORCE_FULL',
                attempts: 0,
                started_at: null,
                finished_at: null
            }
        });
        updatedDocsCount += updatedDocs.count;
        await prisma.inpiProcessingJob.createMany({
            data: patentChunk.map((patentId) => ({
                patent_number: patentId,
                priority: 90,
                status: 'pending',
                attempts: 0,
                error: 'mode=full',
                started_at: null,
                finished_at: null
            })),
            skipDuplicates: true
        });
        const queuedInpi = await prisma.inpiProcessingJob.updateMany({
            where: { patent_number: { in: patentChunk } },
            data: {
                priority: 90,
                status: 'pending',
                attempts: 0,
                error: 'mode=full',
                started_at: null,
                finished_at: null
            }
        });
        queuedInpiCount += queuedInpi.count;
    }
    console.log(JSON.stringify({
        found: rows.length,
        uniquePatents: patentIds.length,
        updatedDocs: updatedDocsCount,
        queuedInpi: queuedInpiCount,
        statuses: GP_BACKLOG_STATUSES
    }, null, 2));
}
run().then(() => prisma.$disconnect());
