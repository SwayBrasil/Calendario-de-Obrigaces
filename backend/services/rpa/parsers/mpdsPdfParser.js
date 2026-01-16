// Parser para extratos bancários em PDF (Nubank/Sicoob)
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { format, parse, isValid } = require('date-fns');

/**
 * Converte string brasileira de valor para float.
 */
function parseValor(valorStr) {
  if (!valorStr || valorStr.trim() === '') {
    return 0.0;
  }

  let valor = valorStr.trim();
  
  // Remove caracteres inválidos (mantém apenas dígitos, pontos, vírgulas, R$, sinais e letras D/C)
  valor = valor.replace(/[^\d.,R$DCdc\s-]/g, '');

  // Remove R$ e espaços
  valor = valor.replace(/R\$\s*/g, '');
  valor = valor.trim();

  // Detecta sinal negativo (D = Débito, C = Crédito)
  let negativo = false;
  const valorUpper = valor.toUpperCase();
  if (valorUpper.endsWith('D') || valorUpper.endsWith('DÉBITO')) {
    negativo = true;
    valor = valor.replace(/\s*[Dd](ébito)?\s*$/i, '').trim();
  } else if (valorUpper.endsWith('-') || valor.startsWith('-')) {
    negativo = true;
    valor = valor.replace(/^-+|-+$/g, '').trim();
  } else if (valorUpper.endsWith('C') || valorUpper.endsWith('CRÉDITO')) {
    // Crédito é positivo (não precisa fazer nada)
    valor = valor.replace(/\s*[Cc](rédito)?\s*$/i, '').trim();
  }

  // Remove pontos (milhares) e substitui vírgula por ponto (decimal)
  // Mas preserva se houver múltiplas vírgulas (formato inválido)
  valor = valor.replace(/\./g, '');
  
  // Se tem vírgula, assume que é decimal brasileiro
  if (valor.includes(',')) {
    valor = valor.replace(',', '.');
  }

  try {
    // Valida que o valor só contém caracteres numéricos válidos após limpeza
    if (!/^[\d.]+$/.test(valor)) {
      console.warn(`[PDF-PARSER] Valor contém caracteres inválidos: "${valorStr}" -> "${valor}"`);
      return 0.0;
    }
    const num = parseFloat(valor);
    if (isNaN(num)) {
      console.warn(`[PDF-PARSER] parseFloat retornou NaN para: "${valorStr}" -> "${valor}"`);
      return 0.0;
    }
    return negativo ? -Math.abs(num) : Math.abs(num);
  } catch (e) {
    console.warn(`[PDF-PARSER] Erro ao converter valor "${valorStr}": ${e.message}`);
    return 0.0;
  }
}

/**
 * Tenta parsear data em vários formatos brasileiros.
 */
function parseData(dataStr) {
  if (!dataStr || !dataStr.trim()) {
    return null;
  }

  // Remove caracteres inválidos (mantém apenas dígitos, barras, hífens e espaços)
  let data = dataStr.trim().replace(/[^\d/\-\s]/g, '').replace(/\s+/g, ' ');

  const formatos = [
    'dd/MM/yyyy',
    'dd/MM/yy',
    'dd-MM-yyyy',
    'dd-MM-yy',
    'yyyy-MM-dd'
  ];

  for (const fmt of formatos) {
    try {
      const parsed = parse(data, fmt, new Date());
      if (isValid(parsed)) {
        return parsed;
      }
    } catch (e) {
      continue;
    }
  }

  console.warn(`Não foi possível parsear data: ${dataStr}`);
  return null;
}

/**
 * Normaliza descrição: trim e collapse espaços
 */
function normalizarDescricao(desc) {
  if (!desc) return '';
  return desc.trim().replace(/\s+/g, ' ');
}

/**
 * Detecta qual banco é baseado no texto da primeira página.
 */
function detectarBanco(textoPagina) {
  const textoLower = textoPagina.toLowerCase();

  if (textoLower.includes('nubank') || textoLower.includes('nu pagamentos')) {
    return 'nubank';
  } else if (textoLower.includes('sicoob') || textoLower.includes('sistema de cooperativas')) {
    return 'sicoob';
  }

  return 'unknown';
}

/**
 * Infere o ano do período extraído do texto do PDF
 */
function inferirAnoDoPeriodo(texto) {
  const regex = /PER[IÍ]ODO\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/i;
  const match = texto.match(regex);
  if (!match) {
    return null;
  }

  try {
    const fim = parseData(match[2]);
    if (fim) {
      return fim.getFullYear();
    }
  } catch (e) {
    // Ignora
  }

  return null;
}

/**
 * Parser específico para extratos Nubank.
 */
function parseNubank(texto) {
  const lancamentos = [];
  const issues = [];

  // Padrão 1: DD MMM YYYY Descrição Valor (formato: "16 OUT 2025 Transferência ... 1.123,60")
  const padrao1 = /(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})\s+(.+?)\s+([\d.,-]+)/gi;

  const meses = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
    'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
  };

  let match;
  while ((match = padrao1.exec(texto)) !== null) {
    try {
      const [, dia, mesAbr, ano, desc, valorStr] = match;
      const mesNum = meses[mesAbr.toUpperCase()] || '01';
      const dataStr = `${String(dia).padStart(2, '0')}/${mesNum}/${ano}`;
      const data = parseData(dataStr);
      if (!data) {
        continue;
      }

      const valor = parseValor(valorStr);
      if (valor === 0.0) {
        continue;
      }

      // Remove palavras comuns do início da descrição
      let descClean = normalizarDescricao(desc);
      descClean = descClean.replace(/^Total\s+de\s+(entradas|saídas)\s*[+-]?\s*/i, '');

      lancamentos.push({
        data: format(data, 'yyyy-MM-dd'),
        descricao: descClean,
        documento: null,
        valor: valor,
        saldo: null,
        conta_contabil: null,
        origem: 'mpds'
      });
    } catch (e) {
      issues.push(`Erro ao processar linha Nubank: ${e.message}`);
      continue;
    }
  }

  // Padrão 2: DD/MM/YYYY Descrição R$ 1.234,56 (formato tradicional)
  if (lancamentos.length === 0) {
    const padrao2 = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(R\$\s*[\d.,-]+)/g;
    while ((match = padrao2.exec(texto)) !== null) {
      try {
        const [, dataStr, desc, valorStr] = match;
        const data = parseData(dataStr);
        if (!data) {
          continue;
        }

        const valor = parseValor(valorStr);
        if (valor === 0.0) {
          continue;
        }

        lancamentos.push({
          data: format(data, 'yyyy-MM-dd'),
          descricao: normalizarDescricao(desc),
          documento: null,
          valor: valor,
          saldo: null,
          conta_contabil: null,
          origem: 'mpds'
        });
      } catch (e) {
        issues.push(`Erro ao processar linha Nubank (padrão 2): ${e.message}`);
        continue;
      }
    }
  }

  return { lancamentos, issues };
}

/**
 * Parser específico para extratos Sicoob.
 */
function parseSicoob(texto) {
  const lancamentos = [];
  const issues = [];

  // Infere ano do período
  const anoInferido = inferirAnoDoPeriodo(texto);

  // Normaliza quebras de linha mas preserva estrutura de linhas
  const linhas = texto.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
  const textoNormalizado = linhas.join(' ');

  console.log(`[SICOOB-PARSER] Total de linhas no PDF: ${linhas.length}`);
  console.log(`[SICOOB-PARSER] Primeiras 10 linhas:`, linhas.slice(0, 10));

  // Padrão 1: DD/MM Descrição Valor (formato mais comum)
  // Ex: "01/03 Transferência 1.234,56" ou "01/03/2025 Transferência 1.234,56"
  const padrao1 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+([^0-9]+?)\s+([R$]?\s*[\d.,-]+(?:\s*[DC])?)/gi;

  // Padrão 2: Valor antes da data (formato alternativo)
  // Ex: "1.234,56 01/03 Transferência"
  const padrao2 = /([R$]?\s*[\d.,-]+(?:\s*[DC])?)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+([^0-9]+?)(?:\s|$)/gi;

  // Padrão 3: DD/MM Valor Descrição (formato com valor no meio)
  // Ex: "01/03 1.234,56 Transferência"
  const padrao3 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+([R$]?\s*[\d.,-]+(?:\s*[DC])?)\s+([^0-9]+?)(?:\s|$)/gi;

  const seen = new Set(); // Evita duplicatas

  // Tenta padrão 1
  let match;
  while ((match = padrao1.exec(textoNormalizado)) !== null) {
    try {
      const [, dia, mes, anoStr, desc, valorStr] = match;
      let ano = anoStr ? parseInt(anoStr, 10) : null;

      if (ano && ano < 100) {
        ano = 2000 + ano;
      }
      if (!ano && anoInferido) {
        ano = anoInferido;
      }
      if (!ano) {
        ano = new Date().getFullYear();
      }

      const dataStr = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
      const data = parseData(dataStr);
      if (!data) {
        continue;
      }

      const valor = parseValor(valorStr);
      if (valor === 0.0) {
        continue;
      }

      // Rejeita números de conta (5 dígitos sem vírgula)
      const valorInteiro = Math.abs(valor);
      if (valorInteiro >= 10000 && valorInteiro < 100000 && !valorStr.includes(',')) {
        const descUpper = normalizarDescricao(desc).toUpperCase();
        const matchText = match[0].toUpperCase();
        if (descUpper.includes('CONTA') || descUpper.includes('BOLETO') || 
            matchText.includes('CONTA') || matchText.includes('BOLETO') ||
            /^(\d)\1{4,}$/.test(valorStr.replace(/\./g, ''))) {
          continue; // É número de conta, ignora
        }
      }

      // Rejeita descrições muito curtas
      if (!desc || normalizarDescricao(desc).length < 10) {
        continue;
      }

      const chave = `${dataStr}|${normalizarDescricao(desc).substring(0, 50)}|${Math.round(valor * 100)}`;
      if (seen.has(chave)) {
        continue;
      }
      seen.add(chave);

      lancamentos.push({
        data: format(data, 'yyyy-MM-dd'),
        descricao: normalizarDescricao(desc),
        documento: null,
        valor: valor,
        saldo: null,
        conta_contabil: null,
        origem: 'mpds'
      });
    } catch (e) {
      issues.push(`Erro ao processar linha Sicoob (padrão 1): ${e.message}`);
      continue;
    }
  }

  // Tenta padrão 2 (valor antes da data)
  while ((match = padrao2.exec(textoNormalizado)) !== null) {
    try {
      const [, valorStr, dia, mes, anoStr, desc] = match;
      let ano = anoStr ? parseInt(anoStr, 10) : null;

      if (ano && ano < 100) {
        ano = 2000 + ano;
      }
      if (!ano && anoInferido) {
        ano = anoInferido;
      }
      if (!ano) {
        ano = new Date().getFullYear();
      }

      const dataStr = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
      const data = parseData(dataStr);
      if (!data) {
        continue;
      }

      const valor = parseValor(valorStr);
      if (valor === 0.0) {
        continue;
      }

      // Rejeita números de conta (5 dígitos sem vírgula)
      const valorInteiro = Math.abs(valor);
      if (valorInteiro >= 10000 && valorInteiro < 100000 && !valorStr.includes(',')) {
        const descUpper = normalizarDescricao(desc).toUpperCase();
        const matchText = match[0].toUpperCase();
        if (descUpper.includes('CONTA') || descUpper.includes('BOLETO') || 
            matchText.includes('CONTA') || matchText.includes('BOLETO') ||
            /^(\d)\1{4,}$/.test(valorStr.replace(/\./g, ''))) {
          continue; // É número de conta, ignora
        }
      }

      // Rejeita descrições muito curtas
      if (!desc || normalizarDescricao(desc).length < 10) {
        continue;
      }

      const chave = `${dataStr}|${normalizarDescricao(desc).substring(0, 50)}|${Math.round(valor * 100)}`;
      if (seen.has(chave)) {
        continue;
      }
      seen.add(chave);

      lancamentos.push({
        data: format(data, 'yyyy-MM-dd'),
        descricao: normalizarDescricao(desc),
        documento: null,
        valor: valor,
        saldo: null,
        conta_contabil: null,
        origem: 'mpds'
      });
    } catch (e) {
      issues.push(`Erro ao processar linha Sicoob (padrão 2): ${e.message}`);
      continue;
    }
  }

  // Tenta padrão 3 (valor no meio)
  while ((match = padrao3.exec(textoNormalizado)) !== null) {
    try {
      const [, dia, mes, anoStr, valorStr, desc] = match;
      let ano = anoStr ? parseInt(anoStr, 10) : null;

      if (ano && ano < 100) {
        ano = 2000 + ano;
      }
      if (!ano && anoInferido) {
        ano = anoInferido;
      }
      if (!ano) {
        ano = new Date().getFullYear();
      }

      const dataStr = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
      const data = parseData(dataStr);
      if (!data) {
        continue;
      }

      const valor = parseValor(valorStr);
      if (valor === 0.0) {
        continue;
      }

      // Rejeita números de conta (5 dígitos sem vírgula)
      const valorInteiro = Math.abs(valor);
      if (valorInteiro >= 10000 && valorInteiro < 100000 && !valorStr.includes(',')) {
        const descUpper = normalizarDescricao(desc).toUpperCase();
        const matchText = match[0].toUpperCase();
        if (descUpper.includes('CONTA') || descUpper.includes('BOLETO') || 
            matchText.includes('CONTA') || matchText.includes('BOLETO') ||
            /^(\d)\1{4,}$/.test(valorStr.replace(/\./g, ''))) {
          continue; // É número de conta, ignora
        }
      }

      // Rejeita descrições muito curtas
      if (!desc || normalizarDescricao(desc).length < 10) {
        continue;
      }

      const chave = `${dataStr}|${normalizarDescricao(desc).substring(0, 50)}|${Math.round(valor * 100)}`;
      if (seen.has(chave)) {
        continue;
      }
      seen.add(chave);

      lancamentos.push({
        data: format(data, 'yyyy-MM-dd'),
        descricao: normalizarDescricao(desc),
        documento: null,
        valor: valor,
        saldo: null,
        conta_contabil: null,
        origem: 'mpds'
      });
    } catch (e) {
      issues.push(`Erro ao processar linha Sicoob (padrão 3): ${e.message}`);
      continue;
    }
  }

  // Padrão 4: Processa linha por linha (mais genérico)
  // Só processa linhas que não foram capturadas pelos padrões anteriores
  // Marca linhas já processadas pelos padrões anteriores
  const linhasProcessadas = new Set();
  
  // Marca linhas que já foram processadas pelos padrões 1, 2 e 3
  [...textoNormalizado.matchAll(padrao1)].forEach(m => {
    const linhaOriginal = linhas.find(l => l.includes(m[0]));
    if (linhaOriginal) linhasProcessadas.add(linhaOriginal);
  });
  [...textoNormalizado.matchAll(padrao2)].forEach(m => {
    const linhaOriginal = linhas.find(l => l.includes(m[0]));
    if (linhaOriginal) linhasProcessadas.add(linhaOriginal);
  });
  [...textoNormalizado.matchAll(padrao3)].forEach(m => {
    const linhaOriginal = linhas.find(l => l.includes(m[0]));
    if (linhaOriginal) linhasProcessadas.add(linhaOriginal);
  });
  
  linhas.forEach((linha, idx) => {
    // Pula se já foi processada
    if (linhasProcessadas.has(linha)) return;
    
    // Pula linhas muito curtas (provavelmente não são lançamentos)
    if (linha.length < 10) return;
    
    // Pula linhas que são claramente cabeçalhos ou rodapés
    const linhaUpper = linha.toUpperCase();
    if (linhaUpper.includes('PERÍODO') || linhaUpper.includes('SALDO') || 
        linhaUpper.includes('TOTAL') || linhaUpper.includes('DATA') ||
        linhaUpper.includes('DESCRIÇÃO') || linhaUpper.includes('VALOR') ||
        linhaUpper.includes('SICOOB') || linhaUpper.includes('COOPERATIVAS') ||
        linhaUpper.includes('CONTA CORRENTE') || linhaUpper.includes('AGÊNCIA') ||
        linhaUpper.includes('TITULAR')) {
      return;
    }
    // Busca data no formato DD/MM ou DD/MM/YYYY
    const dataMatch = linha.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!dataMatch) return;

    // Busca valor monetário válido (formato brasileiro: 1.234,56 ou 1234,56)
    // Busca da direita para esquerda (valores geralmente estão no final da linha)
    // Padrões mais específicos primeiro (valores completos com separadores)
    const valorPatterns = [
      // R$ 1.234,56 ou R$1234,56 (com R$ explícito)
      /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g,
      // 1.234,56 ou 1234,56 no final da linha (com espaço antes)
      /\s(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)(?:\s*[DC]?|\s*$)/g,
      // Qualquer número com vírgula e 2 decimais (formato monetário)
      /(\d{1,3}(?:\.\d{3})*,\d{2})/g,
      // Número grande sem vírgula (pode ser valor sem centavos)
      // MAS: rejeita números de 5 dígitos (10000-99999) que são provavelmente contas
      /\s(\d{6,})(?:\s|$)/g, // Apenas números com 6+ dígitos sem vírgula
    ];

    let bestMatch = null;

    // Busca todos os candidatos a valor na linha, da direita para esquerda
    for (const pattern of valorPatterns) {
      const matches = [...linha.matchAll(pattern)];
      // Processa da direita para esquerda (valores estão no final)
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const candidate = match[1] || match[0];
        const matchIndex = match.index;
        const fullMatch = match[0];
        
        // Ignora se for parte da data (1-31) ou ano (2020-2030)
        const numStr = candidate.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(numStr);
        if (isNaN(num)) continue;
        
        // Ignora dias do mês (sem vírgula e entre 1-31)
        if (num >= 1 && num <= 31 && !candidate.includes(',')) continue;
        // Ignora anos
        if (num >= 2020 && num <= 2030) continue;
        // Ignora números que parecem contas bancárias (5 dígitos sem vírgula)
        // MAS: só ignora se NÃO houver vírgula (números de conta não têm vírgula)
        // Se tiver vírgula e 2 decimais, é um valor válido mesmo que a linha contenha "CONTA"
        // IMPORTANTE: Valores com vírgula e 2 decimais são SEMPRE válidos, mesmo em contexto de "CONTA"
        const hasComma = candidate.includes(',');
        const decimalPlaces = hasComma ? candidate.split(',')[1]?.length || 0 : 0;
        const isMonetaryValue = hasComma && decimalPlaces === 2;
        
        // Se é um valor monetário válido (com vírgula e 2 decimais), NUNCA rejeita
        if (!isMonetaryValue && num >= 10000 && num < 100000 && !hasComma) {
          const linhaUpper = linha.toUpperCase();
          const linhaCompleta = linhaUpper;
          const beforeValue = linhaUpper.substring(0, matchIndex);
          const afterValue = linhaUpper.substring(matchIndex + fullMatch.length);
          
          // Ignora se a linha contém "CONTA" em qualquer lugar E o número não tem vírgula
          if (linhaCompleta.includes('CONTA') || linhaCompleta.includes('AGENCIA') || linhaCompleta.includes('AGÊNCIA')) {
            continue; // É número de conta, não valor
          }
          
          // Ignora se for número repetido (11111, 33333)
          const candidateSemPontos = candidate.replace(/\./g, '');
          if (/^(\d)\1{4,}$/.test(candidateSemPontos)) {
            continue;
          }
          
          // Ignora se aparecer em contexto de TED/TED RECEBIDA CONTA / TED ENVIADA PARA CONTA
          // MAS: só ignora se NÃO for um valor monetário válido
          if (linhaCompleta.includes('TED') && linhaCompleta.includes('CONTA')) {
            continue;
          }
          
          // Ignora se a linha contém "BOLETO" seguido de número
          if (linhaCompleta.match(/BOLETO\s*\d{4,}/)) {
            continue;
          }
          
          // Ignora se aparecer após "TED" e antes de "CONTA" (ex: "TED 11111 CONTA")
          if (beforeValue.includes('TED') && afterValue.includes('CONTA')) {
            continue;
          }
          
          // Ignora se aparecer após "PARA CONTA" ou "DE CONTA"
          if (beforeValue.includes('PARA CONTA') || beforeValue.includes('DE CONTA') || beforeValue.includes('RECEBIDA CONTA') || beforeValue.includes('ENVIADA CONTA')) {
            continue;
          }
        }
        // Ignora números muito grandes sem vírgula que não são valores monetários típicos
        if (num >= 100000 && !candidate.includes(',')) continue;
        
        // Prefere valores com vírgula e 2 casas decimais
        // IMPORTANTE: Valores monetários válidos (com vírgula e 2 decimais) têm prioridade máxima
        const hasComma = candidate.includes(',');
        const decimalPlaces = hasComma ? candidate.split(',')[1]?.length || 0 : 0;
        const isMonetaryValue = hasComma && decimalPlaces === 2;
        
        // Calcula posição relativa (quanto mais à direita, melhor)
        const positionScore = matchIndex / Math.max(linha.length, 1);
        
        // Se tem vírgula e 2 casas decimais, é muito provável que seja um valor
        // PRIORIDADE MÁXIMA: valores monetários válidos são sempre escolhidos
        if (isMonetaryValue) {
          const score = 20 + positionScore; // Prioridade máxima para valores monetários válidos
          if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && matchIndex > bestMatch.index)) {
            bestMatch = { candidate, match, index: matchIndex, fullMatch, score };
          }
        } else if (num > 100 && hasComma) {
          // Número grande com vírgula também é candidato (mas não tem 2 decimais)
          const score = 5 + positionScore;
          if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && matchIndex > bestMatch.index)) {
            bestMatch = { candidate, match, index: matchIndex, fullMatch, score };
          }
        } else if (num > 1000 && !hasComma) {
          // Número muito grande sem vírgula pode ser valor
          // MAS: REJEITA TODOS os números de 5 dígitos (10000-99999) sem vírgula
          // pois são quase sempre números de conta, não valores monetários
          if (num >= 10000 && num < 100000) {
            continue; // Rejeita - números de 5 dígitos sem vírgula são quase sempre contas
          }
          // Apenas aceita números com 6+ dígitos sem vírgula como valores potenciais
          // (ex: 100000 = R$ 100.000,00 sem centavos)
          const score = 3 + positionScore;
          if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && matchIndex > bestMatch.index)) {
            bestMatch = { candidate, match, index: matchIndex, fullMatch, score };
          }
        }
      }
    }

    if (!bestMatch) {
      return;
    }

    const valorStr = bestMatch.candidate;
    const valorMatch = bestMatch.match;
    const valorIndex = bestMatch.index;

    try {
      const [, dia, mes, anoStr] = dataMatch;

      let ano = anoStr ? parseInt(anoStr, 10) : null;
      if (ano && ano < 100) {
        ano = 2000 + ano;
      }
      if (!ano && anoInferido) {
        ano = anoInferido;
      }
      if (!ano) {
        ano = new Date().getFullYear();
      }

      const dataStr = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
      const data = parseData(dataStr);
      if (!data) {
        return;
      }

      const valor = parseValor(valorStr);
      if (valor === 0.0 || Math.abs(valor) < 0.01) {
        return;
      }

      // Extrai descrição: remove data e valor, mantém o resto
      let desc = linha;
      
      // Remove a data específica encontrada
      const dataIndex = linha.indexOf(dataMatch[0]);
      if (dataIndex >= 0) {
        desc = desc.substring(0, dataIndex) + ' ' + desc.substring(dataIndex + dataMatch[0].length);
      }
      
      // Remove o valor encontrado e valores colados (padrões como 1.500, 300, etc.)
      if (valorIndex >= 0) {
        const valorFullMatch = bestMatch.fullMatch || valorMatch[0];
        // Remove o valor principal
        desc = desc.substring(0, valorIndex) + ' ' + desc.substring(valorIndex + valorFullMatch.length);
        
        // Remove valores colados no final da descrição (padrões como "1.500", "300", "25,0")
        // MAS preserva números de conta (5 dígitos com hífen ou sem, ex: "11111-2", "12345")
        // Remove números com ponto de milhar colados no final (mas não números de conta)
        desc = desc.replace(/\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/g, '').trim();
        // Remove números simples colados no final, mas preserva números de conta (5 dígitos)
        // e números que fazem parte de descrições (ex: "BOLETO 12345", "CONTA 11111-2")
        // Preserva padrões como "11111-2", "12345-6" (números de conta com hífen)
        desc = desc.replace(/\s+(\d{1,4}|\d{6,})(?:,\d+)?$/g, '').trim();
        
        // Preserva números de conta com hífen que podem ter sido removidos
        // Procura padrões como "CONTA 11111-2", "BOLETO 12345", "TED ... CONTA 11111-2" na linha original
        const descUpperTemp = desc.toUpperCase();
        if (descUpperTemp.includes('CONTA') || descUpperTemp.includes('BOLETO') || descUpperTemp.includes('TED')) {
          // Procura padrões de conta na linha original (antes da limpeza)
          const contaPatterns = [
            /(?:CONTA|BOLETO)\s+(\d{5}(?:-\d)?)/i,
            /TED\s+(?:RECEBIDA|ENVIADA|PARA|DE)\s+CONTA\s+(\d{5}(?:-\d)?)/i,
            /(\d{5}-\d)/, // Padrão direto: 11111-2
          ];
          for (const pattern of contaPatterns) {
            const contaMatch = linha.match(pattern);
            if (contaMatch) {
              const contaNum = contaMatch[1] || contaMatch[0];
              if (contaNum && !desc.includes(contaNum)) {
                // Adiciona o número de conta de volta à descrição
                desc = desc + ' ' + contaNum;
                break;
              }
            }
          }
        }
        
        // Remove vírgulas soltas no final (ex: "MENSAL,0" -> "MENSAL")
        desc = desc.replace(/,\d+$/g, '').trim();
        // Remove valores colados no meio (ex: "ABC 5.000" -> "ABC")
        // MAS preserva números de conta (5 dígitos) que aparecem após palavras-chave
        desc = desc.replace(/\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s+/g, (match, num) => {
          // Se o número é 5 dígitos e aparece após "CONTA", "BOLETO", etc., preserva
          const numSemPontos = num.replace(/\./g, '').replace(',', '');
          if (numSemPontos.length === 5) {
            const beforeMatch = desc.substring(0, desc.indexOf(match)).toUpperCase();
            if (beforeMatch.includes('CONTA') || beforeMatch.includes('BOLETO') || 
                beforeMatch.includes('TED') || beforeMatch.match(/NF\d*$/i)) {
              return match; // Preserva número de conta
            }
          }
          return ' '; // Remove valor monetário
        }).trim();
        // Remove "D" ou "C" soltos no final (indicadores de débito/crédito)
        desc = desc.replace(/\s+[DC]\s*$/gi, '').trim();
      }
      
      // Remove valores que possam ter ficado colados no meio (padrões como "ABC1.500" -> "ABC")
      // Mas só remove se estiver claramente colado (sem espaço antes)
      desc = desc.replace(/([A-Z])(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g, '$1').trim();
      // Remove valores colados após ponto final ou vírgula (ex: "S.A.4.200" -> "S.A.")
      desc = desc.replace(/([A-Z]\.)(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g, '$1').trim();
      
      // Limpa espaços múltiplos e caracteres especiais
      desc = desc.replace(/\s+/g, ' ').trim();
      desc = desc.replace(/^[^\w\s]+|[^\w\s]+$/g, '').trim();

      // Rejeita descrições muito curtas (provavelmente são partes extraídas incorretamente)
      // MAS: permite descrições um pouco mais curtas se contêm palavras-chave importantes
      const descUpper = desc.toUpperCase();
      const hasKeyword = descUpper.includes('TED') || descUpper.includes('PIX') || 
                         descUpper.includes('RECEBIMENTO') || descUpper.includes('PAGAMENTO') ||
                         descUpper.includes('BOLETO') || descUpper.includes('TARIFA');
      const minLength = hasKeyword ? 8 : 10; // Reduz para 8 se tem palavra-chave
      
      if (!desc || desc.length < minLength) {
        return; // Descrição muito curta, provavelmente extração incorreta
      }

      // Rejeita valores que são claramente números de conta (5 dígitos sem vírgula)
      // MAS: se o valor tem vírgula e 2 decimais, é um valor válido mesmo que a descrição contenha "CONTA"
      const valorInteiro = Math.abs(valor);
      if (valorInteiro >= 10000 && valorInteiro < 100000 && !valorStr.includes(',')) {
        const descUpper = desc.toUpperCase();
        const linhaUpper = linha.toUpperCase();
        
        // Se o valor tem vírgula e 2 decimais, é válido (ex: 3000.00, 3500.00)
        // Só rejeita se for número de conta sem vírgula
        if (!valorStr.includes(',')) {
          // Verifica se a descrição ou linha menciona "CONTA", "BOLETO", etc.
          if (descUpper.includes('CONTA') || descUpper.includes('AGENCIA') || descUpper.includes('AGÊNCIA') ||
              linhaUpper.includes('CONTA') || linhaUpper.includes('BOLETO')) {
            return; // É número de conta, ignora
          }
          
          // Se é número repetido (11111, 33333), também ignora
          const valorStrSemPontos = valorStr.replace(/\./g, '');
          if (/^(\d)\1{4,}$/.test(valorStrSemPontos)) {
            return; // Número repetido, provavelmente conta
          }
          
          // Se a linha contém padrões como "TED 11111", "BOLETO 12345", etc.
          if (linhaUpper.match(/TED\s+\d{5}/) || linhaUpper.match(/BOLETO\s+\d{5}/) ||
              linhaUpper.match(/CONTA\s+\d{5}/) || linhaUpper.match(/\d{5}\s*[-]\s*\d/)) {
            return; // É número de conta
          }
        }
      }

      // Chave mais específica para evitar duplicatas
      const descNormalizada = normalizarDescricao(desc).substring(0, 50).toUpperCase();
      const valorArredondado = Math.round(valor * 100);
      const chave = `${dataStr}|${descNormalizada}|${valorArredondado}`;
      
      if (seen.has(chave)) {
        return; // Já processado
      }
      seen.add(chave);

      lancamentos.push({
        data: format(data, 'yyyy-MM-dd'),
        descricao: normalizarDescricao(desc),
        documento: null,
        valor: valor,
        saldo: null,
        conta_contabil: null,
        origem: 'mpds'
      });
    } catch (e) {
      issues.push(`Erro ao processar linha Sicoob (padrão 4, linha ${idx + 1}): ${e.message}`);
    }
  });

  console.log(`[SICOOB-PARSER] Total de lançamentos extraídos: ${lancamentos.length}`);
  if (issues.length > 0) {
    console.warn(`[SICOOB-PARSER] Issues encontradas: ${issues.length}`);
  }

  return { lancamentos, issues };
}

/**
 * Lê um arquivo PDF MPDS e retorna uma lista de lançamentos.
 * 
 * @param {string} filePath - Caminho para o arquivo PDF
 * @param {boolean} strict - Se true, falha ao encontrar linhas não parseáveis
 * @returns {Promise<{lancamentos: Array, issues: Array}>}
 */
function parseMpdsPdf(filePath, strict = false) {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return reject(new Error(`Arquivo não encontrado: ${fullPath}`));
    }

    const dataBuffer = fs.readFileSync(fullPath);

    // Timeout para PDFs grandes (60 segundos)
    const timeout = setTimeout(() => {
      reject(new Error('Timeout ao processar PDF (arquivo muito grande)'));
    }, 60000);

    pdf(dataBuffer, { max: 0 }) // max: 0 = todas as páginas
      .then((data) => {
        clearTimeout(timeout);

        const texto = data.text;
        if (!texto || texto.trim().length === 0) {
          return reject(new Error('PDF não contém texto extraível'));
        }

        // Detecta banco
        const banco = detectarBanco(texto);

        let resultado;
        if (banco === 'nubank') {
          resultado = parseNubank(texto);
        } else if (banco === 'sicoob') {
          resultado = parseSicoob(texto);
        } else {
          // Tenta ambos os parsers
          const nubankResult = parseNubank(texto);
          const sicoobResult = parseSicoob(texto);

          // Usa o que encontrou mais lançamentos
          if (nubankResult.lancamentos.length >= sicoobResult.lancamentos.length) {
            resultado = nubankResult;
          } else {
            resultado = sicoobResult;
          }
        }

        console.log(`Parsing concluído. Total de lançamentos extraídos: ${resultado.lancamentos.length}`);
        if (resultado.issues.length > 0) {
          console.warn(`Total de issues encontradas: ${resultado.issues.length}`);
        }

        resolve(resultado);
      })
      .catch((error) => {
        clearTimeout(timeout);
        console.error(`Erro ao processar PDF: ${error.message}`);

        const rawMessage = (error && error.message ? error.message : '').toLowerCase();
        const rawDetails = (error && error.details ? error.details : '').toLowerCase();
        const combined = `${rawMessage} ${rawDetails}`;

        // Mensagens conhecidas do pdf-parse/pdf.js para PDFs corrompidos ou não suportados
        if (combined.includes('bad xref entry') || combined.includes('invalid pdf') || combined.includes('formaterror')) {
          let errorMessage = 'PDF inválido ou corrompido. ';
          
          // Mensagem específica para "bad XRef entry" (geralmente PDFs gerados por pdfkit)
          if (combined.includes('bad xref entry')) {
            errorMessage += 'Este PDF pode ter sido gerado por uma ferramenta incompatível. ';
          }
          
          errorMessage += 'Por favor, baixe o extrato diretamente do app/banco ou exporte em CSV/OFX. PDFs precisam ter texto selecionável (não podem ser apenas imagens).';
          
          return reject(new Error(errorMessage));
        }

        reject(error);
      });
  });
}

module.exports = {
  parseMpdsPdf,
  parseValor,
  parseData,
  detectarBanco
};

