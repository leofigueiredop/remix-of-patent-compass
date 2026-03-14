import axios from 'axios';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { prisma } from './db.js';
import { updateWorkerState } from './state.js';

const RPI_BASE_URL = 'https://revistas.inpi.gov.br/txt/';

export async function processRpi(rpiNumber: string | number) {
    const rpiStr = rpiNumber.toString();
    updateWorkerState({ currentRPI: parseInt(rpiStr), status: 'Running' });
    const zipUrl = `${RPI_BASE_URL}P${rpiStr}.zip`;
    const tempDir = path.resolve(process.cwd(), 'temp_rpi', rpiStr);
    const zipPath = path.resolve(tempDir, `P${rpiStr}.zip`);

    try {
        if (!existsSync(tempDir)) {
            await fs.mkdir(tempDir, { recursive: true });
        }
        console.log(`[RPI ${rpiStr}] Downloading ${zipUrl}...`);
        
        const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(zipPath, response.data);

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(tempDir, true);
        console.log(`[RPI ${rpiStr}] Extracted to ${tempDir}`);

        const files = await fs.readdir(tempDir);
        const xmlFile = files.find(f => f.toLowerCase().endsWith('.xml'));
        if (!xmlFile) throw new Error(`XML file not found in RPI ${rpiStr}`);

        const xmlContent = await fs.readFile(path.join(tempDir, xmlFile), 'utf-8');
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
        const jsonObj = parser.parse(xmlContent);

        const revista = jsonObj.revista;
        if (!revista || revista.diretoria !== 'Patente') {
            console.log(`[RPI ${rpiStr}] Not a patent journal or empty. skipping.`);
            return;
        }

        const despachos = Array.isArray(revista.despacho) ? revista.despacho : (revista.despacho ? [revista.despacho] : []);
        
        console.log(`[RPI ${rpiStr}] Found ${despachos.length} events. Syncing database...`);

        let count = 0;
        for (const d of despachos) {
            const proc = d['processo-patente'];
            if (!proc) continue;

            const numeroFull = proc.numero?.['#text'] || proc.numero || '';
            const numero = numeroFull.replace(/[^\d]/g, '').trim(); // E.g. 1020240172906
            if (!numero) continue;

            // Extract basic metadata
            const title = (d.titulo || proc.titulo || '').toString();
            // filingDate and others might be objects like { "#text": "...", "inid": "..." }
            const getVal = (v: any) => {
                if (!v) return '';
                if (typeof v === 'string') return v;
                if (typeof v === 'number') return v.toString();
                return v['#text'] || v.toString();
            };

            const filingDate = getVal(proc['data-deposito']);
            
            // Extract owners (titular)
            let applicants = '';
            if (proc['titular-lista']?.titular) {
                const titularList = Array.isArray(proc['titular-lista'].titular) 
                    ? proc['titular-lista'].titular 
                    : [proc['titular-lista'].titular];
                applicants = titularList.map((t: any) => getVal(t['nome-completo'] || t)).filter(Boolean).join('; ');
            }

            // Extract inventors
            let inventors = '';
            if (proc['inventor-lista']?.inventor) {
                const invList = Array.isArray(proc['inventor-lista'].inventor)
                    ? proc['inventor-lista'].inventor
                    : [proc['inventor-lista'].inventor];
                inventors = invList.map((i: any) => getVal(i['nome-completo'] || i)).filter(Boolean).join('; ');
            }

            // Extract IPCs
            let ipcs = '';
            if (proc['classificacao-internacional-lista']?.['classificacao-internacional']) {
                const ipcList = Array.isArray(proc['classificacao-internacional-lista']['classificacao-internacional'])
                    ? proc['classificacao-internacional-lista']['classificacao-internacional']
                    : [proc['classificacao-internacional-lista']['classificacao-internacional']];
                ipcs = ipcList.map((i: any) => getVal(i)).join(', ');
            }

            const dispatchCode = getVal(d.codigo);
            const dispatchTitle = getVal(d.titulo);
            const comment = getVal(d.comentario);

            // Upsert InpiPatent
            await prisma.inpiPatent.upsert({
                where: { cod_pedido: numero },
                update: {
                    numero_publicacao: numeroFull || undefined,
                    title: title || undefined,
                    applicant: applicants || undefined,
                    inventors: inventors || undefined,
                    ipc_codes: ipcs || undefined,
                    filing_date: filingDate || undefined,
                    last_rpi: rpiStr,
                    last_event: dispatchCode,
                    status: dispatchTitle
                },
                create: {
                    cod_pedido: numero,
                    numero_publicacao: numeroFull || null,
                    title: title || null,
                    applicant: applicants || null,
                    inventors: inventors || null,
                    ipc_codes: ipcs || null,
                    filing_date: filingDate || null,
                    last_rpi: rpiStr,
                    last_event: dispatchCode,
                    status: dispatchTitle
                }
            });

            // Create Publication record (allows history of dispatches)
            await prisma.inpiPublication.create({
                data: {
                    patent_id: numero,
                    rpi: rpiStr,
                    date: revista.dataPublicacao,
                    despacho_code: dispatchCode,
                    despacho_desc: dispatchTitle,
                    complement: comment
                }
            });
            count++;
            if (count % 10 === 0) {
                updateWorkerState({ 
                    totalProcessed: count, 
                    lastPatentProcessed: numeroFull || numero 
                });
            }
        }

        updateWorkerState({ totalProcessed: count, status: 'Idle' });
        console.log(`[RPI ${rpiStr}] Sync complete. Processed ${count} patent records.`);
    } catch (err: any) {
        console.error(`[RPI ${rpiStr}] Error: ${err.message}`);
        throw err;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}
