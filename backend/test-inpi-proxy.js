const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Configurar stealth plugin
puppeteer.use(StealthPlugin());

// Ler lista de proxies
const proxyListPath = path.join(__dirname, 'proxy.txt');
const proxies = fs.readFileSync(proxyListPath, 'utf8')
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

console.log(`📋 ${proxies.length} proxies carregados`);

// Patentes de teste (pegar do final da fila)
const testPatents = [
  'BR102021006956', // Patente de teste conhecida
  'BR102021007123',
  'BR102021008765',
  'BR102021009876'
];

async function testProxyScraping() {
  console.log('🚀 Iniciando teste de scraping INPI com rotação de proxies');
  
  let currentProxyIndex = 0;
  let successfulScrapes = 0;
  let failedScrapes = 0;
  
  for (const patentNumber of testPatents) {
    const proxy = proxies[currentProxyIndex];
    console.log(`\n🔍 Testando patente ${patentNumber} com proxy ${proxy.server}`);
    
    try {
      const browser = await puppeteer.launch({
        headless: false, // Para ver o que está acontecendo
        args: [
          `--proxy-server=${proxy.server}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1400,900'
        ]
      });
      
      const page = await browser.newPage();
      
      // Configurar autenticação de proxy se necessário
      if (proxy.username && proxy.password) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password
        });
      }
      
      // Configurar user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1400, height: 900 });
      
      // Configurar timeout
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);
      
      // Testar conexão com proxy
      console.log('🌐 Testando conectividade do proxy...');
      
      try {
        // Primeiro teste: acessar página de verificação de IP
        await page.goto('https://httpbin.org/ip', { waitUntil: 'networkidle' });
        const ipInfo = await page.content();
        console.log('✅ Proxy conectado com sucesso');
        
        if (ipInfo.includes('origin')) {
          const originMatch = ipInfo.match(/\s*"origin":\s*"([^"]+)"\s*\}/);
          if (originMatch) {
            console.log(`📡 IP externo: ${originMatch[1]}`);
          }
        }
      } catch (proxyError) {
        console.log('❌ Falha na conexão do proxy:', proxyError.message);
        await browser.close();
        failedScrapes++;
        continue;
      }
      
      // Agora testar acesso ao INPI
      console.log('🔗 Acessando INPI...');
      
      try {
        await page.goto('https://busca.inpi.gov.br/pePI/', { 
          waitUntil: 'networkidle',
          timeout: 45000 
        });
        
        const pageTitle = await page.title();
        console.log(`📄 Título da página: ${pageTitle}`);
        
        // Verificar se é página de manutenção
        const content = await page.content();
        if (content.includes('manutenção') || content.includes('manutencao') || 
            content.includes('indisponível') || content.includes('indisponivel')) {
          console.log('⚠️  INPI em manutenção');
          await browser.close();
          failedScrapes++;
          continue;
        }
        
        // Tentar fazer busca pela patente
        console.log(`🔎 Buscando patente ${patentNumber}...`);
        
        // Localizar campo de busca
        const searchInput = await page.$('input[name="NumPedido"]') || 
                           await page.$('input[type="text"]') ||
                           await page.$('input[name="search"]');
        
        if (searchInput) {
          await searchInput.type(patentNumber, { delay: 50 });
          await page.waitForTimeout(1000);
          
          // Clicar em buscar
          const searchButton = await page.$('input[type="submit"]') || 
                             await page.$('button[type="submit"]') ||
                             await page.$('button:contains("Buscar")') ||
                             await page.$('input[value="Buscar"]');
          
          if (searchButton) {
            await searchButton.click();
            await page.waitForTimeout(3000);
            
            // Verificar resultados
            const resultsContent = await page.content();
            
            if (resultsContent.includes(patentNumber) || 
                resultsContent.includes('resultado') || 
                resultsContent.includes('patente')) {
              console.log('✅ Patente encontrada no INPI');
              successfulScrapes++;
              
              // Tirar screenshot para documentação
              await page.screenshot({ 
                path: `screenshot-${patentNumber}-proxy-${currentProxyIndex + 1}.png`,
                fullPage: true 
              });
              console.log('📸 Screenshot salvo');
              
            } else {
              console.log('❌ Patente não encontrada nos resultados');
              failedScrapes++;
            }
            
          } else {
            console.log('❌ Botão de busca não encontrado');
            failedScrapes++;
          }
          
        } else {
          console.log('❌ Campo de busca não encontrado');
          failedScrapes++;
        }
        
        await browser.close();
        
      } catch (inpiError) {
        console.log('❌ Erro ao acessar INPI:', inpiError.message);
        await browser.close();
        failedScrapes++;
      }
      
    } catch (browserError) {
      console.log('❌ Erro geral do browser:', browserError.message);
      failedScrapes++;
    }
    
    // Rotacionar proxy para próximo teste
    currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
    console.log(`🔄 Próximo proxy: ${proxies[currentProxyIndex].server}`);
    
    // Aguardar entre requisições para evitar bloqueio
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log(`\n📊 Resultado final:`);
  console.log(`✅ Scrapes bem-sucedidos: ${successfulScrapes}`);
  console.log(`❌ Scrapes falhos: ${failedScrapes}`);
  console.log(`📈 Taxa de sucesso: ${((successfulScrapes / testPatents.length) * 100).toFixed(1)}%`);
}

// Executar teste
testProxyScraping().catch(console.error);