// Parser para arquivos MPDS em formato CSV (extrato estruturado)
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { format, parse, isValid } = require('date-fns');

/**
 * Detecta o delimitador do CSV (vírgula ou ponto e vírgula).
 */
function detectDelimiter(firstLine) {
  const countSemicolon = (firstLine.match(/;/g) || []).length;
  const countComma = (firstLine.match(/,/g) || []).length;
  return countSemicolon > countComma ? ';' : ',';
}

/**
 * Normaliza nome de coluna para comparação (remove acentos, espaços, etc).
 */
function normalizeColumnName(col) {
  if (!col) return '';
  return col.trim().toUpperCase()
    .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
    .replace(/Ó/g, 'O').replace(/Ú/g, 'U')
    .replace(/Ã/g, 'A').replace(/Õ/g, 'O').replace(/Ç/g, 'C');
}

/**
 * Encontra o índice de uma coluna pelo nome (com variações).
 */
function findColumnIndex(headers, possibleNames) {
  for (let idx = 0; idx < headers.length; idx++) {
    const headerNorm = normalizeColumnName(headers[idx]);
    for (const name of possibleNames) {
      const nameNorm = normalizeColumnName(name);
      if (headerNorm.includes(nameNorm) || nameNorm.includes(headerNorm)) {
        return idx;
      }
    }
  }
  return null;
}

/**
 * Converte string brasileira ou americana para float.
 */
function parseValor(valorStr) {
  if (!valorStr || String(valorStr).trim() === '') {
    return 0.0;
  }

  let valor = String(valorStr).trim();
  let negativo = false;

  if (valor.startsWith('-')) {
    negativo = true;
    valor = valor.substring(1).trim();
  }

  // Detecta formato (brasileiro vs americano)
  if (valor.includes(',') && valor.includes('.')) {
    if (valor.lastIndexOf(',') > valor.lastIndexOf('.')) {
      // Brasileiro: 1.234,56
      valor = valor.replace(/\./g, '').replace(',', '.');
    } else {
      // Americano: 1,234.56
      valor = valor.replace(/,/g, '');
    }
  } else if (valor.includes(',')) {
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
 * Converte string de data para Date.
 */
function parseData(dataStr) {
  if (!dataStr || String(dataStr).trim() === '') {
    return null;
  }

  const data = String(dataStr).trim();
  const formatos = [
    'dd/MM/yyyy',
    'dd/MM/yy',
    'yyyy-MM-dd',
    'dd-MM-yyyy',
    'dd-MM-yy'
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

  console.warn(`Não foi possível converter data: ${dataStr}`);
  return null;
}

/**
 * Lê um arquivo CSV MPDS e retorna uma lista de lançamentos.
 * 
 * @param {string} filePath - Caminho para o arquivo CSV
 * @param {boolean} strict - Se true, falha ao encontrar linhas não parseáveis
 * @returns {Promise<{lancamentos: Array, issues: Array}>}
 */
function parseMpdsCsv(filePath, strict = false) {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return reject(new Error(`Arquivo não encontrado: ${fullPath}`));
    }

    const lancamentos = [];
    const issues = [];

    // Lê primeira linha para detectar delimitador
    const firstLine = fs.readFileSync(fullPath, 'utf-8').split('\n')[0];
    const delimiter = detectDelimiter(firstLine);

    const rows = [];
    let headers = null;

    fs.createReadStream(fullPath)
      .pipe(csv({ separator: delimiter, skipEmptyLines: true }))
      .on('headers', (headerList) => {
        headers = headerList;
        console.log(`Cabeçalhos detectados: ${headers.join(', ')}`);
        console.log(`Delimitador detectado: ${delimiter}`);
      })
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        try {
          if (!headers || headers.length === 0) {
            throw new Error('Arquivo CSV vazio ou sem cabeçalho');
          }

          // Encontra índices das colunas
          const colDataIdx = findColumnIndex(headers, [
            'Data', 'DATA', 'Dt', 'DT', 'Data Lançamento', 'Data Movimento',
            'Date', 'DATE', 'Data Operação'
          ]);

          const colDescricaoIdx = findColumnIndex(headers, [
            'Descrição', 'DESCRIÇÃO', 'Histórico', 'HISTÓRICO', 'Hist', 'HIST',
            'Description', 'Memo', 'MEMO', 'Nome', 'NOME', 'Descrição Operação'
          ]);

          const colValorIdx = findColumnIndex(headers, [
            'Valor', 'VALOR', 'Val', 'VAL', 'Amount', 'AMOUNT', 'Valor Movimento'
          ]);

          const colDebitoIdx = findColumnIndex(headers, [
            'Débito', 'DÉBITO', 'Deb', 'DEB', 'Debit', 'DEBIT', 'Débito Movimento'
          ]);

          const colCreditoIdx = findColumnIndex(headers, [
            'Crédito', 'CRÉDITO', 'Cred', 'CRED', 'Credit', 'CREDIT', 'Crédito Movimento'
          ]);

          const colDocumentoIdx = findColumnIndex(headers, [
            'Documento', 'DOCUMENTO', 'Doc', 'DOC', 'Nº Doc', 'Num Doc', 'Número Documento'
          ]);

          const colSaldoIdx = findColumnIndex(headers, [
            'Saldo', 'SALDO', 'Sld', 'SLD', 'Balance', 'BALANCE'
          ]);

          // Valida colunas obrigatórias
          if (colDataIdx === null) {
            throw new Error('Coluna de data não encontrada no CSV');
          }

          if (colDescricaoIdx === null) {
            throw new Error('Coluna de descrição/histórico não encontrada no CSV');
          }

          if (colValorIdx === null && colDebitoIdx === null && colCreditoIdx === null) {
            throw new Error('Nenhuma coluna de valor encontrada no CSV (Valor, Débito ou Crédito)');
          }

          // Processa linhas
          for (let numLinha = 0; numLinha < rows.length; numLinha++) {
            const row = rows[numLinha];
            const rowArray = headers.map(h => row[h] || '');

            // Pula linhas vazias
            if (rowArray.every(cell => !cell || cell.trim() === '')) {
              continue;
            }

            try {
              // Data
              if (colDataIdx >= rowArray.length || !rowArray[colDataIdx]) {
                issues.push(`Linha ${numLinha + 2}: Data não encontrada`);
                if (strict) {
                  throw new Error(`Linha ${numLinha + 2}: Data não encontrada`);
                }
                continue;
              }

              const data = parseData(rowArray[colDataIdx]);
              if (!data) {
                issues.push(`Linha ${numLinha + 2}: Data inválida: ${rowArray[colDataIdx]}`);
                if (strict) {
                  throw new Error(`Linha ${numLinha + 2}: Data inválida`);
                }
                continue;
              }

              // Descrição
              if (colDescricaoIdx >= rowArray.length || !rowArray[colDescricaoIdx]) {
                issues.push(`Linha ${numLinha + 2}: Descrição não encontrada`);
                if (strict) {
                  throw new Error(`Linha ${numLinha + 2}: Descrição não encontrada`);
                }
                continue;
              }

              const descricao = String(rowArray[colDescricaoIdx]).trim();
              if (!descricao) {
                continue;
              }

              // Valor
              let valor = 0.0;

              // Tenta coluna única de valor
              if (colValorIdx !== null && colValorIdx < rowArray.length) {
                valor = parseValor(rowArray[colValorIdx]);
              }

              // Se não encontrou, tenta débito/crédito
              if (valor === 0.0) {
                let debito = 0.0;
                let credito = 0.0;

                if (colDebitoIdx !== null && colDebitoIdx < rowArray.length) {
                  debito = parseValor(rowArray[colDebitoIdx]);
                }

                if (colCreditoIdx !== null && colCreditoIdx < rowArray.length) {
                  credito = parseValor(rowArray[colCreditoIdx]);
                }

                if (debito !== 0) {
                  valor = -Math.abs(debito); // Débito é negativo
                } else if (credito !== 0) {
                  valor = Math.abs(credito); // Crédito é positivo
                }
              }

              if (valor === 0.0) {
                continue; // Pula lançamentos com valor zero
              }

              // Documento (opcional)
              let documento = null;
              if (colDocumentoIdx !== null && colDocumentoIdx < rowArray.length) {
                const docStr = String(rowArray[colDocumentoIdx]).trim();
                if (docStr) {
                  documento = docStr;
                }
              }

              // Saldo (opcional)
              let saldo = null;
              if (colSaldoIdx !== null && colSaldoIdx < rowArray.length) {
                const saldoStr = rowArray[colSaldoIdx];
                if (saldoStr) {
                  saldo = parseValor(saldoStr);
                }
              }

              const lancamento = {
                data: format(data, 'yyyy-MM-dd'),
                descricao: descricao,
                documento: documento,
                valor: valor,
                saldo: saldo,
                conta_contabil: null,
                origem: 'mpds'
              };

              lancamentos.push(lancamento);
            } catch (e) {
              issues.push(`Linha ${numLinha + 2}: Erro ao processar: ${e.message}`);
              if (strict) {
                throw e;
              }
              continue;
            }
          }

          console.log(`Parsing concluído. Total de lançamentos extraídos: ${lancamentos.length}`);
          if (issues.length > 0) {
            console.warn(`Total de issues encontradas: ${issues.length}`);
          }

          resolve({ lancamentos, issues });
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

module.exports = {
  parseMpdsCsv,
  parseValor,
  parseData
};

