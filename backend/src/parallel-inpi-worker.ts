import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

// Carregar variáveis de ambiente
if (typeof (process as any).loadEnvFile === 'function') {
    try {
        (process as any).loadEnvFile(path.resolve(process.cwd(), '.env'));
    } catch (_) {}
}

const prisma = new PrismaClient();

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return JSON.stringify(error);
}

// Configuração do worker paralelo
const PARALLEL_INPI_ENABLED = process.env.PARALLEL_INPI_ENABLED === 'true';
const PARALLEL_INPI_PROXY_FILE = process.env.PARALLEL_INPI_PROXY_FILE || './proxy.txt';
const PARALLEL_INPI_BATCH_SIZE = parseInt(process.env.PARALLEL_INPI_BATCH_SIZE || '5', 10);
const PARALLEL_INPI_INTERVAL_MS = parseInt(process.env.PARALLEL_INPI_INTERVAL_MS || '30000', 10);

// Carregar lista de proxies
function loadProxies(): Array<{server: string, username?: string, password?: string}> {
    try {
        const proxyPath = path.resolve(process.cwd(), PARALLEL_INPI_PROXY_FILE);
        if (!fs.existsSync(proxyPath)) {
            console.log('[parallel-inpi] Arquivo de proxy não encontrado:', proxyPath);
            return [];
        }
        
        const proxies = fs.readFileSync(proxyPath, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [ip, port, username, password] = line.split(':');
                return {
                    server: `http://${ip}:${port}`,
                    username,
                    password
                };
            });
        
        console.log(`[parallel-inpi] ${proxies.length} proxies carregados`);
        return proxies;
    } catch (error) {
        console.error('[parallel-inpi] Erro ao carregar proxies:', error);
        return [];
    }
}

// Função para processar jobs do INPI com proxy rotation
async function processInpiJobsWithProxies() {
    if (!PARALLEL_INPI_ENABLED) {
        console.log('[parallel-inpi] Worker paralelo desabilitado');
        return;
    }
    
    const proxies = loadProxies();
    if (proxies.length === 0) {
        console.log('[parallel-inpi] Nenhum proxy disponível, saindo...');
        return;
    }
    
    console.log('[parallel-inpi] Iniciando processamento paralelo do INPI com proxies');
    
    let currentProxyIndex = 0;
    
    while (true) {
        try {
            // Buscar jobs pendentes do final da fila (mais antigos primeiro)
            const pendingJobs = await prisma.inpiProcessingJob.findMany({
                where: {
                    status: 'pending',
                    attempts: { lt: 5 } // Limitar tentativas
                },
                orderBy: [
                    { created_at: 'asc' }, // Mais antigos primeiro
                    { priority: 'desc' }    // Maior prioridade primeiro
                ],
                take: PARALLEL_INPI_BATCH_SIZE
            });
            
            if (pendingJobs.length === 0) {
                console.log('[parallel-inpi] Nenhum job pendente encontrado');
                await new Promise(resolve => setTimeout(resolve, PARALLEL_INPI_INTERVAL_MS));
                continue;
            }
            
            console.log(`[parallel-inpi] ${pendingJobs.length} jobs pendentes encontrados`);
            
            for (const job of pendingJobs) {
                const proxy = proxies[currentProxyIndex];
                console.log(`[parallel-inpi] Processando job ${job.id} (${job.patent_number}) com proxy ${proxy.server}`);
                
                try {
                    // Marcar job como running
                    await prisma.inpiProcessingJob.update({
                        where: { id: job.id },
                        data: {
                            status: 'running',
                            started_at: new Date(),
                            attempts: { increment: 1 }
                        }
                    });
                    
                    // TODO: Implementar scraping real com proxy
                    // Por enquanto, apenas simulamos o sucesso
                    const success = await simulateInpiScraping(job.patent_number, proxy);
                    
                    if (success) {
                        await prisma.inpiProcessingJob.update({
                            where: { id: job.id },
                            data: {
                                status: 'completed',
                                finished_at: new Date(),
                                error: null
                            }
                        });
                        console.log(`[parallel-inpi] Job ${job.id} concluído com sucesso`);
                    } else {
                        throw new Error('Scraping falhou');
                    }
                    
                } catch (error) {
                    console.error(`[parallel-inpi] Erro no job ${job.id}:`, error);
                    await prisma.inpiProcessingJob.update({
                        where: { id: job.id },
                        data: {
                            status: 'failed',
                            finished_at: new Date(),
                            error: errorMessage(error)
                        }
                    });
                }
                
                // Rotacionar proxy para próximo job
                currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
                
                // Aguardar entre requests para evitar bloqueio
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            console.error('[parallel-inpi] Erro geral no loop:', error);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

// Função de simulação de scraping (substituir pela implementação real)
async function simulateInpiScraping(patentNumber: string, proxy: any): Promise<boolean> {
    console.log(`[parallel-inpi] Simulando scraping para ${patentNumber} com proxy ${proxy.server}`);
    
    // Simular tempo de processamento
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Simular sucesso 80% das vezes
    return Math.random() > 0.2;
}

// Função principal
async function startParallelInpiWorker() {
    try {
        console.log('[parallel-inpi] Iniciando worker paralelo do INPI');
        await prisma.$connect();
        
        await processInpiJobsWithProxies();
        
    } catch (error) {
        console.error('[parallel-inpi] Erro fatal:', error);
        process.exit(1);
    }
}

// Handler de shutdown
process.on('SIGTERM', async () => {
    console.log('[parallel-inpi] SIGTERM received, shutting down');
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[parallel-inpi] SIGINT received, shutting down');
    await prisma.$disconnect();
    process.exit(0);
});

// Iniciar worker
if (require.main === module) {
    startParallelInpiWorker().catch(console.error);
}

export { startParallelInpiWorker };
