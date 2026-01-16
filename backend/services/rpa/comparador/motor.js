// Motor de comparação entre extratos bancários e razão analítico do Domínio
const { format, parse, isValid, differenceInDays } = require('date-fns');

/**
 * Normaliza descrição para comparação:
 * - Converte para minúsculas
 * - Remove acentos (simplificado)
 * - Normaliza espaços múltiplos
 * - Remove informações redundantes de PIX (DOC, CNPJ/CPF, PGT/PGTO, etc.)
 */
function normalizarDescricao(descricao) {
  if (!descricao) {
    return '';
  }

  // Converte para minúsculas
  let desc = descricao.toLowerCase().trim();

  // Remove acentos (mapeamento básico)
  const acentos = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n'
  };

  for (const [acento, semAcento] of Object.entries(acentos)) {
    desc = desc.replace(new RegExp(acento, 'g'), semAcento);
  }

  // Remove informações redundantes de PIX/transações
  // Remove DOC. seguido de números
  desc = desc.replace(/\bdoc\.?\s*\d+\b/g, '');
  // Remove CNPJ/CPF (formato XX.XXX.XXX/XXXX-XX ou XXX.XXX.XXX-XX)
  desc = desc.replace(/\b\d{2,3}\.?\d{3}\.?\d{3}[\/-]?\d{2,4}[-\s]?\d{2}\b/g, '');
  // Remove "PGT", "PGTO", "PAGTO" seguido de números
  desc = desc.replace(/\b(pgt|pgto|pagto)\.?\s*\d*\b/gi, '');
  // Remove "NU PAGAMENTOS", "IP", "AGENCIA", "CONTA" seguido de números
  desc = desc.replace(/\b(nu\s+pagamentos|ip|agencia|conta)\s*:?\s*\d+[-\s]?\d*\b/gi, '');
  // Remove "•••" (mascaramento de CPF)
  desc = desc.replace(/•+/g, '');

  // Normaliza espaços múltiplos
  desc = desc.replace(/\s+/g, ' ');

  return desc.trim();
}

/**
 * Retorna chave de match principal: (data, valor_arredondado).
 */
function chavePrincipal(lancamento, arredondarValor = true) {
  const valor = arredondarValor ? Math.round(lancamento.valor * 100) / 100 : lancamento.valor;
  const data = typeof lancamento.data === 'string' ? lancamento.data : format(lancamento.data, 'yyyy-MM-dd');
  return `${data}|${valor}`;
}

/**
 * Retorna chave de match por documento: (data, documento).
 */
function chaveDocumento(lancamento) {
  if (!lancamento.documento || lancamento.documento.trim() === '') {
    return null;
  }
  const data = typeof lancamento.data === 'string' ? lancamento.data : format(lancamento.data, 'yyyy-MM-dd');
  return `${data}|${lancamento.documento.trim().toUpperCase()}`;
}

/**
 * Retorna chave de match por descrição normalizada: (data, descricao_normalizada).
 */
function chaveDescricao(lancamento) {
  const descNormalizada = normalizarDescricao(lancamento.descricao);
  const data = typeof lancamento.data === 'string' ? lancamento.data : format(lancamento.data, 'yyyy-MM-dd');
  return `${data}|${descNormalizada}`;
}

/**
 * Detecta lançamentos com mesma data + documento (ou descrição) mas valor diferente.
 */
function detectarValorDiferente(lancExtrato, lancRazao, toleranciaValor, casados) {
  const divergencias = [];

  // Índice por (data, documento) do razão
  const indiceDocRazao = new Map();
  lancRazao.forEach((l, idx) => {
    const chave = chaveDocumento(l);
    if (chave) {
      if (!indiceDocRazao.has(chave)) {
        indiceDocRazao.set(chave, []);
      }
      indiceDocRazao.get(chave).push(idx);
    }
  });

  // Índice por (data, descrição_normalizada) do razão (fallback)
  const indiceDescRazao = new Map();
  lancRazao.forEach((l, idx) => {
    const chave = chaveDescricao(l);
    if (!indiceDescRazao.has(chave)) {
      indiceDescRazao.set(chave, []);
    }
    indiceDescRazao.get(chave).push(idx);
  });

  // Para cada lançamento do extrato
  lancExtrato.forEach((lancExt, idxExt) => {
    // Tenta match por documento primeiro
    const chaveDoc = chaveDocumento(lancExt);
    let matchEncontrado = false;

    if (chaveDoc && indiceDocRazao.has(chaveDoc)) {
      for (const idxRaz of indiceDocRazao.get(chaveDoc)) {
        const lancRaz = lancRazao[idxRaz];

        // Verifica se já foi casado
        if (casados.has(`${idxExt}|${idxRaz}`)) {
          continue;
        }

        // Verifica diferença de valor
        const diffValor = Math.abs(lancExt.valor - lancRaz.valor);
        if (diffValor > toleranciaValor) {
          divergencias.push({
            tipo: 'VALOR_DIFERENTE',
            descricao: (
              `Lançamento com mesmo documento (${lancExt.documento}) ` +
              `e data (${lancExt.data}) tem valor diferente. ` +
              `Extrato: R$ ${lancExt.valor.toFixed(2)}, ` +
              `Domínio: R$ ${lancRaz.valor.toFixed(2)} ` +
              `(diferença: R$ ${diffValor.toFixed(2)})`
            ),
            data_extrato: lancExt.data,
            descricao_extrato: lancExt.descricao,
            valor_extrato: lancExt.valor,
            documento_extrato: lancExt.documento,
            conta_contabil_extrato: lancExt.conta_contabil,
            data_dominio: lancRaz.data,
            descricao_dominio: lancRaz.descricao,
            valor_dominio: lancRaz.valor,
            documento_dominio: lancRaz.documento,
            conta_contabil_dominio: lancRaz.conta_contabil
          });
          casados.add(`${idxExt}|${idxRaz}`);
          matchEncontrado = true;
          break;
        }
      }
    }

    // Se não encontrou por documento, tenta por descrição normalizada
    if (!matchEncontrado) {
      const chaveDesc = chaveDescricao(lancExt);
      if (indiceDescRazao.has(chaveDesc)) {
        for (const idxRaz of indiceDescRazao.get(chaveDesc)) {
          const lancRaz = lancRazao[idxRaz];

          if (casados.has(`${idxExt}|${idxRaz}`)) {
            continue;
          }

          const diffValor = Math.abs(lancExt.valor - lancRaz.valor);
          if (diffValor > toleranciaValor) {
            // Só cria divergência se a diferença for significativa
            if (diffValor > 1.0) { // Pelo menos R$ 1,00 de diferença
              divergencias.push({
                tipo: 'VALOR_DIFERENTE',
                descricao: (
                  `Lançamento com mesma descrição e data (${lancExt.data}) ` +
                  `tem valor diferente. ` +
                  `Extrato: R$ ${lancExt.valor.toFixed(2)}, ` +
                  `Domínio: R$ ${lancRaz.valor.toFixed(2)} ` +
                  `(diferença: R$ ${diffValor.toFixed(2)})`
                ),
                data_extrato: lancExt.data,
                descricao_extrato: lancExt.descricao,
                valor_extrato: lancExt.valor,
                documento_extrato: lancExt.documento,
                conta_contabil_extrato: lancExt.conta_contabil,
                data_dominio: lancRaz.data,
                descricao_dominio: lancRaz.descricao,
                valor_dominio: lancRaz.valor,
                documento_dominio: lancRaz.documento,
                conta_contabil_dominio: lancRaz.conta_contabil
              });
              casados.add(`${idxExt}|${idxRaz}`);
              break;
            }
          }
        }
      }
    }
  });

  return divergencias;
}

/**
 * Compara lançamentos por data + valor (com tolerância).
 */
function compararPorDataValor(lancExtrato, lancRazao, toleranciaValor, casados) {
  const divergencias = [];

  // Índice do razão por (data, valor_arredondado)
  const indiceRazao = new Map();
  lancRazao.forEach((l, idx) => {
    const chave = chavePrincipal(l);
    if (!indiceRazao.has(chave)) {
      indiceRazao.set(chave, []);
    }
    indiceRazao.get(chave).push(idx);
  });

  // Índices não casados
  const indicesExtratoNaoCasados = new Set(lancExtrato.map((_, idx) => idx));
  const indicesRazaoNaoCasados = new Set(lancRazao.map((_, idx) => idx));

  // Para cada lançamento do extrato
  lancExtrato.forEach((lancExt, idxExt) => {
    if (!indicesExtratoNaoCasados.has(idxExt)) {
      return; // Já foi casado
    }

    const chave = chavePrincipal(lancExt);

    // Procura match exato primeiro
    if (indiceRazao.has(chave)) {
      for (const idxRaz of indiceRazao.get(chave)) {
        if (!indicesRazaoNaoCasados.has(idxRaz)) {
          continue;
        }

        // Verifica se já foi casado em outra etapa
        if (casados.has(`${idxExt}|${idxRaz}`)) {
          continue;
        }

        // Match encontrado!
        indicesExtratoNaoCasados.delete(idxExt);
        indicesRazaoNaoCasados.delete(idxRaz);
        casados.add(`${idxExt}|${idxRaz}`);
        break;
      }
    } else {
      // Se não encontrou match exato, tenta com tolerância
      for (let idxRaz = 0; idxRaz < lancRazao.length; idxRaz++) {
        if (!indicesRazaoNaoCasados.has(idxRaz)) {
          continue;
        }

        if (casados.has(`${idxExt}|${idxRaz}`)) {
          continue;
        }

        const lancRaz = lancRazao[idxRaz];

        // Mesma data e valor dentro da tolerância
        if (lancExt.data === lancRaz.data) {
          const diffValor = Math.abs(lancExt.valor - lancRaz.valor);
          if (diffValor <= toleranciaValor) {
            // Match com tolerância
            indicesExtratoNaoCasados.delete(idxExt);
            indicesRazaoNaoCasados.delete(idxRaz);
            casados.add(`${idxExt}|${idxRaz}`);
            break;
          }
        }
      }
    }
  });

  return { divergencias, indicesExtratoNaoCasados, indicesRazaoNaoCasados };
}

/**
 * Cria divergências para lançamentos não encontrados.
 */
function detectarFaltantes(lancExtrato, lancRazao, indicesExtratoNaoCasados, indicesRazaoNaoCasados) {
  const divergencias = [];

  // Lançamentos no extrato que não foram encontrados no domínio
  indicesExtratoNaoCasados.forEach((idx) => {
    const lanc = lancExtrato[idx];
    divergencias.push({
      tipo: 'NAO_ENCONTRADO_DOMINIO',
      descricao: (
        `Lançamento do extrato não encontrado no Domínio. ` +
        `Data: ${lanc.data}, ` +
        `Descrição: ${lanc.descricao.substring(0, 50)}, ` +
        `Valor: R$ ${lanc.valor.toFixed(2)}`
      ),
      data_extrato: lanc.data,
      descricao_extrato: lanc.descricao,
      valor_extrato: lanc.valor,
      documento_extrato: lanc.documento,
      conta_contabil_extrato: lanc.conta_contabil,
      data_dominio: null,
      descricao_dominio: null,
      valor_dominio: null,
      documento_dominio: null,
      conta_contabil_dominio: null
    });
  });

  // Lançamentos no domínio que não foram encontrados no extrato
  indicesRazaoNaoCasados.forEach((idx) => {
    const lanc = lancRazao[idx];
    divergencias.push({
      tipo: 'NAO_ENCONTRADO_EXTRATO',
      descricao: (
        `Lançamento do Domínio não encontrado no extrato. ` +
        `Data: ${lanc.data}, ` +
        `Descrição: ${lanc.descricao.substring(0, 50)}, ` +
        `Valor: R$ ${lanc.valor.toFixed(2)}`
      ),
      data_extrato: null,
      descricao_extrato: null,
      valor_extrato: null,
      documento_extrato: null,
      conta_contabil_extrato: null,
      data_dominio: lanc.data,
      descricao_dominio: lanc.descricao,
      valor_dominio: lanc.valor,
      documento_dominio: lanc.documento,
      conta_contabil_dominio: lanc.conta_contabil
    });
  });

  return divergencias;
}

/**
 * Compara saldos iniciais e finais entre extrato e razão.
 */
function compararSaldos(lancExtrato, lancRazao, toleranciaValor) {
  const divergencias = [];

  // Extrai saldos do extrato
  const saldosExtrato = lancExtrato.filter(l => l.saldo !== null && l.saldo !== undefined).map(l => l.saldo);
  if (saldosExtrato.length === 0) {
    return divergencias; // Sem saldos no extrato, não há o que comparar
  }

  const saldoInicialExtrato = saldosExtrato[0];
  const saldoFinalExtrato = saldosExtrato[saldosExtrato.length - 1];

  // Extrai saldos do razão
  const saldosRazao = lancRazao.filter(l => l.saldo !== null && l.saldo !== undefined).map(l => l.saldo);
  if (saldosRazao.length === 0) {
    return divergencias; // Sem saldos no razão, não há o que comparar
  }

  const saldoInicialRazao = saldosRazao[0];
  const saldoFinalRazao = saldosRazao[saldosRazao.length - 1];

  // Compara saldos iniciais
  const diffInicial = Math.abs(saldoInicialExtrato - saldoInicialRazao);
  const diffFinal = Math.abs(saldoFinalExtrato - saldoFinalRazao);

  if (diffInicial > toleranciaValor || diffFinal > toleranciaValor) {
    let descricao = (
      `Saldo inicial/final divergente entre extrato e domínio. ` +
      `Extrato: R$ ${saldoInicialExtrato.toFixed(2)} → R$ ${saldoFinalExtrato.toFixed(2)}; ` +
      `Domínio: R$ ${saldoInicialRazao.toFixed(2)} → R$ ${saldoFinalRazao.toFixed(2)}.`
    );

    if (diffInicial > toleranciaValor) {
      descricao += ` Diferença no saldo inicial: R$ ${diffInicial.toFixed(2)}.`;
    }
    if (diffFinal > toleranciaValor) {
      descricao += ` Diferença no saldo final: R$ ${diffFinal.toFixed(2)}.`;
    }

    divergencias.push({
      tipo: 'SALDO_DIVERGENTE',
      descricao: descricao,
      data_extrato: null,
      descricao_extrato: null,
      valor_extrato: null,
      documento_extrato: null,
      conta_contabil_extrato: null,
      data_dominio: null,
      descricao_dominio: null,
      valor_dominio: null,
      documento_dominio: null,
      conta_contabil_dominio: null
    });
  }

  return divergencias;
}

/**
 * Detecta lançamentos com classificação contábil suspeita.
 */
function detectarClassificacaoSuspeita(lancRazao) {
  const divergencias = [];

  // Palavras-chave que sugerem despesas/tarifas
  const palavrasSuspeitas = [
    'tarifa', 'taxa', 'encargo', 'juros', 'multa', 'iof',
    'cobrança', 'manutenção', 'anuidade', 'serviço bancário'
  ];

  // Contas genéricas suspeitas (apenas números simples)
  const contasGenericas = new Set(['1', '9', '0', '00', '000']);

  lancRazao.forEach((lanc) => {
    if (lanc.origem !== 'dominio' && lanc.origem !== 'otimiza') {
      return;
    }

    const descLower = normalizarDescricao(lanc.descricao);

    // Verifica se descrição contém palavras suspeitas
    const temPalavraSuspeita = palavrasSuspeitas.some(palavra => descLower.includes(palavra));

    // Verifica conta contábil
    let contaOk = false;
    if (lanc.conta_contabil) {
      const contaClean = lanc.conta_contabil.trim();
      // Conta não pode ser muito genérica
      if (!contasGenericas.has(contaClean) && contaClean.length >= 3) {
        contaOk = true;
      }
    }

    // Se tem palavra suspeita mas não tem conta adequada
    if (temPalavraSuspeita && !contaOk) {
      divergencias.push({
        tipo: 'CLASSIFICACAO_SUSPEITA',
        descricao: (
          `Lançamento com descrição suspeita de tarifa/encargo ` +
          `(${lanc.descricao.substring(0, 50)}) sem classificação contábil adequada. ` +
          `Conta: ${lanc.conta_contabil || 'N/A'}`
        ),
        data_extrato: null,
        descricao_extrato: null,
        valor_extrato: null,
        documento_extrato: null,
        conta_contabil_extrato: null,
        data_dominio: lanc.data,
        descricao_dominio: lanc.descricao,
        valor_dominio: lanc.valor,
        documento_dominio: lanc.documento,
        conta_contabil_dominio: lanc.conta_contabil
      });
    }
  });

  return divergencias;
}

/**
 * Compara listas de lançamentos do extrato e do domínio e retorna divergências.
 */
function compararLancamentos(lancExtrato, lancRazao, toleranciaValor = 0.01, toleranciaDias = 0) {
  console.log(`Iniciando comparação: ${lancExtrato.length} lançamentos no extrato, ${lancRazao.length} no razão`);

  const divergencias = [];

  // Set para rastrear lançamentos já casados (idx_extrato|idx_razao)
  const casados = new Set();

  // 1. Detecta VALOR_DIFERENTE (por documento/descrição)
  divergencias.push(...detectarValorDiferente(lancExtrato, lancRazao, toleranciaValor, casados));

  // 2. Casa lançamentos por data + valor (com tolerância)
  const { indicesExtratoNaoCasados, indicesRazaoNaoCasados } = compararPorDataValor(
    lancExtrato, lancRazao, toleranciaValor, casados
  );

  // 3. Marca lançamentos faltantes
  divergencias.push(...detectarFaltantes(
    lancExtrato, lancRazao,
    indicesExtratoNaoCasados, indicesRazaoNaoCasados
  ));

  // 4. Compara saldos
  divergencias.push(...compararSaldos(lancExtrato, lancRazao, toleranciaValor));

  // 5. Detecta classificação contábil suspeita
  divergencias.push(...detectarClassificacaoSuspeita(lancRazao));

  console.log(`Comparação concluída. Total de divergências: ${divergencias.length}`);

  return divergencias;
}

/**
 * Compara movimentos bancários (extrato) com lançamentos do TXT Otimiza.
 */
function compareBankVsTxt(
  bankMovements,
  txtMovements,
  dateWindowDays = 2,
  amountTolerance = 0.01,
  minDescriptionSimilarity = 0.55,
  allowManyToOne = true
) {
  console.log(`Iniciando comparação TXT: ${bankMovements.length} movimentos bancários, ${txtMovements.length} lançamentos TXT`);

  const divergencias = [];
  const casadosBank = new Set();
  const casadosTxt = new Set();

  // Função simples de similaridade (ratio de caracteres comuns)
  function similarity(str1, str2) {
    if (!str1 || !str2) {
      return 0.0;
    }
    const str1Norm = normalizarDescricao(str1);
    const str2Norm = normalizarDescricao(str2);
    
    // Calcula similaridade simples (Jaccard-like)
    const set1 = new Set(str1Norm.split(''));
    const set2 = new Set(str2Norm.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  // Para cada movimento bancário, tenta encontrar match no TXT
  bankMovements.forEach((movBank, idxBank) => {
    if (casadosBank.has(idxBank)) {
      return;
    }

    let melhorMatch = null;
    let melhorScore = 0;

    txtMovements.forEach((movTxt, idxTxt) => {
      if (casadosTxt.has(idxTxt) && !allowManyToOne) {
        return;
      }

      // Verifica janela de data
      const dataBank = typeof movBank.data === 'string' ? parse(movBank.data, 'yyyy-MM-dd', new Date()) : movBank.data;
      const dataTxt = typeof movTxt.data === 'string' ? parse(movTxt.data, 'yyyy-MM-dd', new Date()) : movTxt.data;
      const diffDias = Math.abs(differenceInDays(dataBank, dataTxt));

      if (diffDias > dateWindowDays) {
        return;
      }

      // Verifica tolerância de valor
      const diffValor = Math.abs(movBank.valor - movTxt.valor);
      if (diffValor > amountTolerance) {
        return;
      }

      // Calcula similaridade de descrição
      const sim = similarity(movBank.descricao, movTxt.descricao);
      if (sim < minDescriptionSimilarity) {
        return;
      }

      // Score combinado (prioriza similaridade de descrição)
      const score = sim * 0.7 + (1 - diffDias / dateWindowDays) * 0.2 + (1 - diffValor / Math.abs(movBank.valor)) * 0.1;

      if (score > melhorScore) {
        melhorScore = score;
        melhorMatch = { idxTxt, movTxt, diffDias, diffValor, sim };
      }
    });

    if (melhorMatch) {
      casadosBank.add(idxBank);
      casadosTxt.add(melhorMatch.idxTxt);
    } else {
      // Não encontrou match - cria divergência
      divergencias.push({
        tipo: 'NAO_ENCONTRADO_DOMINIO',
        descricao: (
          `Movimento bancário não encontrado no TXT. ` +
          `Data: ${movBank.data}, ` +
          `Descrição: ${movBank.descricao.substring(0, 50)}, ` +
          `Valor: R$ ${movBank.valor.toFixed(2)}`
        ),
        data_extrato: movBank.data,
        descricao_extrato: movBank.descricao,
        valor_extrato: movBank.valor,
        documento_extrato: movBank.documento,
        conta_contabil_extrato: movBank.conta_contabil,
        data_dominio: null,
        descricao_dominio: null,
        valor_dominio: null,
        documento_dominio: null,
        conta_contabil_dominio: null
      });
    }
  });

  // Lançamentos TXT não encontrados no extrato
  txtMovements.forEach((movTxt, idxTxt) => {
    if (!casadosTxt.has(idxTxt)) {
      divergencias.push({
        tipo: 'NAO_ENCONTRADO_EXTRATO',
        descricao: (
          `Lançamento TXT não encontrado no extrato. ` +
          `Data: ${movTxt.data}, ` +
          `Descrição: ${movTxt.descricao.substring(0, 50)}, ` +
          `Valor: R$ ${movTxt.valor.toFixed(2)}`
        ),
        data_extrato: null,
        descricao_extrato: null,
        valor_extrato: null,
        documento_extrato: null,
        conta_contabil_extrato: null,
        data_dominio: movTxt.data,
        descricao_dominio: movTxt.descricao,
        valor_dominio: movTxt.valor,
        documento_dominio: movTxt.documento,
        conta_contabil_dominio: movTxt.conta_contabil
      });
    }
  });

  return divergencias;
}

module.exports = {
  compararLancamentos,
  compareBankVsTxt,
  normalizarDescricao,
  chavePrincipal,
  chaveDocumento,
  chaveDescricao
};

