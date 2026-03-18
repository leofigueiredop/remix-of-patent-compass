const https = require('https');
const fs = require('fs');

async function testInpiEndpoints() {
    console.log('🔍 Testando endpoints do INPI...\n');
    
    const endpoints = [
        'https://busca.inpi.gov.br/pePI/',
        'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login',
        'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp',
        'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=BR102016023892'
    ];
    
    for (const url of endpoints) {
        console.log(`📋 Testando: ${url}`);
        
        try {
            const html = await fetchUrl(url);
            
            // Análise de tecnologia
            const techAnalysis = {
                javaApplet: html.includes('<applet') || html.includes('java:') || html.includes('javax.swing'),
                php: html.includes('.php') || html.includes('PHP_') || html.includes('php/'),
                jsp: html.includes('.jsp') || html.includes('jsp:') || html.includes('servlet'),
                javascript: (html.match(/<script/g) || []).length > 2,
                brokenLinks: html.includes('404') || html.includes('página não encontrada') || html.includes('erro'),
                maintenance: html.includes('manutenção') || html.includes('indisponível'),
                sessionExpired: html.includes('sessão expirada') || html.includes('login')
            };
            
            console.log('   Tecnologias detectadas:');
            console.log(`   • Java Applet: ${techAnalysis.javaApplet ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • PHP: ${techAnalysis.php ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • JSP: ${techAnalysis.jsp ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • JavaScript: ${techAnalysis.javascript ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • Links quebrados: ${techAnalysis.brokenLinks ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • Em manutenção: ${techAnalysis.maintenance ? '🔴 SIM' : '✅ Não'}`);
            console.log(`   • Sessão expirada: ${techAnalysis.sessionExpired ? '🔴 SIM' : '✅ Não'}`);
            
            // Salvar para análise
            const filename = url.replace(/[^a-z0-9]/gi, '_') + '.html';
            fs.writeFileSync(`/tmp/${filename}`, html);
            console.log(`   📁 HTML salvo: /tmp/${filename}`);
            
        } catch (error) {
            console.log(`   ❌ Erro: ${error.message}`);
        }
        
        console.log('');
    }
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        console.log(`   📡 Conectando...`);
        const req = https.get(url, (res) => {
            console.log(`   📊 Status: ${res.statusCode} ${res.statusMessage}`);
            console.log(`   🔗 Redirect: ${res.headers.location || 'Nenhum'}`);
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout após 10 segundos'));
        });
    });
}

// Executar teste
console.log('🚀 Iniciando diagnóstico do INPI...\n');
testInpiEndpoints().catch(console.error);