const { scrapeInpiPatent } = require('./dist/services/inpiScraperEnhanced');

console.log('🚀 Testando scraper do INPI com patente BR102021006956...');

scrapeInpiPatent('BR102021006956')
  .then(result => {
    console.log('✅ SUCESSO! Dados obtidos:');
    console.log(JSON.stringify({
      numeroProcesso: result.numeroProcesso,
      titulo: result.titulo,
      status: result.status,
      dataDeposito: result.dataDeposito,
      titular: result.titular,
      inventor: result.inventor
    }, null, 2));
  })
  .catch(error => {
    console.log('❌ ERRO:');
    console.error(error.message);
    if (error.stack) console.error(error.stack);
  });