// Parser para arquivos TXT do Otimiza (lançamentos contábeis/financeiros)
const fs = require('fs');
const path = require('path');
const { format, parse, isValid } = require('date-fns');

/**
 * Converte string brasileira (ex: '1.234,56' ou '-1.234,56') ou americana para float.
 */
function parseValor(valorStr) {
  if (!valorStr || valorStr.trim() === '') {
    return 0.0;
  }

  let valor = valorStr.trim();

  // Detecta sinal negativo
  let negativo = false;
  if (valor.startsWith('-')) {
    negativo = true;
    valor = valor.substring(1).trim();
  }

  // Detecta formato (brasileiro vs americano)
  if (valor.includes(',') && valor.includes('.')) {
    // Tem ambos: decide pelo padrão
    if (valor.lastIndexOf(',') > valor.lastIndexOf('.')) {
      // Brasileiro: 1.234,56
      valor = valor.replace(/\./g, '').replace(',', '.');
    } else {
      // Americano: 1,234.56
      valor = valor.replace(/,/g, '');
    }
  } else if (valor.includes(',')) {
    // Só vírgula: pode ser brasileiro ou americano
    const partes = valor.split(',');
    if (partes.length === 2 && partes[1].length <= 2) {
      // Brasileiro: vírgula decimal
      valor = valor.replace(/\./g, '').replace(',', '.');
    } else {
      // Americano: vírgula milhares
      valor = valor.replace(/,/g, '');
    }
  }

  try {
    const num = parseFloat(valor);
    return negativo ? -num : num;
  } catch (e) {
    console.warn(`Não foi possível converter valor: ${valorStr}`);
    return 0.0;
  }
}

/**
 * Valida e converte string de data para Date.
 * Aceita formatos: DD/MM/YYYY, DD/MM/YY, YYYY-MM-DD
 */
function parseDataSafe(dataStr) {
  if (!dataStr || !dataStr.trim()) {
    return null;
  }

  const data = dataStr.trim();

  // Valida formato antes de tentar parsear
  const formatos = [
    { pattern: /^\d{2}\/\d{2}\/\d{4}$/, format: 'dd/MM/yyyy' },
    { pattern: /^\d{2}\/\d{2}\/\d{2}$/, format: 'dd/MM/yy' },
    { pattern: /^\d{4}-\d{2}-\d{2}$/, format: 'yyyy-MM-dd' },
    { pattern: /^\d{2}-\d{2}-\d{4}$/, format: 'dd-MM-yyyy' },
    { pattern: /^\d{2}-\d{2}-\d{2}$/, format: 'dd-MM-yy' }
  ];

  for (const { pattern, format: fmt } of formatos) {
    if (pattern.test(data)) {
      try {
        const parsed = parse(data, fmt, new Date());
        if (isValid(parsed)) {
          return parsed;
        }
      } catch (e) {
        continue;
      }
    }
  }

  return null;
}

/**
 * Converte string de data para Date (fallback para formatos antigos)
 */
function parseData(dataStr) {
  const data = parseDataSafe(dataStr);
  if (data) {
    return data;
  }

  // Fallback: tenta outros formatos
  const formatos = [
    'dd/MM/yyyy',
    'dd/MM/yy',
    'yyyy-MM-dd',
    'dd-MM-yyyy',
    'dd-MM-yy'
  ];

  for (const fmt of formatos) {
    try {
      const parsed = parse(dataStr, fmt, new Date());
      if (isValid(parsed)) {
        return parsed;
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * Lê um arquivo TXT do Otimiza e retorna uma lista de lançamentos.
 * 
 * @param {string} filePath - Caminho para o arquivo TXT
 * @param {boolean} strict - Se true, falha ao encontrar linhas não parseáveis
 * @returns {Promise<{lancamentos: Array, issues: Array}>}
 */
function parseOtimizaTxt(filePath, strict = false) {
  return new Promise((resolve, reject) => {
    try {
      const fullPath = path.resolve(filePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`Arquivo não encontrado: ${fullPath}`);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const linhas = content.split('\n');

      const lancamentos = [];
      const issues = [];

      // Palavras que indicam cabeçalho
      const palavrasCabecalho = [
        'DATA', 'DESCRIÇÃO', 'HISTÓRICO', 'DOCUMENTO', 'VALOR',
        'DÉBITO', 'CRÉDITO', 'SALDO', 'LANÇAMENTO', 'LANCAMENTO'
      ];

      for (let numLinha = 0; numLinha < linhas.length; numLinha++) {
        const linha = linhas[numLinha].trim();

        // Pula linhas vazias
        if (!linha) {
          continue;
        }

        // Pula linhas que parecem cabeçalho
        const linhaUpper = linha.toUpperCase();
        if (palavrasCabecalho.some(palavra => linhaUpper.includes(palavra))) {
          continue;
        }

        let lancamento = null;

        // Tenta parsing por delimitadores (|, ;, tab)
        if (linha.includes('|') || linha.includes(';') || linha.includes('\t')) {
          const partes = linha.split(/[|;\t]+/).map(p => p.trim()).filter(p => p);

          if (partes.length >= 3) {
            try {
              // Tenta detectar formato: pode ser Data|Descrição|... ou Campo|Data|...
              let dataStr = null;
              let descricao = null;
              let valorStr = null;
              let valorIdx = null;
              let accountCode = null;
              let documento = null;

              // Formato Otimiza padrão: Data|Descrição|Conta|Documento|Valor|Categoria|Tipo (7 campos)
              if (partes.length === 7 && parseDataSafe(partes[0])) {
                // Formato fixo Otimiza
                dataStr = partes[0];
                descricao = partes[1] || '';
                accountCode = partes[2] || null;
                documento = partes[3] || null;
                valorStr = partes[4] || null;
                valorIdx = 4;
              } else {
                // Formato variável - detecta dinamicamente
                // Verifica se primeira parte é data
                if (parseDataSafe(partes[0])) {
                  dataStr = partes[0];
                  descricao = partes[1] || '';
                } else if (partes.length > 1 && parseDataSafe(partes[1])) {
                  dataStr = partes[1];
                  descricao = partes[0] || '';
                } else if (partes.length > 2 && parseDataSafe(partes[2])) {
                  dataStr = partes[2];
                  descricao = partes.slice(0, 2).filter(p => p).join(' ');
                } else {
                  // Fallback: usa primeira parte como data
                  dataStr = partes[0];
                  descricao = partes[1] || '';
                }

                const idxInicio = parseDataSafe(partes[0]) ? 2 : (parseDataSafe(partes[1]) ? 2 : 3);

                // Procura valor (formato numérico com vírgula ou ponto decimal)
                // Ignora contas contábeis (formato X.X.X) e documentos alfanuméricos
                for (let i = idxInicio; i < partes.length; i++) {
                  const parte = partes[i];
                  if (!parte) continue;

                  // Ignora contas contábeis (formato 1.2.1, 2.1.1, etc)
                  if (/^\d+\.\d+\.\d+/.test(parte)) {
                    if (!accountCode) accountCode = parte;
                    continue;
                  }

                  // Ignora documentos alfanuméricos (NF001, PIX001, etc)
                  if (/^[A-Z]+\d+$/i.test(parte)) {
                    if (!documento) documento = parte;
                    continue;
                  }

                  // Se parece com valor numérico (não é conta contábil)
                  if (/^[\d.,-]+$/.test(parte)) {
                    // Verifica se tem vírgula ou ponto decimal (não é conta X.X.X)
                    const temVirgula = parte.includes(',');
                    const temPontoDecimal = parte.includes('.') && parte.split('.')[1]?.length <= 2;
                    const naoEConta = !/^\d+\.\d+\./.test(parte); // Não é formato 1.2.1
                    
                    if ((temVirgula || temPontoDecimal) && naoEConta) {
                      valorStr = parte;
                      valorIdx = i;
                      break;
                    }
                  }
                }
              }

              const data = parseDataSafe(dataStr);
              if (!data) {
                continue;
              }

              if (!valorStr) {
                issues.push(`Linha ${numLinha + 1}: Valor não encontrado`);
                if (strict) {
                  throw new Error(`Linha ${numLinha + 1}: Valor não encontrado`);
                }
                continue;
              }

              const valor = parseValor(valorStr);
              if (valor === 0.0) {
                continue;
              }

              // Procura descrição após o valor (se ainda não encontrou)
              if (!descricao || descricao.length < 10) {
                for (let i = valorIdx + 1; i < partes.length; i++) {
                  const parte = partes[i];
                  if (parte && parte.length > 10 && !/^[\d.,-]+$/.test(parte)) {
                    descricao = parte;
                    break;
                  }
                }
              }

              // Procura outros campos (categoria, tipo, etc) se não foram definidos
              let eventType = null;
              let category = null;
              let entityType = null;

              // Se formato fixo (7 campos), já temos tudo
              if (partes.length === 7) {
                category = partes[5] || null;
                entityType = partes[6] || null;
              } else {
                // Procura conta contábil se não foi definida (formato X.X.X ou número)
                if (!accountCode) {
                  for (let i = 0; i < partes.length; i++) {
                    if (i === valorIdx) continue;
                    const parte = partes[i];
                    if (parte && /^\d+\.\d+\.\d+/.test(parte)) {
                      accountCode = parte;
                      break;
                    }
                  }
                }

                // Procura documento se não foi definido
                if (!documento) {
                  for (let i = 0; i < partes.length; i++) {
                    if (i === valorIdx) continue;
                    const parte = partes[i];
                    if (parte && /^[A-Z]+\d+$/i.test(parte)) {
                      documento = parte;
                      break;
                    }
                  }
                }
              }

              lancamento = {
                data: format(data, 'yyyy-MM-dd'),
                descricao: descricao || '',
                documento: documento,
                valor: valor,
                saldo: null,
                conta_contabil: accountCode,
                origem: 'otimiza',
                account_code: accountCode,
                event_type: eventType,
                category: category,
                entity_type: entityType
              };

              lancamentos.push(lancamento);
            } catch (e) {
              issues.push(`Linha ${numLinha + 1}: Erro ao parsear formato delimitado: ${e.message}`);
              if (strict) {
                throw e;
              }
              continue;
            }
          }
        } else {
          // Tenta padrão: data no início da linha
          const padraoDataInicio = /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+?)\s+([\d.,-]+)\s*(D|C|DEBITO|CREDITO)?$/i;
          const match = linha.match(padraoDataInicio);

          if (match) {
            const data = parseDataSafe(match[1]);
            if (data) {
              const descricao = match[2].trim();
              const valor = parseValor(match[3]);

              if (valor !== 0.0) {
                lancamento = {
                  data: format(data, 'yyyy-MM-dd'),
                  descricao: descricao,
                  documento: null,
                  valor: valor,
                  saldo: null,
                  conta_contabil: null,
                  origem: 'otimiza',
                  account_code: null,
                  event_type: null,
                  category: null,
                  entity_type: null
                };

                lancamentos.push(lancamento);
              }
            }
          }
        }
      }

      console.log(`Parsing concluído. Total de lançamentos extraídos: ${lancamentos.length}`);
      if (issues.length > 0) {
        console.warn(`Total de issues encontradas: ${issues.length}`);
      }

      resolve({ lancamentos, issues });
    } catch (error) {
      console.error(`Erro ao processar TXT: ${error.message}`);
      reject(error);
    }
  });
}

module.exports = {
  parseOtimizaTxt,
  parseValor,
  parseDataSafe,
  parseData
};

