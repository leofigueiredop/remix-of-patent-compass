// Script de teste INPI com MCP Playwright, rotação de proxies e Anti-Captcha
// Baseado no worker existente inpiWorker.ts e inpiScraper.ts

const fs = require('fs');
const path = require('path');

const PROXY_FILE = process.env.INPI_PROXY_FILE || './proxy.txt';
const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
const ANTI_CAPTCHA_API_KEY = process.env.ANTI_CAPTCHA_API_KEY || '';
const TEST_PATENT = process.env.INPI_TEST_PATENT || 'BR102021006956';
const DOWNLOAD_DIR = process.env.INPI_TEST_DOWNLOAD_DIR || './test-downloads';
const HEADLESS = process.env.INPI_TEST_HEADLESS === 'true';
const MAX_TESTS = Math.max(1, Number(process.env.INPI_TEST_MAX_PROXIES || 3));
const CONCURRENCY = Math.max(1, Number(process.env.INPI_TEST_CONCURRENCY || 2));
const STEP_TIMEOUT_MS = Math.max(180000, Number(process.env.INPI_TEST_TIMEOUT_MS || 180000));

// Anti-Captcha SDK
const anticaptcha = require('@antiadmin/anticaptchaofficial');

// Ler lista de proxies
function loadProxies() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.error('❌ Arquivo de proxies não encontrado:', PROXY_FILE);
        return [];
    }
    
    const content = fs.readFileSync(PROXY_FILE, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    return lines.map(line => {
        const [ip, port, username, password] = line.split(':');
        return {
            server: `http://${ip}:${port}`,
            username,
            password
        };
    });
}

async function solveRecaptchaToken(page) {
    if (!ANTI_CAPTCHA_API_KEY) return null;
    anticaptcha.setAPIKey(ANTI_CAPTCHA_API_KEY);
    const siteKey = await page.evaluate(() => {
        const recaptcha = document.querySelector('.g-recaptcha');
        return recaptcha ? recaptcha.getAttribute('data-sitekey') : null;
    });
    if (!siteKey) return null;
    const pageUrl = page.url();
    try {
        const tokenV2 = await anticaptcha.solveRecaptchaV2Proxyless(pageUrl, siteKey, false);
        if (tokenV2) {
            console.log('✅ AntiCaptcha: Recaptcha V2 Proxy-Off ok');
            return tokenV2;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`⚠️ AntiCaptcha V2 Proxy-Off falhou: ${message}`);
    }

    try {
        const tokenEnterprise = await anticaptcha.solveRecaptchaV2EnterpriseProxyless(pageUrl, siteKey, false, 0, null);
        if (tokenEnterprise) {
            console.log('✅ AntiCaptcha: Recaptcha V2 Enterprise Proxy-Off ok');
            return tokenEnterprise;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`⚠️ AntiCaptcha Enterprise Proxy-Off falhou: ${message}`);
    }

    return null;
}

// Função principal de teste
async function testInpiWithProxy(proxyConfig) {
    console.log(`🚀 Iniciando teste com proxy: ${proxyConfig.server}`);
    
    try {
        // Configurar Playwright com proxy
        const { chromium } = require('playwright');
        
        const browser = await chromium.launch({
            headless: HEADLESS,
            proxy: proxyConfig
        });
        
        const context = await browser.newContext({
            viewport: { width: 1280, height: 1024 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            acceptDownloads: true
        });
        
        const page = await context.newPage();
        
        // 1. Navegar para página de login
        console.log('🌐 Navegando para página de login...');
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', {
            waitUntil: 'networkidle',
            timeout: STEP_TIMEOUT_MS
        });

        if (!(await page.locator('input[name="T_Login"]').count())) {
            await page.goto('https://busca.inpi.gov.br/pePI/', {
                waitUntil: 'networkidle',
                timeout: STEP_TIMEOUT_MS
            });

            const loginLink = page.getByRole('link', { name: /login/i });
            if (await loginLink.count()) {
                await loginLink.first().click();
                await page.waitForLoadState('networkidle');
            }
        }
        
        // 2. Preencher formulário de login
        console.log('🔐 Preenchendo formulário de login...');
        if (!(await page.locator('input[name="T_Login"]').count())) {
            throw new Error('Formulário de login não encontrado após navegação');
        }
        await page.fill('input[name="T_Login"]', INPI_USER);
        await page.fill('input[name="T_Senha"]', INPI_PASSWORD);
        
        console.log('ℹ️  Captcha de login não é usado neste fluxo, apenas no download do documento');
        
        // 4. Clicar no botão de login
        console.log('📝 Submetendo formulário...');
        await page.getByRole('button', { name: /continuar/i }).click();
        
        // 5. Aguardar login completar
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT_MS }).catch(() => null);
        await page.waitForTimeout(3000);
        
        // 6. Verificar se login foi bem sucedido
        const currentUrl = page.url();
        const loggedIndicator = await page.locator('text=Login:').count();
        if (currentUrl.includes('Base_pesquisa') || currentUrl.includes('PatenteSearch') || loggedIndicator > 0) {
            console.log('✅ Login realizado com sucesso!');
        } else {
            console.log('❌ Possível falha no login. URL atual:', currentUrl);
        }
        
        // 7. Navegar para pesquisa de patentes
        console.log('🔍 Navegando para pesquisa de patentes...');
        const basePatentesLink = page.getByRole('link', { name: /Base Patentes/i }).first();
        if (await basePatentesLink.count()) {
            await basePatentesLink.click();
            await page.waitForLoadState('networkidle');
        } else {
            await page.goto('https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp', {
                waitUntil: 'networkidle',
                timeout: STEP_TIMEOUT_MS
            });
        }

        if (!(await page.locator('input[name="NumPedido"]').count())) {
            const htmlPreview = (await page.content()).replace(/\s+/g, ' ').slice(0, 500);
            throw new Error(`Tela de pesquisa não carregou com proxy. URL=${page.url()} HTML=${htmlPreview}`);
        }
        
        // 8. Preencher campo de pesquisa
        console.log('📋 Preenchendo campo de pesquisa...');
        await page.fill('input[name="NumPedido"]', TEST_PATENT);
        
        // 9. Submeter pesquisa
        console.log('🔎 Submetendo pesquisa...');
        await page.getByRole('button', { name: /pesquisar/i }).click();
        
        // 10. Aguardar resultados
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT_MS }).catch(() => null);
        await page.waitForTimeout(3000);
        
        // 11. Verificar se encontrou a patente
        const pageContent = await page.content();
        if (pageContent.includes(TEST_PATENT)) {
            console.log('✅ Patente encontrada:', TEST_PATENT);
        } else {
            console.log('❌ Patente não encontrada');
        }
        
        // 12. Tentar clicar no link da patente
        console.log('📄 Acessando detalhes da patente...');
        const patentLink = page.locator('a[href*="Action=detail"]').first();
        
        if (await patentLink.count()) {
            await patentLink.click();
            await page.waitForNavigation({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT_MS }).catch(() => null);
            await page.waitForTimeout(3000);
            
            // 13. Procurar por documentos (despachos 3.1, 16.1, etc.)
            console.log('📋 Procurando por documentos...');
            const mapping = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tr'));
                const despachos = rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
                    if (cells.length < 3) return null;
                    const rpi = cells[0];
                    const despacho = cells[2];
                    if (!/^(3\.1|1\.3|16\.1)$/.test(despacho)) return null;
                    return { rpi, despacho };
                }).filter(Boolean);

                const docs = Array.from(document.querySelectorAll('img.salvaDocumento')).map(img => {
                    const anchor = img.closest('a');
                    const label = anchor ? anchor.querySelector('label') : null;
                    const rpiLabel = label ? (label.textContent || '').replace(/\s+/g, ' ').trim() : '';
                    const rpi = rpiLabel.replace(/[^\d]/g, '');
                    return {
                        numeroID: img.getAttribute('id') || '',
                        rpi,
                        rpiLabel
                    };
                });

                const matches = despachos.map(item => {
                    const doc = docs.find(d => d.rpi === item.rpi);
                    return { ...item, doc };
                });

                return {
                    despachos,
                    docs,
                    matches
                };
            });

            if (mapping.matches.length) {
                console.log('✅ Despachos elegíveis encontrados:', mapping.matches.map(m => `${m.despacho} (RPI ${m.rpi})`).join(', '));
            } else {
                console.log('ℹ️  Nenhum despacho 3.1, 1.3 ou 16.1 encontrado');
            }

            const firstMatchWithDoc = mapping.matches.find(m => m.doc && m.doc.numeroID);
            if (firstMatchWithDoc) {
                console.log(`🧩 Match por RPI confirmado: despacho ${firstMatchWithDoc.despacho} -> RPI ${firstMatchWithDoc.rpi} -> NumeroID ${firstMatchWithDoc.doc.numeroID}`);
                const img = page.locator(`img.salvaDocumento[id="${firstMatchWithDoc.doc.numeroID}"]`).first();
                await img.click();
                await page.waitForTimeout(1500);
                const recaptchaVisible = await page.locator('.g-recaptcha').isVisible().catch(() => false);
                console.log(`🔐 Modal de captcha para download aberto: ${recaptchaVisible ? 'sim' : 'não'}`);
                if (recaptchaVisible) {
                    const token = await solveRecaptchaToken(page);
                    if (!token) {
                        throw new Error('Não foi possível resolver reCAPTCHA do modal de download');
                    }

                    await page.evaluate((captchaToken) => {
                        const textarea = document.getElementById('g-recaptcha-response') || document.querySelector('textarea[name="g-recaptcha-response"]');
                        if (textarea) {
                            textarea.value = captchaToken;
                            textarea.innerHTML = captchaToken;
                            textarea.dispatchEvent(new Event('input', { bubbles: true }));
                            textarea.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
                            window.grecaptcha.getResponse = () => captchaToken;
                        }
                        const btn = document.getElementById('captchaButton');
                        if (btn) btn.style.display = 'inline-block';
                    }, token);

                    if (!fs.existsSync(DOWNLOAD_DIR)) {
                        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
                    }
                    const outputFile = path.resolve(DOWNLOAD_DIR, `inpi_${TEST_PATENT}_${firstMatchWithDoc.rpi}_${Date.now()}.pdf`);

                    const downloadPromise = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);
                    const pdfResponsePromise = page.waitForResponse(
                        (resp) => {
                            const ct = resp.headers()['content-type'] || '';
                            return ct.includes('application/pdf');
                        },
                        { timeout: 45000 }
                    ).catch(() => null);

                    await page.click('#captchaButton');

                    const [download, pdfResponse] = await Promise.all([downloadPromise, pdfResponsePromise]);

                    if (download) {
                        await download.saveAs(outputFile);
                        console.log(`✅ Documento baixado (evento download): ${outputFile}`);
                    } else if (pdfResponse) {
                        const buffer = await pdfResponse.body();
                        fs.writeFileSync(outputFile, buffer);
                        console.log(`✅ Documento baixado (resposta PDF): ${outputFile}`);
                    } else {
                        throw new Error('Captcha enviado, mas nenhum arquivo PDF foi retornado');
                    }
                }
            } else {
                console.log('ℹ️  Não foi encontrado thumbnail de documento com RPI correspondente');
            }
        } else {
            console.log('❌ Link da patente não encontrado');
        }
        
        // 14. Fechar browser
        await browser.close();
        console.log('✅ Teste concluído com sucesso!');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro durante o teste:', error.message);
        return false;
    }
}

// Função principal
async function main() {
    console.log('🚀 INICIANDO TESTE INPI COM MCP PLAYWRIGHT E PROXIES');
    console.log('====================================================');

    if (!INPI_USER || !INPI_PASSWORD) {
        console.error('❌ INPI_USER e INPI_PASSWORD precisam estar definidos no ambiente');
        return;
    }
    
    // Carregar proxies
    const proxies = loadProxies();
    
    if (proxies.length === 0) {
        console.error('❌ Nenhum proxy encontrado para teste');
        return;
    }
    
    const selectedProxies = proxies.slice().reverse().slice(0, Math.min(MAX_TESTS, proxies.length));
    console.log(`📊 ${proxies.length} proxies carregados | ${selectedProxies.length} selecionados (de baixo para cima)`);
    console.log(`🧩 Concorrência: ${CONCURRENCY} janela(s) separadas`);

    for (let i = 0; i < selectedProxies.length; i += CONCURRENCY) {
        const batch = selectedProxies.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (proxy, idx) => {
            const pos = i + idx + 1;
            console.log(`\n🔧 TESTE ${pos}/${selectedProxies.length} - Proxy: ${proxy.server}`);
            const success = await testInpiWithProxy(proxy);
            return { proxy: proxy.server, success };
        }));

        for (const result of results) {
            if (result.success) {
                console.log(`✅ Proxy ${result.proxy} funcionou corretamente`);
            } else {
                console.log(`❌ Proxy ${result.proxy} falhou`);
            }
        }
    }
    
    console.log('\n🎯 TODOS OS TESTES CONCLUÍDOS');
}

// Executar se chamado diretamente
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = { testInpiWithProxy, loadProxies };
