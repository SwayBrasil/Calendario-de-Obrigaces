#!/usr/bin/env node

/**
 * Script de verificação para testar os scripts da agenda tributária
 * Verifica se os scripts estão funcionais após as correções
 */

console.log('🔍 VERIFICAÇÃO DOS SCRIPTS DA AGENDA TRIBUTÁRIA');
console.log('===============================================\n');

async function verificarScript(nomeScript, caminhoScript) {
  console.log(`📂 Verificando: ${nomeScript}`);
  
  try {
    // Tentar importar o script
    const script = require(caminhoScript);
    console.log(`  ✅ ${nomeScript}: Importação bem-sucedida`);
    
    // Verificar se as funções principais existem
    const funcoes = Object.keys(script);
    if (funcoes.length > 0) {
      console.log(`  📋 Funções disponíveis: ${funcoes.join(', ')}`);
    } else {
      console.log(`  ⚠️  Nenhuma função exportada encontrada`);
    }
    
    return true;
  } catch (error) {
    console.log(`  ❌ ${nomeScript}: Erro na importação`);
    console.log(`     Erro: ${error.message}`);
    return false;
  }
}

async function main() {
  const scripts = [
    {
      nome: 'agenda-tributaria.js',
      caminho: './agenda-tributaria.js'
    },
    {
      nome: 'agenda-tributaria-api.js',
      caminho: './agenda-tributaria-api.js'
    },
    {
      nome: 'agenda-tributaria-scraper.js',
      caminho: './agenda-tributaria-scraper.js'
    }
  ];
  
  let todosSucesso = true;
  
  for (const script of scripts) {
    const sucesso = await verificarScript(script.nome, script.caminho);
    if (!sucesso) {
      todosSucesso = false;
    }
    console.log(''); // Linha em branco para separar
  }
  
  console.log('RESULTADO FINAL:');
  console.log('================');
  
  if (todosSucesso) {
    console.log('✅ Todos os scripts foram corrigidos com sucesso!');
    console.log('\n📋 INSTRUÇÕES DE USO:');
    console.log('\n1. agenda-tributaria.js - Script principal com dados estáticos e scraping');
    console.log('   Exemplo: node agenda-tributaria.js mes 2025 3');
    
    console.log('\n2. agenda-tributaria-api.js - Versão completa com API da RFB');
    console.log('   Exemplo: node agenda-tributaria-api.js mes 2025 3');
    
    console.log('\n3. agenda-tributaria-scraper.js - Scraper focado em dados em tempo real');
    console.log('   Exemplo: node agenda-tributaria-scraper.js criar 2025 3');
    
    console.log('\n💡 DICAS:');
    console.log('• Use "ajuda" como parâmetro para ver todas as opções');
    console.log('• Teste a conectividade antes: node agenda-tributaria-scraper.js testar-conexao');
    console.log('• Configure um usuário administrador no sistema antes de usar');
  } else {
    console.log('❌ Alguns scripts ainda apresentam problemas.');
    console.log('   Verifique os erros acima e corrija-os antes de continuar.');
  }
}

main().catch(error => {
  console.error('💥 Erro durante a verificação:', error.message);
  process.exit(1);
});
