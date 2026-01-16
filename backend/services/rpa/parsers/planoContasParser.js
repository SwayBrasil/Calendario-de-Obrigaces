// Parser para Plano de Contas (CSV/XLSX)
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const ExcelJS = require('exceljs');

/**
 * Normaliza nome de coluna para comparação
 */
function normalizeColumnName(col) {
  if (!col) return '';
  return String(col).trim().toUpperCase()
    .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
    .replace(/Ó/g, 'O').replace(/Ú/g, 'U')
    .replace(/Ã/g, 'A').replace(/Õ/g, 'O').replace(/Ç/g, 'C');
}

/**
 * Encontra o índice de uma coluna pelo nome
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
 * Lê um arquivo CSV do plano de contas.
 * 
 * @param {string} filePath - Caminho para o arquivo CSV
 * @returns {Promise<Array>}
 */
function parsePlanoContasCsv(filePath) {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return reject(new Error(`Arquivo não encontrado: ${fullPath}`));
    }

    const contas = [];
    let headers = null;

    // Detecta delimitador
    const firstLine = fs.readFileSync(fullPath, 'utf-8').split('\n')[0];
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

    fs.createReadStream(fullPath)
      .pipe(csv({ separator: delimiter, skipEmptyLines: true }))
      .on('headers', (headerList) => {
        headers = headerList;
      })
      .on('data', (row) => {
        const rowArray = headers.map(h => row[h] || '');

        // Encontra colunas
        const colCodigo = findColumnIndex(headers, [
          'codigo', 'conta', 'account_code', 'cod', 'code'
        ]);

        const colNome = findColumnIndex(headers, [
          'descricao', 'nome', 'account_name', 'name', 'desc'
        ]);

        const colNivel = findColumnIndex(headers, [
          'nivel', 'level', 'niv'
        ]);

        const colPai = findColumnIndex(headers, [
          'pai', 'parent', 'parent_code', 'conta_pai'
        ]);

        const colTipo = findColumnIndex(headers, [
          'tipo', 'account_type', 'type', 'natureza'
        ]);

        const colNatureza = findColumnIndex(headers, [
          'nature', 'natureza', 'natureza_conta'
        ]);

        if (colCodigo === null || colNome === null) {
          return; // Pula linha se não tem colunas obrigatórias
        }

        if (colCodigo >= rowArray.length || !rowArray[colCodigo]) {
          return;
        }

        const accountCode = String(rowArray[colCodigo]).trim();
        if (!accountCode) {
          return;
        }

        const accountName = colNome < rowArray.length ? String(rowArray[colNome]).trim() : '';

        let accountLevel = null;
        if (colNivel !== null && colNivel < rowArray.length && rowArray[colNivel]) {
          try {
            accountLevel = parseInt(rowArray[colNivel], 10);
          } catch (e) {
            // Ignora
          }
        }

        let parentCode = null;
        if (colPai !== null && colPai < rowArray.length && rowArray[colPai]) {
          parentCode = String(rowArray[colPai]).trim();
        }

        let accountType = null;
        if (colTipo !== null && colTipo < rowArray.length && rowArray[colTipo]) {
          accountType = String(rowArray[colTipo]).trim();
        }

        let nature = null;
        if (colNatureza !== null && colNatureza < rowArray.length && rowArray[colNatureza]) {
          nature = String(rowArray[colNatureza]).trim();
        }

        contas.push({
          account_code: accountCode,
          account_name: accountName,
          account_level: accountLevel,
          parent_code: parentCode,
          account_type: accountType,
          nature: nature
        });
      })
      .on('end', () => {
        resolve(contas);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Lê um arquivo Excel do plano de contas.
 * 
 * @param {string} filePath - Caminho para o arquivo Excel
 * @returns {Promise<Array>}
 */
async function parsePlanoContasExcel(filePath) {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Arquivo não encontrado: ${fullPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fullPath);
  const worksheet = workbook.getWorksheet(1); // Primeira planilha

  if (!worksheet) {
    throw new Error('Planilha não encontrada no arquivo Excel');
  }

  const contas = [];
  let headers = null;

  // Lê cabeçalhos da primeira linha
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = row.values.slice(1); // Remove primeiro elemento (índice)
      return;
    }

    if (!headers) {
      return;
    }

    // Encontra colunas
    let colCodigo = null;
    let colNome = null;
    let colNivel = null;
    let colPai = null;
    let colTipo = null;
    let colNatureza = null;

    for (let idx = 0; idx < headers.length; idx++) {
      const colUpper = normalizeColumnName(String(headers[idx]));

      if (!colCodigo && ['codigo', 'conta', 'account_code', 'cod', 'code'].some(n => colUpper.includes(n.toUpperCase()))) {
        colCodigo = idx;
      }
      if (!colNome && ['descricao', 'nome', 'account_name', 'name', 'desc'].some(n => colUpper.includes(n.toUpperCase()))) {
        colNome = idx;
      }
      if (!colNivel && ['nivel', 'level', 'niv'].some(n => colUpper.includes(n.toUpperCase()))) {
        colNivel = idx;
      }
      if (!colPai && ['pai', 'parent', 'parent_code', 'conta_pai'].some(n => colUpper.includes(n.toUpperCase()))) {
        colPai = idx;
      }
      if (!colTipo && ['tipo', 'account_type', 'type', 'natureza'].some(n => colUpper.includes(n.toUpperCase()))) {
        colTipo = idx;
      }
      if (!colNatureza && ['nature', 'natureza', 'natureza_conta'].some(n => colUpper.includes(n.toUpperCase()))) {
        colNatureza = idx;
      }
    }

    if (colCodigo === null || colNome === null) {
      return; // Pula linha se não tem colunas obrigatórias
    }

    const rowValues = row.values.slice(1); // Remove primeiro elemento (índice)

    const accountCode = rowValues[colCodigo] ? String(rowValues[colCodigo]).trim() : '';
    if (!accountCode) {
      return;
    }

    const accountName = rowValues[colNome] ? String(rowValues[colNome]).trim() : '';

    let accountLevel = null;
    if (colNivel !== null && rowValues[colNivel]) {
      try {
        accountLevel = parseInt(rowValues[colNivel], 10);
      } catch (e) {
        // Ignora
      }
    }

    let parentCode = null;
    if (colPai !== null && rowValues[colPai]) {
      parentCode = String(rowValues[colPai]).trim();
    }

    let accountType = null;
    if (colTipo !== null && rowValues[colTipo]) {
      accountType = String(rowValues[colTipo]).trim();
    }

    let nature = null;
    if (colNatureza !== null && rowValues[colNatureza]) {
      nature = String(rowValues[colNatureza]).trim();
    }

    contas.push({
      account_code: accountCode,
      account_name: accountName,
      account_level: accountLevel,
      parent_code: parentCode,
      account_type: accountType,
      nature: nature
    });
  });

  return contas;
}

/**
 * Função unificada que detecta o tipo de arquivo e chama o parser apropriado.
 * 
 * @param {string} filePath - Caminho para o arquivo
 * @returns {Promise<Array>}
 */
async function parsePlanoContas(filePath) {
  const fileExt = path.extname(filePath).toLowerCase();

  if (fileExt === '.csv') {
    return await parsePlanoContasCsv(filePath);
  } else if (fileExt === '.xlsx' || fileExt === '.xls') {
    return await parsePlanoContasExcel(filePath);
  } else {
    throw new Error(`Formato não suportado: ${fileExt}. Use CSV ou Excel.`);
  }
}

module.exports = {
  parsePlanoContas,
  parsePlanoContasCsv,
  parsePlanoContasExcel
};

