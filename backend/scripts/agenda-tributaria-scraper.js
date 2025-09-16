const cheerio = require('cheerio');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const fs = require('fs').promises;
const path = require('path');
const { createTask, getUserByEmail, getAllUsers, checkTaskExists } = require('../database');
const { v4: uuidv4 } = require('uuid');

// URLs da Receita Federal para consulta (atualizadas para 2025)
const RFB_URLS = {
  agendaTributaria: 'https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/2025',
  obrigacoesAcessorias: 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/obrigacoes-acessorias'
};

// Cache para evitar requests desnecessários
let cacheAgendaTributaria = null;
let cacheExpiry = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Busca informações da agenda tributária diretamente do site da Receita Federal
 */
async function buscarAgendaTributariaRFB() {
  console.log('🔍 Buscando informações atualizadas da Receita Federal...');
  
  try {
    // Verificar cache
    if (cacheAgendaTributaria && cacheExpiry && Date.now() < cacheExpiry) {
      console.log('📋 Usando informações em cache');
      return cacheAgendaTributaria;
    }

    let agendaCompleta = {};
    const anoAtual = new Date().getFullYear();
    
    // Headers para parecer um navegador real
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
    
    // Buscar página principal da agenda tributária
    console.log('📅 Acessando página principal da agenda tributária...');
    const response = await axios.get(RFB_URLS.agendaTributaria, {
      headers,
      timeout: 30000,
      maxRedirects: 5
    });
    
    const $ = cheerio.load(response.data);
    
    // Encontrar links para páginas mensais
    const mesesLinks = [];
    const mesesMap = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6,
      'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
    };
    
    $('a[href*="/assuntos/agenda-tributaria/2025/"]').each((i, el) => {
      const href = $(el).attr('href');
      const texto = $(el).text().toLowerCase();
      const mesesValidos = Object.keys(mesesMap);
      if (mesesValidos.some(mes => href.toLowerCase().includes(mes) || texto.includes(mes))) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, 'https://www.gov.br').href;
        mesesLinks.push(fullUrl);
      }
    });
    
    console.log(`📅 Encontrados ${mesesLinks.length} links de meses`);

    // Processar cada mês
    for (const [index, link] of mesesLinks.entries()) {
      try {
        console.log(`📅 Processando link ${index + 1}/${mesesLinks.length}: ${link}`);
        
        const mesResponse = await axios.get(link, { 
          headers, 
          timeout: 30000,
          maxRedirects: 5
        });
        const $mes = cheerio.load(mesResponse.data);
        
        // Identificar mês a partir da URL ou conteúdo
        let mesIdentificado = null;
        for (const [nomeMes, numeroMes] of Object.entries(mesesMap)) {
          if (link.toLowerCase().includes(nomeMes) || 
              $mes('title').text().toLowerCase().includes(nomeMes) ||
              $mes('h1, h2, h3').text().toLowerCase().includes(nomeMes)) {
            mesIdentificado = numeroMes;
            break;
          }
        }
        
        if (!mesIdentificado) {
          console.warn(`⚠️ Não foi possível identificar o mês para: ${link}`);
          continue;
        }
        
        const obrigacoesMes = [];
        
        // Parsear tabelas de obrigações
        $mes('table').each((i, tabela) => {
          $mes(tabela).find('tr').each((j, row) => {
            const colunas = $mes(row).find('td');
            if (colunas.length >= 3) {
              const titulo = colunas.eq(0).text().trim();
              const prazo = colunas.eq(1).text().trim();
              const observacoes = colunas.length > 2 ? colunas.eq(2).text().trim() : '';
              
              if (titulo && prazo && titulo.length > 5 && !titulo.match(/^(título|obrigação|data)$/i)) {
                // Extrair data do prazo
                const dataMatch = prazo.match(/(\d{1,2})(?:\/(\d{1,2}))?\/(\d{4})|até\s+(\d{1,2})(?:º)?/i);
                if (dataMatch) {
                  const dia = parseInt(dataMatch[1] || dataMatch[4]);
                  if (dia >= 1 && dia <= 31) {
                    obrigacoesMes.push({
                      titulo: titulo,
                      vencimento: dia,
                      observacoes: observacoes || `Prazo: ${prazo}. Extraído da Receita Federal.`,
                      fonte: 'RFB Scraper',
                      link: link
                    });
                  }
                }
              }
            }
          });
        });
        
        // Parsear listas de obrigações
        $mes('ul, ol').each((i, lista) => {
          $mes(lista).find('li').each((j, item) => {
            const texto = $mes(item).text().trim();
            
            // Procurar padrões de data no texto
            const patterns = [
              /(.+?)\s*[-–:]\s*até\s+(\d{1,2})(?:º)?/i,
              /(.+?)\s*[-–:]\s*(\d{1,2})(?:º)?\s*(?:de|\/)\w+/i,
              /(.+?)\s*vencimento\s*:?\s*(\d{1,2})(?:º)?/i
            ];
            
            for (const pattern of patterns) {
              const match = texto.match(pattern);
              if (match) {
                const titulo = match[1].trim();
                const dia = parseInt(match[2]);
                
                if (titulo.length > 5 && dia >= 1 && dia <= 31) {
                  const existe = obrigacoesMes.some(o => 
                    o.titulo.toLowerCase().includes(titulo.toLowerCase().substring(0, 10))
                  );
                  
                  if (!existe) {
                    obrigacoesMes.push({
                      titulo: titulo,
                      vencimento: dia,
                      observacoes: `Texto original: ${texto}. Extraído da Receita Federal.`,
                      fonte: 'RFB Scraper',
                      link: link
                    });
                  }
                  break;
                }
              }
            }
          });
        });
        
        if (obrigacoesMes.length > 0) {
          agendaCompleta[mesIdentificado] = obrigacoesMes;
          console.log(`✅ Mês ${mesIdentificado}: ${obrigacoesMes.length} obrigações encontradas`);
        }
        
        // Pequeno delay para não sobrecarregar o servidor
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.warn(`⚠️ Erro ao processar link ${link}:`, error.message);
      }
    }
    
    // Atualizar cache
    cacheAgendaTributaria = agendaCompleta;
    cacheExpiry = Date.now() + CACHE_DURATION;
    
    // Salvar backup local
    await salvarBackupAgenda(agendaCompleta);
    
    console.log(`✅ Scraping concluído! Meses processados: ${Object.keys(agendaCompleta).length}`);
    return agendaCompleta;
    
  } catch (error) {
    console.error('❌ Erro ao buscar agenda tributária:', error.message);
    
    // Tentar carregar backup local
    const backup = await carregarBackupAgenda();
    if (backup) {
      console.log('📋 Usando backup local da agenda');
      return backup;
    }
    
    throw error;
  }
}

/**
 * Salva backup local da agenda tributária
 */
async function salvarBackupAgenda(agenda) {
  try {
    const backupPath = path.join(__dirname, 'backup-agenda-scraper.json');
    const dados = {
      agenda,
      dataAtualizacao: new Date().toISOString(),
      fonte: 'Receita Federal do Brasil (Scraper)'
    };
    await fs.writeFile(backupPath, JSON.stringify(dados, null, 2), 'utf8');
    console.log('💾 Backup da agenda salvo com sucesso');
  } catch (error) {
    console.warn('⚠️ Erro ao salvar backup da agenda:', error.message);
  }
}

/**
 * Carrega backup local da agenda tributária
 */
async function carregarBackupAgenda() {
  try {
    const backupPath = path.join(__dirname, 'backup-agenda-scraper.json');
    const dados = await fs.readFile(backupPath, 'utf8');
    const backup = JSON.parse(dados);
    
    const dataBackup = new Date(backup.dataAtualizacao);
    const agora = new Date();
    const diasDiferenca = (agora - dataBackup) / (1000 * 60 * 60 * 24);
    
    if (diasDiferenca <= 7) {
      return backup.agenda;
    } else {
      console.log('📋 Backup da agenda está desatualizado');
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Cria tarefas com base nos dados extraídos
 */
async function criarTarefasComScraper(ano, mes, responsavelEmail = null) {
  try {
    console.log(`\n=== Criando tarefas via Scraper - ${mes}/${ano} ===`);
    
    // Validar entrada
    const anoAtual = new Date().getFullYear();
    if (!ano || ano < 2000 || ano > anoAtual + 1) {
      throw new Error(`Ano inválido: ${ano}`);
    }
    if (!mes || mes < 1 || mes > 12) {
      throw new Error(`Mês inválido: ${mes}`);
    }
    
    // Buscar dados atualizados
    const agendaCompleta = await buscarAgendaTributariaRFB();
    
    if (!agendaCompleta[mes] || agendaCompleta[mes].length === 0) {
      throw new Error(`Nenhuma obrigação encontrada para o mês ${mes}`);
    }
    
    // Buscar responsável
    let responsavel;
    if (responsavelEmail) {
      responsavel = await getUserByEmail(responsavelEmail);
      if (!responsavel) {
        console.log(`❌ Email ${responsavelEmail} não encontrado. Buscando administrador...`);
        responsavel = null;
      }
    }
    
    if (!responsavel) {
      const users = await getAllUsers();
      responsavel = users.find(user => user.cargo === 'admin');
      if (!responsavel) {
        throw new Error('Nenhum usuário administrador encontrado no sistema');
      }
    }
    
    console.log(`✅ Responsável definido: ${responsavel.nome_completo} (${responsavel.email})`);
    
    const obrigacoes = agendaCompleta[mes];
    const tarefasCriadas = [];
    
    // Criar tarefas
    for (const obrigacao of obrigacoes) {
      const dataVencimento = new Date(ano, mes - 1, obrigacao.vencimento);
      
      const taskData = {
        id: uuidv4(),
        titulo: obrigacao.titulo,
        responsavel: responsavel.nome_completo,
        responsavelId: responsavel.uid,
        dataVencimento: dataVencimento.toISOString(),
        observacoes: `${obrigacao.observacoes}\n\n📅 Vencimento: ${obrigacao.vencimento}/${mes}/${ano}\n🔍 Fonte: ${obrigacao.fonte}\n🌐 Link: ${obrigacao.link}\n📊 Extraído em: ${new Date().toLocaleDateString('pt-BR')}`,
        recorrente: true,
        frequencia: 'mensal'
      };
      
      try {
        // Verificar se tarefa já existe
        const existe = await checkTaskExists(taskData.titulo, dataVencimento);
        if (!existe) {
          await createTask(taskData);
          tarefasCriadas.push(taskData);
          console.log(`✅ ${obrigacao.titulo} - Vencimento: ${dataVencimento.toLocaleDateString('pt-BR')}`);
        } else {
          console.log(`⏭️ Tarefa já existe: ${obrigacao.titulo}`);
        }
      } catch (error) {
        console.error(`❌ Erro ao criar tarefa "${obrigacao.titulo}": ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Scraper concluído! ${tarefasCriadas.length} tarefas criadas para ${mes}/${ano}`);
    
    return {
      sucesso: true,
      mes,
      ano,
      responsavel: responsavel.nome_completo,
      tarefasCriadas: tarefasCriadas.length,
      tarefas: tarefasCriadas
    };
    
  } catch (error) {
    console.error(`❌ Erro no scraper para ${mes}/${ano}:`, error.message);
    return {
      sucesso: false,
      erro: error.message
    };
  }
}

/**
 * Função principal para execução via linha de comando
 */
async function main() {
  const args = process.argv.slice(2);
  const comando = args[0];
  
  if (!comando) {
    console.log(`
🔍 SCRAPER DA AGENDA TRIBUTÁRIA
==============================

Uso:
  node agenda-tributaria-scraper.js buscar                    # Buscar agenda atualizada
  node agenda-tributaria-scraper.js criar <ano> <mes> [email] # Criar tarefas via scraper
  node agenda-tributaria-scraper.js limpar-cache              # Limpar cache
  node agenda-tributaria-scraper.js ajuda                     # Ver ajuda

Exemplos:
  node agenda-tributaria-scraper.js buscar
  node agenda-tributaria-scraper.js criar 2025 3 admin@empresa.com
    `);
    return;
  }
  
  try {
    switch (comando.toLowerCase()) {
      case 'buscar':
        const agenda = await buscarAgendaTributariaRFB();
        console.log('\n📊 AGENDA ENCONTRADA:');
        for (const [mes, obrigacoes] of Object.entries(agenda)) {
          console.log(`  Mês ${mes}: ${obrigacoes.length} obrigações`);
        }
        break;
        
      case 'criar':
        const ano = parseInt(args[1]);
        const mes = parseInt(args[2]);
        const email = args[3] || null;
        
        if (!ano || !mes) {
          console.error('❌ Ano e mês são obrigatórios');
          return;
        }
        
        await criarTarefasComScraper(ano, mes, email);
        break;
        
      case 'limpar-cache':
        cacheAgendaTributaria = null;
        cacheExpiry = null;
        console.log('🗑️ Cache limpo com sucesso!');
        break;
        
      case 'ajuda':
      case 'help':
        console.log(`
🔍 SCRAPER DA AGENDA TRIBUTÁRIA
==============================

Este script extrai informações diretamente do site da Receita Federal.

Funcionalidades:
- Extração automática de obrigações tributárias
- Cache local para reduzir requisições
- Backup automático dos dados
- Criação de tarefas no sistema
- Detecção de tarefas duplicadas

Vantagens:
✅ Dados sempre atualizados
✅ Extração inteligente de datas
✅ Backup e cache automáticos
✅ Integração com sistema de tarefas
        `);
        break;
        
      default:
        console.error(`❌ Comando "${comando}" não reconhecido.`);
    }
    
  } catch (error) {
    console.error('❌ Erro na execução:', error.message);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().then(() => {
    console.log('\n✨ Execução finalizada!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Erro fatal:', error.message);
    process.exit(1);
  });
}

module.exports = {
  buscarAgendaTributariaRFB,
  criarTarefasComScraper,
  salvarBackupAgenda,
  carregarBackupAgenda
};
