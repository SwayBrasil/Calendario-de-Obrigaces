// Worker para processar comparação de forma assíncrona em background
const fs = require('fs');
const path = require('path');
const { format, parse, isValid } = require('date-fns');

const { parseOtimizaTxt } = require('../services/rpa/parsers/otimizaTxtParser');
const { parseMpdsCsv } = require('../services/rpa/parsers/mpdsCsvParser');
const { parseMpdsOfx } = require('../services/rpa/parsers/mpdsOfxParser');
const { parseMpdsPdf } = require('../services/rpa/parsers/mpdsPdfParser');
const { compareBankVsTxt } = require('../services/rpa/comparador/motor');
const { validateLancamentosAccounts } = require('../services/rpa/validations/accountValidation');

const {
  updateComparacaoStatus,
  createDivergencia,
  deleteDivergenciasByComparacaoId,
  deleteAccountValidationResultsByComparacaoId
} = require('../database');

/**
 * Processa uma comparação de forma assíncrona.
 */
async function processarComparacao(comparacaoId, db) {
  const { getComparacaoById } = require('../database');

  try {
    console.log(`[WORKER] Iniciando processamento da comparação ${comparacaoId}`);

    // Atualiza status para "processing"
    await updateComparacaoStatus(comparacaoId, 'processing', null, {
      started_at: new Date().toISOString()
    });

    // Busca comparação
    const comparacao = await getComparacaoById(comparacaoId);
    if (!comparacao) {
      throw new Error(`Comparação ${comparacaoId} não encontrada`);
    }

    const inputFiles = comparacao.input_files || {};
    const periodoInicio = comparacao.periodo_inicio;
    const periodoFim = comparacao.periodo_fim;

    // Diretório para salvar arquivos temporários
    const dataDir = path.join(__dirname, '../../data');
    const otimizaDir = path.join(dataDir, 'otimiza');
    const mpdsDir = path.join(dataDir, 'mpds');

    // Cria diretórios se não existirem
    [dataDir, otimizaDir, mpdsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');

    // 1. Processa arquivos TXT Otimiza
    let lancamentosOtimiza = [];
    let allIssues = [];
    const parsingInfo = {};

    if (inputFiles.otimiza && inputFiles.otimiza.length > 0) {
      for (let idx = 0; idx < inputFiles.otimiza.length; idx++) {
        const fileData = inputFiles.otimiza[idx];
        const fileName = fileData.filename || `otimiza_${idx}.txt`;
        const fileBuffer = Buffer.from(fileData.buffer, 'base64');

        // Salva arquivo
        const filePath = path.join(otimizaDir, `${timestamp}_${idx}_${fileName}`);
        fs.writeFileSync(filePath, fileBuffer);

        console.log(`[WORKER] Processando arquivo TXT Otimiza ${idx + 1}/${inputFiles.otimiza.length}: ${fileName}`);

        try {
          const { lancamentos, issues } = await parseOtimizaTxt(filePath, false);

          // Normaliza sinal baseado no tipo do arquivo (PAGAR/RECEBER)
          const fileNameUpper = fileName.toUpperCase();
          if (fileNameUpper.includes('PAGAR')) {
            // Arquivo PAGAR: valores devem ser negativos
            lancamentos.forEach(l => {
              l.valor = -Math.abs(l.valor);
            });
          } else if (fileNameUpper.includes('RECEBER')) {
            // Arquivo RECEBER: valores devem ser positivos
            lancamentos.forEach(l => {
              l.valor = Math.abs(l.valor);
            });
          }

          lancamentosOtimiza.push(...lancamentos);
          allIssues.push(...issues.map(issue => `[${fileName}] ${issue}`));

          parsingInfo[fileName] = {
            path: filePath,
            lancamentos_count: lancamentos.length,
            issues_count: issues.length,
            issues: issues
          };

          console.log(`[WORKER] Arquivo ${fileName}: ${lancamentos.length} lançamentos extraídos, ${issues.length} issues`);
        } catch (error) {
          const errorMsg = `Erro ao processar ${fileName}: ${error.message}`;
          console.error(`[WORKER] ${errorMsg}`, error);
          allIssues.push(`[${fileName}] ERRO: ${errorMsg}`);
          parsingInfo[fileName] = {
            path: filePath,
            lancamentos_count: 0,
            issues_count: 1,
            issues: [errorMsg],
            error: error.message
          };
        }
      }

      // Remove duplicidades
      const seen = new Set();
      const lancamentosUnicos = [];

      lancamentosOtimiza.forEach(lanc => {
        const descNormalizada = lanc.descricao.trim().toUpperCase().substring(0, 50);
        const chave = `${lanc.data}|${descNormalizada}|${Math.round(lanc.valor * 100) / 100}`;

        if (!seen.has(chave)) {
          seen.add(chave);
          lancamentosUnicos.push(lanc);
        }
      });

      const duplicadosRemovidos = lancamentosOtimiza.length - lancamentosUnicos.length;
      if (duplicadosRemovidos > 0) {
        console.log(`[WORKER] Removidos ${duplicadosRemovidos} lançamentos duplicados`);
        allIssues.push(`Removidos ${duplicadosRemovidos} lançamentos duplicados entre arquivos`);
      }

      lancamentosOtimiza = lancamentosUnicos;
      console.log(`[WORKER] Total unificado: ${lancamentosOtimiza.length} lançamentos únicos`);
    }

    // 2. Processa arquivo MPDS (extrato bancário)
    let lancamentosExtrato = [];
    let bankSourceType = comparacao.bank_source_type || 'CSV';

    if (inputFiles.mpds && inputFiles.mpds.length > 0) {
      const fileData = inputFiles.mpds[0];
      const fileName = fileData.filename || 'extrato';
      const fileBuffer = Buffer.from(fileData.buffer, 'base64');

      // Detecta tipo pela extensão
      const fileExt = path.extname(fileName).toLowerCase();
      if (fileExt === '.csv') {
        bankSourceType = 'CSV';
      } else if (fileExt === '.ofx') {
        bankSourceType = 'OFX';
      } else if (fileExt === '.pdf') {
        bankSourceType = 'PDF';
      }

      // Salva arquivo
      const filePath = path.join(mpdsDir, `${timestamp}_${fileName}`);
      fs.writeFileSync(filePath, fileBuffer);

      console.log(`[WORKER] Processando arquivo MPDS: ${fileName} (tipo: ${bankSourceType})`);

      try {
        let result;
        if (bankSourceType === 'CSV') {
          result = await parseMpdsCsv(filePath, false);
        } else if (bankSourceType === 'OFX') {
          result = await parseMpdsOfx(filePath, false);
        } else if (bankSourceType === 'PDF') {
          result = await parseMpdsPdf(filePath, false);
        } else {
          throw new Error(`Tipo de arquivo não suportado: ${bankSourceType}`);
        }

        lancamentosExtrato = result.lancamentos || [];
        allIssues.push(...(result.issues || []).map(issue => `[${fileName}] ${issue}`));

        console.log(`[WORKER] Arquivo ${fileName}: ${lancamentosExtrato.length} lançamentos extraídos`);
      } catch (error) {
        const errorMsg = `Erro ao processar ${fileName}: ${error.message}`;
        console.error(`[WORKER] ${errorMsg}`, error);
        allIssues.push(`[${fileName}] ERRO: ${errorMsg}`);
        throw error;
      }
    }

    // 3. Executa comparação
    console.log(`[WORKER] Executando comparação: ${lancamentosExtrato.length} vs ${lancamentosOtimiza.length}`);
    const divergencias = compareBankVsTxt(
      lancamentosExtrato,
      lancamentosOtimiza,
      2, // dateWindowDays
      0.01, // amountTolerance
      0.55, // minDescriptionSimilarity
      true // allowManyToOne
    );

    console.log(`[WORKER] Comparação concluída: ${divergencias.length} divergências encontradas`);

    // 4. Deleta divergências antigas (se houver)
    await deleteDivergenciasByComparacaoId(comparacaoId);

    // 5. Salva divergências no banco
    for (const div of divergencias) {
      await createDivergencia({
        comparacao_id: comparacaoId,
        tipo: div.tipo,
        descricao: div.descricao,
        data_extrato: div.data_extrato,
        descricao_extrato: div.descricao_extrato,
        valor_extrato: div.valor_extrato,
        documento_extrato: div.documento_extrato,
        conta_contabil_extrato: div.conta_contabil_extrato,
        data_dominio: div.data_dominio,
        descricao_dominio: div.descricao_dominio,
        valor_dominio: div.valor_dominio,
        documento_dominio: div.documento_dominio,
        conta_contabil_dominio: div.conta_contabil_dominio
      });
    }

    // 6. Valida contas (se plano de contas disponível)
    let validationSummary = null;
    try {
      validationSummary = await validateLancamentosAccounts(
        comparacaoId,
        lancamentosOtimiza,
        'dominio',
        db
      );
      console.log(`[WORKER] Validação de contas concluída: ${JSON.stringify(validationSummary)}`);
    } catch (error) {
      console.warn(`[WORKER] Erro na validação de contas: ${error.message}`);
      // Não falha a comparação se a validação falhar
    }

    // 7. Atualiza status para "concluida"
    await updateComparacaoStatus(comparacaoId, 'concluida', null, {
      finished_at: new Date().toISOString(),
      qtd_lancamentos_extrato: lancamentosExtrato.length,
      qtd_lancamentos_razao: lancamentosOtimiza.length,
      qtd_divergencias: divergencias.length,
      parsing_issues: {
        issues: allIssues,
        parsing_info: parsingInfo
      }
    });

    console.log(`[WORKER] Processamento da comparação ${comparacaoId} concluído com sucesso`);

    return {
      comparacaoId,
      lancamentosExtrato: lancamentosExtrato.length,
      lancamentosOtimiza: lancamentosOtimiza.length,
      divergencias: divergencias.length,
      validationSummary
    };
  } catch (error) {
    console.error(`[WORKER] Erro ao processar comparação ${comparacaoId}:`, error);

    // Atualiza status para "erro"
    await updateComparacaoStatus(comparacaoId, 'erro', error.message, {
      finished_at: new Date().toISOString()
    });

    throw error;
  }
}

module.exports = {
  processarComparacao
};

