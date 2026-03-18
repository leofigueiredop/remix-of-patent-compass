import { testInpiWorker } from '../src/services/inpiWorker';

async function main() {
    try {
        // Testar com uma patente conhecida
        const patentNumber = 'BR102021006956'; // Patente de teste
        console.log(`🧪 Testando INPI Worker com patente: ${patentNumber}`);
        
        await testInpiWorker(patentNumber);
        
        console.log('✅ Teste concluído com sucesso!');
    } catch (error) {
        console.error('❌ Erro no teste:', error);
        process.exit(1);
    }
}

main();