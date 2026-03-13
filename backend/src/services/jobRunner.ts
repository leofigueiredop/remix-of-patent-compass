import { prisma } from '../db';
import { scrapeInpiPatent } from './inpiScraper';

let isRunning = false;

export async function startJobRunner() {
    console.log("Job runner started...");
    
    // Run every 10 seconds
    setInterval(async () => {
        if (isRunning) return;
        isRunning = true;

        try {
            const job = await prisma.scrapingJob.findFirst({
                where: { status: 'pending' },
                orderBy: { created_at: 'asc' }
            });

            if (job) {
                console.log(`Processing scraping job ${job.id} for patent ${job.patent_id}`);
                
                await prisma.scrapingJob.update({
                    where: { id: job.id },
                    data: { status: 'running', last_attempt: new Date(), attempts: { increment: 1 } }
                });

                try {
                    await scrapeInpiPatent(job.patent_id);
                    await prisma.scrapingJob.update({
                        where: { id: job.id },
                        data: { status: 'completed' }
                    });
                } catch (err: any) {
                    console.error(`Job ${job.id} failed:`, err.message);
                    await prisma.scrapingJob.update({
                        where: { id: job.id },
                        data: { status: 'failed', error: err.message }
                    });
                }
            }
        } catch (err: any) {
            console.error("Error in job runner loop:", err.message);
        } finally {
            isRunning = false;
        }
    }, 10000);
}
