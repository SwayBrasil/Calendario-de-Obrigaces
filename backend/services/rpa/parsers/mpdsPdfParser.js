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
    const num = parseFloat(valor);
    if (isNaN(num)) {
      return 0.0;
    }
    return negativo ? -Math.abs(num) : Math.abs(num);
  } catch (e) {
    console.warn(`Não foi possível converter valor: ${valorStr}`);
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

  const data = dataStr.trim().replace(/\s+/g, ' ');

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

  // Normaliza quebras de linha e espaços múltiplos
  const textoNormalizado = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+/g, ' ');

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
          return reject(
            new Error(
              'PDF inválido ou corrompido. Baixe novamente o extrato ou exporte em CSV/OFX (PDF precisa ter texto selecionável).'
            )
          );
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

