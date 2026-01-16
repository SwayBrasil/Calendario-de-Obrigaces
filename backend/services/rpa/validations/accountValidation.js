// Motor de Validação Determinística de Contas Contábeis
const { format } = require('date-fns');

/**
 * Valida se a conta existe no plano de contas.
 */
async function validateAccountExists(accountCode, source, db) {
  if (!accountCode || !accountCode.trim()) {
    return { exists: false, message: 'Código de conta vazio' };
  }

  accountCode = accountCode.trim();

  if (!db) {
    return { exists: false, message: 'Banco de dados não fornecido' };
  }

  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM chart_of_accounts 
      WHERE account_code = ? AND source = ? AND is_active = 1
      LIMIT 1
    `;

    db.get(sql, [accountCode, source], (err, row) => {
      if (err) {
        reject(err);
      } else if (row) {
        resolve({ exists: true, message: `Conta ${accountCode} encontrada: ${row.account_name}` });
      } else {
        resolve({ exists: false, message: `Conta ${accountCode} não encontrada no plano de contas` });
      }
    });
  });
}

/**
 * Encontra regras de validação que correspondem ao lançamento.
 */
async function findMatchingRules(lancamento, db) {
  if (!db) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM account_validation_rules WHERE is_enabled = 1`;

    db.all(sql, [], (err, rules) => {
      if (err) {
        reject(err);
        return;
      }

      const matchingRules = [];

      rules.forEach((regra) => {
        // Obtém o valor do campo de match do lançamento
        let matchValue = null;

        if (regra.match_field === 'event_type') {
          matchValue = lancamento.event_type;
        } else if (regra.match_field === 'category') {
          matchValue = lancamento.category;
        } else if (regra.match_field === 'entity_type') {
          matchValue = lancamento.entity_type;
        } else {
          // Tenta acessar como atributo do lançamento
          matchValue = lancamento[regra.match_field];
        }

        // Match simples: igualdade case-insensitive
        if (matchValue && String(matchValue).trim().toUpperCase() === String(regra.match_value).trim().toUpperCase()) {
          // Parse JSON fields
          let allowedPrefixes = [];
          let allowedCodes = [];
          let blockedPrefixes = [];
          let blockedCodes = [];

          if (regra.allowed_account_prefixes) {
            try {
              allowedPrefixes = JSON.parse(regra.allowed_account_prefixes);
            } catch (e) {
              allowedPrefixes = [];
            }
          }

          if (regra.allowed_account_codes) {
            try {
              allowedCodes = JSON.parse(regra.allowed_account_codes);
            } catch (e) {
              allowedCodes = [];
            }
          }

          if (regra.blocked_account_prefixes) {
            try {
              blockedPrefixes = JSON.parse(regra.blocked_account_prefixes);
            } catch (e) {
              blockedPrefixes = [];
            }
          }

          if (regra.blocked_account_codes) {
            try {
              blockedCodes = JSON.parse(regra.blocked_account_codes);
            } catch (e) {
              blockedCodes = [];
            }
          }

          matchingRules.push({
            ...regra,
            allowed_account_prefixes: allowedPrefixes,
            allowed_account_codes: allowedCodes,
            blocked_account_prefixes: blockedPrefixes,
            blocked_account_codes: blockedCodes
          });
        }
      });

      resolve(matchingRules);
    });
  });
}

/**
 * Valida se a conta está de acordo com as regras.
 */
function validateAccountAgainstRules(accountCode, rules) {
  if (!accountCode || !accountCode.trim()) {
    return {
      status: 'unknown',
      reason_code: 'MISSING_ACCOUNT_CODE',
      message: 'Código de conta não fornecido',
      expected: null,
      meta: null
    };
  }

  accountCode = accountCode.trim();

  if (!rules || rules.length === 0) {
    return {
      status: 'unknown',
      reason_code: 'NO_RULE_MATCH',
      message: 'Nenhuma regra encontrada para este tipo de lançamento',
      expected: null,
      meta: null
    };
  }

  // Aplica todas as regras (se uma falhar, retorna invalid)
  for (const regra of rules) {
    let allowed = false;

    // Verifica allowed_account_codes
    if (regra.allowed_account_codes && regra.allowed_account_codes.length > 0) {
      if (regra.allowed_account_codes.includes(accountCode)) {
        allowed = true;
      }
    }

    // Verifica allowed_account_prefixes
    if (!allowed && regra.allowed_account_prefixes && regra.allowed_account_prefixes.length > 0) {
      for (const prefix of regra.allowed_account_prefixes) {
        if (accountCode.startsWith(prefix)) {
          allowed = true;
          break;
        }
      }
    }

    // Verifica blocked_account_codes
    if (regra.blocked_account_codes && regra.blocked_account_codes.includes(accountCode)) {
      return {
        status: 'invalid',
        reason_code: 'RULE_VIOLATION',
        message: regra.message || `Conta ${accountCode} está bloqueada pela regra '${regra.name}'`,
        expected: {
          allowed_prefixes: regra.allowed_account_prefixes || [],
          allowed_codes: regra.allowed_account_codes || [],
          blocked_prefixes: regra.blocked_account_prefixes || [],
          blocked_codes: regra.blocked_account_codes || []
        },
        meta: {
          rule_id: regra.id,
          rule_name: regra.name,
          match_field: regra.match_field,
          match_value: regra.match_value,
          severity: regra.severity
        }
      };
    }

    // Verifica blocked_account_prefixes
    if (regra.blocked_account_prefixes && regra.blocked_account_prefixes.length > 0) {
      for (const prefix of regra.blocked_account_prefixes) {
        if (accountCode.startsWith(prefix)) {
          return {
            status: 'invalid',
            reason_code: 'RULE_VIOLATION',
            message: regra.message || `Conta ${accountCode} está bloqueada pela regra '${regra.name}' (prefixo ${prefix})`,
            expected: {
              allowed_prefixes: regra.allowed_account_prefixes || [],
              allowed_codes: regra.allowed_account_codes || [],
              blocked_prefixes: regra.blocked_account_prefixes || [],
              blocked_codes: regra.blocked_account_codes || []
            },
            meta: {
              rule_id: regra.id,
              rule_name: regra.name,
              match_field: regra.match_field,
              match_value: regra.match_value,
              severity: regra.severity
            }
          };
        }
      }
    }

    // Se não está em allowed, viola a regra
    if (!allowed) {
      return {
        status: 'invalid',
        reason_code: 'RULE_VIOLATION',
        message: regra.message || `Conta ${accountCode} não está permitida pela regra '${regra.name}'`,
        expected: {
          allowed_prefixes: regra.allowed_account_prefixes || [],
          allowed_codes: regra.allowed_account_codes || [],
          blocked_prefixes: regra.blocked_account_prefixes || [],
          blocked_codes: regra.blocked_account_codes || []
        },
        meta: {
          rule_id: regra.id,
          rule_name: regra.name,
          match_field: regra.match_field,
          match_value: regra.match_value,
          severity: regra.severity
        }
      };
    }
  }

  // Se passou por todas as regras, está OK
  return {
    status: 'ok',
    reason_code: 'VALID',
    message: `Conta ${accountCode} validada com sucesso`,
    expected: null,
    meta: {
      rules_applied: rules.map(r => r.id)
    }
  };
}

/**
 * Valida contas de todos os lançamentos do Otimiza.
 */
async function validateLancamentosAccounts(comparacaoId, lancamentosOtimiza, source, db) {
  if (!db) {
    throw new Error('Banco de dados é obrigatório');
  }

  const total = lancamentosOtimiza.length;
  let okCount = 0;
  let invalidCount = 0;
  let unknownCount = 0;

  console.log(`[ACCOUNT_VALIDATION] Iniciando validação para comparação ${comparacaoId}, total=${total}`);

  const { createAccountValidationResult } = require('../../../database');

  for (let idx = 0; idx < lancamentosOtimiza.length; idx++) {
    const lancamento = lancamentosOtimiza[idx];

    // Gera chave única do lançamento
    const dataStr = typeof lancamento.data === 'string' ? lancamento.data : format(lancamento.data, 'yyyy-MM-dd');
    const lancamentoKey = `${dataStr}_${lancamento.valor}_${idx}`;

    const accountCode = lancamento.account_code || lancamento.conta_contabil;

    // Se não tem código de conta
    if (!accountCode || !accountCode.trim()) {
      await createAccountValidationResult({
        comparacao_id: comparacaoId,
        lancamento_key: lancamentoKey,
        account_code: '',
        status: 'unknown',
        reason_code: 'MISSING_ACCOUNT_CODE',
        message: 'Código de conta não fornecido no lançamento',
        expected: null,
        meta: {
          data: dataStr,
          descricao: lancamento.descricao,
          valor: lancamento.valor
        }
      });
      unknownCount++;
      continue;
    }

    const accountCodeClean = accountCode.trim();

    // Valida existência
    const { exists, message: existsMsg } = await validateAccountExists(accountCodeClean, source, db);

    if (!exists) {
      await createAccountValidationResult({
        comparacao_id: comparacaoId,
        lancamento_key: lancamentoKey,
        account_code: accountCodeClean,
        status: 'invalid',
        reason_code: 'ACCOUNT_NOT_FOUND',
        message: existsMsg,
        expected: null,
        meta: {
          data: dataStr,
          descricao: lancamento.descricao,
          valor: lancamento.valor
        }
      });
      invalidCount++;
      console.warn(`[ACCOUNT_VALIDATION] comparacao_id=${comparacaoId} account_code=${accountCodeClean} ACCOUNT_NOT_FOUND`);
      continue;
    }

    // Busca regras
    const rules = await findMatchingRules(lancamento, db);

    // Valida contra regras
    const validationResult = validateAccountAgainstRules(accountCodeClean, rules);

    // Adiciona dados do lançamento ao meta
    if (validationResult.meta) {
      validationResult.meta = {
        ...validationResult.meta,
        data: dataStr,
        descricao: lancamento.descricao,
        valor: lancamento.valor,
        event_type: lancamento.event_type,
        category: lancamento.category,
        entity_type: lancamento.entity_type
      };
    }

    await createAccountValidationResult({
      comparacao_id: comparacaoId,
      lancamento_key: lancamentoKey,
      account_code: accountCodeClean,
      status: validationResult.status,
      reason_code: validationResult.reason_code,
      message: validationResult.message,
      expected: validationResult.expected,
      meta: validationResult.meta
    });

    if (validationResult.status === 'ok') {
      okCount++;
    } else if (validationResult.status === 'invalid') {
      invalidCount++;
      console.warn(
        `[ACCOUNT_VALIDATION] comparacao_id=${comparacaoId} account_code=${accountCodeClean} ` +
        `RULE_VIOLATION rule_id=${validationResult.meta?.rule_id || null}`
      );
    } else {
      unknownCount++;
    }
  }

  console.log(
    `[ACCOUNT_VALIDATION] comparacao_id=${comparacaoId} total=${total} ` +
    `ok=${okCount} invalid=${invalidCount} unknown=${unknownCount}`
  );

  return {
    total,
    ok: okCount,
    invalid: invalidCount,
    unknown: unknownCount
  };
}

module.exports = {
  validateAccountExists,
  findMatchingRules,
  validateAccountAgainstRules,
  validateLancamentosAccounts
};

