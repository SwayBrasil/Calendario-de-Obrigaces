// Parser para arquivos MPDS em formato OFX (Open Financial Exchange)
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

/**
 * Converte data OFX para Date.
 * Formato OFX: YYYYMMDD ou YYYYMMDDHHMMSS
 */
function parseOfxDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  const date = dateStr.trim();

  // OFX pode ter formato YYYYMMDD ou YYYYMMDDHHMMSS
  if (date.length >= 8) {
    try {
      const year = parseInt(date.substring(0, 4), 10);
      const month = parseInt(date.substring(4, 6), 10);
      const day = parseInt(date.substring(6, 8), 10);
      return new Date(year, month - 1, day);
    } catch (e) {
      console.warn(`Não foi possível converter data OFX: ${dateStr}`);
      return null;
    }
  }

  return null;
}

/**
 * Converte valor OFX para float.
 * OFX usa formato americano (ponto decimal).
 */
function parseOfxAmount(amountStr) {
  if (!amountStr || amountStr.trim() === '') {
    return 0.0;
  }

  const amount = amountStr.trim();

  try {
    return parseFloat(amount);
  } catch (e) {
    console.warn(`Não foi possível converter valor OFX: ${amountStr}`);
    return 0.0;
  }
}

/**
 * Lê um arquivo OFX MPDS e retorna uma lista de lançamentos.
 * 
 * @param {string} filePath - Caminho para o arquivo OFX
 * @param {boolean} strict - Se true, falha ao encontrar transações não parseáveis
 * @returns {Promise<{lancamentos: Array, issues: Array}>}
 */
function parseMpdsOfx(filePath, strict = false) {
  return new Promise((resolve, reject) => {
    try {
      const fullPath = path.resolve(filePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`Arquivo não encontrado: ${fullPath}`);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      const lancamentos = [];
      const issues = [];

      // OFX pode ter tags XML ou formato SGML
      // Procura por blocos STMTTRN (Statement Transaction)
      
      // Regex para encontrar transações (funciona com ambos os formatos)
      const stmttrnPattern = /<STMTTRN>(.*?)<\/STMTTRN>/gis;
      const transacoes = [];
      let match;

      while ((match = stmttrnPattern.exec(content)) !== null) {
        transacoes.push(match[1]);
      }

      console.log(`Total de transações encontradas: ${transacoes.length}`);

      for (let idx = 0; idx < transacoes.length; idx++) {
        const transacao = transacoes[idx];
        try {
          // Extrai campos da transação
          const dtpostedMatch = transacao.match(/<DTPOSTED[^>]*>([^<]+)/i);
          const trnamtMatch = transacao.match(/<TRNAMT[^>]*>([^<]+)/i);
          const fitidMatch = transacao.match(/<FITID[^>]*>([^<]+)/i);
          const memoMatch = transacao.match(/<MEMO[^>]*>([^<]+)/i);
          const nameMatch = transacao.match(/<NAME[^>]*>([^<]+)/i);

          // Data (obrigatória)
          if (!dtpostedMatch) {
            issues.push(`Transação ${idx + 1}: DTPOSTED não encontrado`);
            if (strict) {
              throw new Error(`Transação ${idx + 1}: DTPOSTED não encontrado`);
            }
            continue;
          }

          const data = parseOfxDate(dtpostedMatch[1]);
          if (!data) {
            issues.push(`Transação ${idx + 1}: Data inválida: ${dtpostedMatch[1]}`);
            if (strict) {
              throw new Error(`Transação ${idx + 1}: Data inválida`);
            }
            continue;
          }

          // Valor (obrigatório)
          if (!trnamtMatch) {
            issues.push(`Transação ${idx + 1}: TRNAMT não encontrado`);
            if (strict) {
              throw new Error(`Transação ${idx + 1}: TRNAMT não encontrado`);
            }
            continue;
          }

          const valor = parseOfxAmount(trnamtMatch[1]);
          if (valor === 0.0) {
            continue; // Pula transações com valor zero
          }

          // Descrição (MEMO ou NAME)
          let descricao = '';
          if (memoMatch) {
            descricao = memoMatch[1].trim();
          } else if (nameMatch) {
            descricao = nameMatch[1].trim();
          }

          if (!descricao) {
            descricao = 'Transação sem descrição';
          }

          // Documento (FITID - Financial Institution Transaction ID)
          let documento = null;
          if (fitidMatch) {
            documento = fitidMatch[1].trim();
          }

          const lancamento = {
            data: format(data, 'yyyy-MM-dd'),
            descricao: descricao,
            documento: documento,
            valor: valor,
            saldo: null, // OFX geralmente não tem saldo por transação
            conta_contabil: null,
            origem: 'mpds'
          };

          lancamentos.push(lancamento);
        } catch (e) {
          issues.push(`Transação ${idx + 1}: Erro ao processar: ${e.message}`);
          if (strict) {
            throw e;
          }
          continue;
        }
      }

      // Se não encontrou transações no formato STMTTRN, tenta formato alternativo
      if (transacoes.length === 0) {
        console.warn('Nenhuma transação STMTTRN encontrada. Tentando formato alternativo...');
        // TODO: Implementar parsing alternativo se necessário
      }

      console.log(`Parsing concluído. Total de lançamentos extraídos: ${lancamentos.length}`);
      if (issues.length > 0) {
        console.warn(`Total de issues encontradas: ${issues.length}`);
      }

      resolve({ lancamentos, issues });
    } catch (error) {
      console.error(`Erro ao processar OFX: ${error.message}`);
      reject(error);
    }
  });
}

module.exports = {
  parseMpdsOfx,
  parseOfxDate,
  parseOfxAmount
};

