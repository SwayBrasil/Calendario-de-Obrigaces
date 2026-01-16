// Rotas RPA Domínio
const express = require('express');
const multer = require('multer');
const path = require('path');
const { getUserByUid } = require('../database');

// Middleware de autenticação (mesmo do server.js)
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido ou formato inválido' });
    }
    
    const token = authHeader.slice(7);

    // Verificar se é um token mock válido
    if (token.startsWith('mock-token-')) {
      const uid = token.substring('mock-token-'.length);
      const userData = await getUserByUid(uid);
      
      if (!userData) {
        return res.status(401).json({ error: 'Usuário não encontrado' });
      }

      req.user = {
        uid: userData.uid,
        email: userData.email,
        nomeCompleto: userData.nome_completo,
        cargo: userData.cargo
      };
      return next();
    }

    // Token não reconhecido
    return res.status(401).json({ error: 'Formato de token inválido. Use mock-token-<UID> para autenticação.' });
  } catch (err) {
    console.error('[AUTH] Erro inesperado:', err);
    return res.status(500).json({ error: 'Erro na autenticação: ' + err.message });
  }
};
const {
  createComparacao,
  getComparacaoById,
  listComparacoes,
  deleteComparacao,
  getDivergenciasByComparacaoId,
  getAccountValidationResultsByComparacaoId,
  upsertChartOfAccount,
  getChartOfAccounts,
  deleteChartOfAccountsBySource,
  db
} = require('../database');
const { processarComparacao } = require('../workers/processarComparacao');
const { parsePlanoContas } = require('../services/rpa/parsers/planoContasParser');

const router = express.Router();

// Configuração do multer para upload de arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

/**
 * POST /api/comparacoes
 * Cria uma nova comparação
 */
router.post('/comparacoes', authenticateToken, upload.fields([
  { name: 'otimiza', maxCount: 10 },
  { name: 'mpds', maxCount: 1 }
]), async (req, res) => {
  try {
    const { periodo_inicio, periodo_fim, source_type = 'OTIMIZA_TXT', bank_source_type = 'CSV' } = req.body;

    if (!periodo_inicio || !periodo_fim) {
      return res.status(400).json({ error: 'periodo_inicio e periodo_fim são obrigatórios' });
    }

    // Processa arquivos
    const inputFiles = {
      otimiza: [],
      mpds: []
    };

    if (req.files.otimiza) {
      req.files.otimiza.forEach(file => {
        inputFiles.otimiza.push({
          filename: file.originalname,
          buffer: file.buffer.toString('base64'),
          mimetype: file.mimetype,
          size: file.size
        });
      });
    }

    if (req.files.mpds) {
      req.files.mpds.forEach(file => {
        inputFiles.mpds.push({
          filename: file.originalname,
          buffer: file.buffer.toString('base64'),
          mimetype: file.mimetype,
          size: file.size
        });
      });
    }

    if (inputFiles.otimiza.length === 0) {
      return res.status(400).json({ error: 'Pelo menos um arquivo Otimiza é obrigatório' });
    }

    if (inputFiles.mpds.length === 0) {
      return res.status(400).json({ error: 'Arquivo MPDS é obrigatório' });
    }

    // Detecta tipo do MPDS pela extensão
    const mpdsFile = inputFiles.mpds[0];
    const mpdsExt = path.extname(mpdsFile.filename).toLowerCase();
    let detectedBankType = bank_source_type;
    if (mpdsExt === '.csv') {
      detectedBankType = 'CSV';
    } else if (mpdsExt === '.ofx') {
      detectedBankType = 'OFX';
    } else if (mpdsExt === '.pdf') {
      detectedBankType = 'PDF';
    }

    // Cria comparação
    const comparacao = await createComparacao({
      periodo_inicio,
      periodo_fim,
      source_type,
      bank_source_type: detectedBankType,
      input_files: inputFiles,
      status: 'pendente'
    });

    // Dispara worker em background (não bloqueia resposta)
    processarComparacao(comparacao.id, db).catch(error => {
      console.error(`[RPA] Erro no worker da comparação ${comparacao.id}:`, error);
    });

    res.status(201).json({
      id: comparacao.id,
      status: 'processing',
      message: 'Comparação criada e processamento iniciado'
    });
  } catch (error) {
    console.error('[RPA] Erro ao criar comparação:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/comparacoes
 * Lista todas as comparações
 */
router.get('/comparacoes', authenticateToken, async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 100;

    const comparacoes = await listComparacoes(skip, limit);

    res.json(comparacoes);
  } catch (error) {
    console.error('[RPA] Erro ao listar comparações:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/comparacoes/:id
 * Obtém detalhes de uma comparação
 */
router.get('/comparacoes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const comparacao = await getComparacaoById(id);
    if (!comparacao) {
      return res.status(404).json({ error: 'Comparação não encontrada' });
    }

    // Busca divergências
    const divergencias = await getDivergenciasByComparacaoId(id);

    // Busca resultados de validação
    const validationResults = await getAccountValidationResultsByComparacaoId(id);

    // Calcula resumo de validação
    const validationSummary = {
      total: validationResults.length,
      ok: validationResults.filter(r => r.status === 'ok').length,
      invalid: validationResults.filter(r => r.status === 'invalid').length,
      unknown: validationResults.filter(r => r.status === 'unknown').length
    };

    res.json({
      ...comparacao,
      divergencias,
      validation_results: validationResults,
      validation_summary: validationSummary
    });
  } catch (error) {
    console.error('[RPA] Erro ao obter comparação:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/comparacoes/:id
 * Deleta uma comparação
 */
router.delete('/comparacoes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const comparacao = await getComparacaoById(id);
    if (!comparacao) {
      return res.status(404).json({ error: 'Comparação não encontrada' });
    }

    await deleteComparacao(id);

    res.json({ message: 'Comparação deletada com sucesso' });
  } catch (error) {
    console.error('[RPA] Erro ao deletar comparação:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/plano-contas/upload
 * Upload de plano de contas
 */
router.post('/plano-contas/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo não fornecido' });
    }

    const { source = 'dominio' } = req.body;

    // Salva arquivo temporário
    const fs = require('fs');
    const tempDir = path.join(__dirname, '../data/temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempPath = path.join(tempDir, `plano_contas_${Date.now()}_${req.file.originalname}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    try {
      // Faz parse do arquivo
      const contas = await parsePlanoContas(tempPath);

      // Deleta plano de contas antigo da mesma source
      await deleteChartOfAccountsBySource(source);

      // Insere novas contas
      let inseridas = 0;
      for (const conta of contas) {
        await upsertChartOfAccount({
          source,
          account_code: conta.account_code,
          account_name: conta.account_name,
          account_level: conta.account_level,
          parent_code: conta.parent_code,
          account_type: conta.account_type,
          nature: conta.nature,
          is_active: true
        });
        inseridas++;
      }

      // Remove arquivo temporário
      fs.unlinkSync(tempPath);

      res.json({
        message: 'Plano de contas importado com sucesso',
        source,
        total_contas: inseridas
      });
    } catch (error) {
      // Remove arquivo temporário em caso de erro
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  } catch (error) {
    console.error('[RPA] Erro ao fazer upload do plano de contas:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plano-contas
 * Lista plano de contas
 */
router.get('/plano-contas', authenticateToken, async (req, res) => {
  try {
    const { source } = req.query;

    const contas = await getChartOfAccounts(source || null);

    res.json(contas);
  } catch (error) {
    console.error('[RPA] Erro ao listar plano de contas:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/debug/pdf-text
 * Debug: extrai texto de PDF para análise
 */
router.post('/debug/pdf-text', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo PDF não fornecido' });
    }

    const pdf = require('pdf-parse');
    const dataBuffer = req.file.buffer;

    const data = await pdf(dataBuffer, { max: 0 });
    const texto = data.text;

    // Busca por padrões de data
    const padroesData = [
      /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g,
      /\d{1,2}\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+\d{4}/gi
    ];

    const linhasComData = [];
    const linhas = texto.split('\n');
    linhas.forEach((linha, idx) => {
      padroesData.forEach(padrao => {
        if (padrao.test(linha)) {
          linhasComData.push({ linha: idx + 1, conteudo: linha.trim() });
        }
      });
    });

    res.json({
      total_pages: data.numpages,
      text_length: texto.length,
      text_preview: texto.substring(0, 2000),
      lines_with_dates: linhasComData.slice(0, 50),
      full_text: texto // Em produção, remover ou limitar
    });
  } catch (error) {
    console.error('[DEBUG] Erro ao extrair texto do PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

