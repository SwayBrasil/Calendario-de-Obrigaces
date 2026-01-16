const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Escolha do diretório de dados:
// 1) se configurar um disco no Render, monte em /var/data e defina DATA_DIR=/var/data
// 2) se não houver disco, use /tmp (volátil, mas gravável)
const isRender = !!process.env.RENDER || !!process.env.RENDER_EXTERNAL_HOSTNAME;
const preferred = process.env.DATA_DIR || (isRender ? '/var/data' : path.join(__dirname, 'data'));

// Fallback seguro quando preferred não puder ser usado
let dataDir = preferred;
try {
  fs.mkdirSync(preferred, { recursive: true, mode: 0o755 });
} catch (e) {
  console.warn('[DB] Não foi possível usar', preferred, '-> usando /tmp/pcp');
  dataDir = '/tmp/pcp';
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
}

const uploadsDir = path.join(dataDir, 'uploads');
try {
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 });
} catch (e) {
  console.error('[DB] Falha ao criar pasta de uploads:', e);
}

const dbPath = path.join(dataDir, 'pcp.db');

// Conexão
const db = new sqlite3.Database(
  dbPath,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error('Erro ao conectar com o banco SQLite:', err.message);
    } else {
      console.log('Conectado ao banco SQLite com sucesso!');
      console.log('[DB] Caminho do banco:', dbPath);
      console.log('[DB] Pasta de uploads:', uploadsDir);

      initializeDatabase();
    }
  }
);


// --- Schema / migrações (serializado) --------------------------------------
function initializeDatabase() {
  console.log('🔧 Inicializando banco de dados SQLite...');

  db.serialize(() => {
    // PRAGMAs
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA busy_timeout = 5000');

    // 1) usuarios
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        uid VARCHAR(255) PRIMARY KEY,
        nome_completo VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        cargo VARCHAR(50) DEFAULT 'usuario',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela usuarios:', err.message);
      else console.log('✅ Tabela usuarios criada/verificada com sucesso!');
    });

    // 2) tarefas
    db.run(`
      CREATE TABLE IF NOT EXISTS tarefas (
        id VARCHAR(255) PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        responsavel VARCHAR(255) NOT NULL,
        responsavel_id VARCHAR(255) NOT NULL,
        data_vencimento DATE,
        observacoes TEXT,
        status VARCHAR(50) DEFAULT 'pendente',
        recorrente BOOLEAN DEFAULT FALSE,
        frequencia VARCHAR(50) DEFAULT 'mensal',
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (responsavel_id) REFERENCES usuarios (uid)
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela tarefas:', err.message);
      else console.log('✅ Tabela tarefas criada/verificada com sucesso!');
    });

    // 3) arquivos
    db.run(`
      CREATE TABLE IF NOT EXISTS arquivos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size INTEGER NOT NULL,
        task_id VARCHAR(255) NOT NULL,
        uploaded_by VARCHAR(255) NOT NULL,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        download_count INTEGER DEFAULT 0,
        FOREIGN KEY (task_id) REFERENCES tarefas (id),
        FOREIGN KEY (uploaded_by) REFERENCES usuarios (uid)
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela arquivos:', err.message);
      else console.log('✅ Tabela arquivos criada/verificada com sucesso!');
    });

    // 4) atividade_logs
    db.run(`
      CREATE TABLE IF NOT EXISTS atividade_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id VARCHAR(255) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        task_id VARCHAR(255),
        task_title VARCHAR(255),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES usuarios (uid),
        FOREIGN KEY (task_id) REFERENCES tarefas (id)
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela atividade_logs:', err.message);
      else console.log('✅ Tabela atividade_logs criada/verificada com sucesso!');
    });

    // 5) arquivo_logs
    db.run(`
      CREATE TABLE IF NOT EXISTS arquivo_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arquivo_id INTEGER NOT NULL,
        action VARCHAR(50) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (arquivo_id) REFERENCES arquivos (id),
        FOREIGN KEY (user_id) REFERENCES usuarios (uid)
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela arquivo_logs:', err.message);
      else console.log('✅ Tabela arquivo_logs criada/verificada com sucesso!');
    });

    // 6) comparacoes (RPA Domínio)
    db.run(`
      CREATE TABLE IF NOT EXISTS comparacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        started_at DATETIME,
        finished_at DATETIME,
        periodo_inicio DATE NOT NULL,
        periodo_fim DATE NOT NULL,
        source_type VARCHAR(50) DEFAULT 'OTIMIZA_TXT',
        bank_source_type VARCHAR(50) DEFAULT 'CSV',
        input_files TEXT,
        status VARCHAR(50) DEFAULT 'pendente',
        erro TEXT,
        qtd_lancamentos_extrato INTEGER,
        qtd_lancamentos_razao INTEGER,
        qtd_divergencias INTEGER,
        parsing_issues TEXT
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela comparacoes:', err.message);
      else console.log('✅ Tabela comparacoes criada/verificada com sucesso!');
    });

    // 7) divergencias (RPA Domínio)
    db.run(`
      CREATE TABLE IF NOT EXISTS divergencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comparacao_id INTEGER NOT NULL,
        tipo VARCHAR(50) NOT NULL,
        descricao TEXT NOT NULL,
        data_extrato DATE,
        descricao_extrato VARCHAR(255),
        valor_extrato REAL,
        documento_extrato VARCHAR(100),
        conta_contabil_extrato VARCHAR(100),
        data_dominio DATE,
        descricao_dominio VARCHAR(255),
        valor_dominio REAL,
        documento_dominio VARCHAR(100),
        conta_contabil_dominio VARCHAR(100),
        FOREIGN KEY (comparacao_id) REFERENCES comparacoes (id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela divergencias:', err.message);
      else console.log('✅ Tabela divergencias criada/verificada com sucesso!');
    });

    // 8) chart_of_accounts (RPA Domínio)
    db.run(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source VARCHAR(50) DEFAULT 'dominio' NOT NULL,
        account_code VARCHAR(100) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_level INTEGER,
        parent_code VARCHAR(100),
        account_type VARCHAR(50),
        nature VARCHAR(50),
        is_active BOOLEAN DEFAULT 1 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE(source, account_code)
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela chart_of_accounts:', err.message);
      else console.log('✅ Tabela chart_of_accounts criada/verificada com sucesso!');
    });

    // 9) account_validation_rules (RPA Domínio)
    db.run(`
      CREATE TABLE IF NOT EXISTS account_validation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL,
        is_enabled BOOLEAN DEFAULT 1 NOT NULL,
        match_field VARCHAR(100) NOT NULL,
        match_value VARCHAR(255) NOT NULL,
        allowed_account_prefixes TEXT,
        allowed_account_codes TEXT,
        blocked_account_prefixes TEXT,
        blocked_account_codes TEXT,
        severity VARCHAR(20) DEFAULT 'error' NOT NULL,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela account_validation_rules:', err.message);
      else console.log('✅ Tabela account_validation_rules criada/verificada com sucesso!');
    });

    // 10) account_validation_results (RPA Domínio)
    db.run(`
      CREATE TABLE IF NOT EXISTS account_validation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comparacao_id INTEGER NOT NULL,
        lancamento_key VARCHAR(255) NOT NULL,
        account_code VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        reason_code VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        expected TEXT,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (comparacao_id) REFERENCES comparacoes (id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Erro ao criar tabela account_validation_results:', err.message);
      else console.log('✅ Tabela account_validation_results criada/verificada com sucesso!');
    });

    // Criar índices para melhor performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_divergencias_comparacao_id ON divergencias(comparacao_id)`, (err) => {
      if (err) console.error('❌ Erro ao criar índice divergencias:', err.message);
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_source_code ON chart_of_accounts(source, account_code)`, (err) => {
      if (err) console.error('❌ Erro ao criar índice chart_of_accounts:', err.message);
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_validation_results_comparacao_id ON account_validation_results(comparacao_id)`, (err) => {
      if (err) console.error('❌ Erro ao criar índice validation_results:', err.message);
    });

    // Seed do usuário "system" (evita falha de FK ao criar tarefas automáticas)
    db.get('SELECT uid FROM usuarios WHERE uid = ?', ['system'], (err, row) => {
      if (err) {
        console.error('[SEED] Falha ao consultar usuário system:', err.message);
        return;
      }
      if (!row) {
        db.run(
          `INSERT INTO usuarios (uid, nome_completo, email, password, cargo)
           VALUES (?, ?, ?, ?, ?)`,
          ['system', 'Sistema', 'sistema@local', null, 'admin'],
          (e2) => {
            if (e2) console.error('[SEED] Falha ao criar usuário system:', e2.message);
            else console.log('[SEED] Usuário system criado');
          }
        );
      } else {
        console.log('[SEED] Usuário system já existe');
      }
    });
  });

  console.log('🎉 Inicialização do banco de dados concluída!');
}



// Função para criar nova tarefa com validação e melhor error handling
function createTask(taskData) {
    return new Promise((resolve, reject) => {
        const { id, titulo, responsavel, responsavelId, dataVencimento, observacoes, recorrente = false, frequencia = 'mensal' } = taskData;

        // Validações
        if (!id || !titulo || !responsavel || !responsavelId) {
            const error = new Error(`Dados obrigatórios faltando: ${JSON.stringify({ id, titulo, responsavel, responsavelId })}`);
            console.error(`❌ Erro ao criar tarefa: ${error.message}`);
            return reject(error);
        }
        if (titulo.length > 255) {
            const error = new Error(`Título excede 255 caracteres: ${titulo}`);
            console.error(`❌ Erro ao criar tarefa: ${error.message}`);
            return reject(error);
        }
        if (dataVencimento && isNaN(new Date(dataVencimento).getTime())) {
            const error = new Error(`Data de vencimento inválida: ${dataVencimento}`);
            console.error(`❌ Erro ao criar tarefa: ${error.message}`);
            return reject(error);
        }

        const sql = `
            INSERT INTO tarefas (id, titulo, responsavel, responsavel_id, data_vencimento, observacoes, recorrente, frequencia)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(sql, [id, titulo, responsavel, responsavelId, dataVencimento || null, observacoes || null, recorrente, frequencia], function(err) {
            if (err) {
                console.error(`❌ Erro ao inserir tarefa "${titulo}": ${err.message}`);
                
                // Dar mensagem de erro mais clara para FOREIGN KEY constraint
                if (err.message.includes('FOREIGN KEY constraint failed')) {
                    const error = new Error(`O responsável com ID "${responsavelId}" não existe no sistema. Verifique se o usuário está cadastrado.`);
                    console.error(`❌ Erro de FOREIGN KEY: ResponsavelId "${responsavelId}" não encontrado`);
                    reject(error);
                } else {
                    reject(err);
                }
            } else {
                console.log(`✅ Tarefa criada com sucesso: ${titulo} (ID: ${id})`);
                resolve({ id, ...taskData });
            }
        });
    });
}

// Função para verificar se uma tarefa já existe (para evitar duplicatas)
function checkTaskExists(titulo, dataVencimento, responsavelId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT id FROM tarefas 
            WHERE titulo = ? AND data_vencimento = ? AND responsavel_id = ?
        `;
        db.get(sql, [titulo, dataVencimento, responsavelId], (err, row) => {
            if (err) {
                console.error(`❌ Erro ao verificar tarefa existente: ${err.message}`);
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

// Função para inserir um novo arquivo
function insertFile(fileData) {
    return new Promise((resolve, reject) => {
        const { filename, originalName, filePath, mimeType, size, taskId, uploadedBy } = fileData;
        
        const sql = `
            INSERT INTO arquivos (filename, original_name, file_path, mime_type, size, task_id, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(sql, [filename, originalName, filePath, mimeType, size, taskId, uploadedBy], function(err) {
            if (err) {
                console.error(`❌ Erro ao inserir arquivo "${filename}": ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Arquivo inserido: ${filename} (Task ID: ${taskId})`);
                resolve({
                    id: this.lastID,
                    filename,
                    originalName,
                    filePath,
                    mimeType,
                    size,
                    taskId,
                    uploadedBy,
                    uploadDate: new Date().toISOString()
                });
            }
        });
    });
}

// Função para buscar arquivos por task_id
function getFilesByTaskId(taskId) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT * FROM arquivos 
            WHERE task_id = ? 
            ORDER BY upload_date DESC
        `;
        
        db.all(sql, [taskId], (err, rows) => {
            if (err) {
                console.error(`❌ Erro ao buscar arquivos para task ${taskId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Encontrados ${rows.length} arquivos para task ${taskId}`);
                resolve(rows);
            }
        });
    });
}

// Função para buscar um arquivo por ID
function getFileById(fileId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM arquivos WHERE id = ?`;
        
        db.get(sql, [fileId], (err, row) => {
            if (err) {
                console.error(`❌ Erro ao buscar arquivo ${fileId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Arquivo encontrado: ${row ? row.filename : 'Nenhum arquivo'}`);
                resolve(row);
            }
        });
    });
}

// Função para deletar um arquivo
function deleteFile(fileId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM arquivos WHERE id = ?`;
        
        db.run(sql, [fileId], function(err) {
            if (err) {
                console.error(`❌ Erro ao deletar arquivo ${fileId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Arquivo ${fileId} deletado`);
                resolve({ deletedRows: this.changes });
            }
        });
    });
}

// Função para incrementar contador de downloads
function incrementDownloadCount(fileId) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE arquivos SET download_count = download_count + 1 WHERE id = ?`;
        
        db.run(sql, [fileId], function(err) {
            if (err) {
                console.error(`❌ Erro ao incrementar contador de downloads para arquivo ${fileId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Contador de downloads incrementado para arquivo ${fileId}`);
                resolve({ updatedRows: this.changes });
            }
        });
    });
}

// Função para log de atividades de arquivos
function logFileActivity(arquivoId, action, userId) {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT INTO arquivo_logs (arquivo_id, action, user_id)
            VALUES (?, ?, ?)
        `;
        
        db.run(sql, [arquivoId, action, userId], function(err) {
            if (err) {
                console.error(`❌ Erro ao logar atividade para arquivo ${arquivoId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Atividade logada para arquivo ${arquivoId}: ${action}`);
                resolve({ id: this.lastID });
            }
        });
    });
}

// Remover logs de um arquivo específico (para permitir exclusão do arquivo sem violar FK)
function deleteFileLogs(fileId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM arquivo_logs WHERE arquivo_id = ?`;
        db.run(sql, [fileId], function(err) {
            if (err) {
                console.error(`❌ Erro ao deletar logs do arquivo ${fileId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`🗑️ ${this.changes} logs removidos para arquivo ${fileId}`);
                resolve({ deletedRows: this.changes });
            }
        });
    });
}

// Função para buscar usuário por email
function getUserByEmail(email) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM usuarios WHERE email = ?`;
        db.get(sql, [email], (err, row) => {
            if (err) {
                console.error(`❌ Erro ao buscar usuário por email (${email}): ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Usuário encontrado: ${row ? row.email : 'Nenhum usuário'}`);
                resolve(row);
            }
        });
    });
}

// Função para buscar todos os usuários
function getAllUsers() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM usuarios ORDER BY nome_completo`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(`❌ Erro ao buscar todos os usuários: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Encontrados ${rows.length} usuários`);
                resolve(rows);
            }
        });
    });
}

// Função para buscar usuário por UID
function getUserByUid(uid) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM usuarios WHERE uid = ?`;
        db.get(sql, [uid], (err, row) => {
            if (err) {
                console.error(`❌ Erro ao buscar usuário por UID (${uid}): ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Usuário encontrado: ${row ? row.email : 'Nenhum usuário'}`);
                resolve(row);
            }
        });
    });
}

// Função para inserir ou atualizar usuário
function upsertUser(userData) {
    return new Promise((resolve, reject) => {
        const { uid, nomeCompleto, email, password, cargo = 'usuario' } = userData;
        
        const sql = `
            INSERT OR REPLACE INTO usuarios (uid, nome_completo, email, password, cargo, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(sql, [uid, nomeCompleto, email, password, cargo], function(err) {
            if (err) {
                console.error(`❌ Erro ao inserir/atualizar usuário ${email}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Usuário ${email} inserido/atualizado com sucesso`);
                resolve({ uid, nomeCompleto, email, cargo });
            }
        });
    });
}

// Função para deletar usuário
function deleteUser(uid) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM usuarios WHERE uid = ?`;
        db.run(sql, [uid], function(err) {
            if (err) {
                console.error(`❌ Erro ao deletar usuário ${uid}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Usuário ${uid} deletado`);
                resolve({ deletedRows: this.changes });
            }
        });
    });
}

// Função para buscar tarefa por ID
function getTaskById(taskId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM tarefas WHERE id = ?`;
        db.get(sql, [taskId], (err, row) => {
            if (err) {
                console.error(`❌ Erro ao buscar tarefa ${taskId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Tarefa encontrada: ${row ? row.titulo : 'Nenhuma tarefa'}`);
                resolve(row);
            }
        });
    });
}

// Função para buscar todas as tarefas
function getAllTasks() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM tarefas ORDER BY data_criacao DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(`❌ Erro ao buscar todas as tarefas: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Encontradas ${rows.length} tarefas`);
                resolve(rows);
            }
        });
    });
}

// Função para buscar tarefas por usuário
function getTasksByUser(userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM tarefas WHERE responsavel_id = ? ORDER BY data_criacao DESC`;
        db.all(sql, [userId], (err, rows) => {
            if (err) {
                console.error(`❌ Erro ao buscar tarefas para usuário ${userId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Encontradas ${rows.length} tarefas para usuário ${userId}`);
                resolve(rows);
            }
        });
    });
}

// Função para atualizar status da tarefa
function updateTaskStatus(taskId, status) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE tarefas SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        db.run(sql, [status, taskId], function(err) {
            if (err) {
                console.error(`❌ Erro ao atualizar status da tarefa ${taskId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Status da tarefa ${taskId} atualizado para ${status}`);
                resolve({ taskId, status, updatedRows: this.changes });
            }
        });
    });
}

// Função para atualizar tarefa completa
function updateTask(taskId, taskData) {
    return new Promise((resolve, reject) => {
        const { titulo, responsavel, responsavelId, dataVencimento, observacoes, recorrente, frequencia } = taskData;
        
        const sql = `
            UPDATE tarefas SET 
                titulo = ?,
                responsavel = ?,
                responsavel_id = ?,
                data_vencimento = ?,
                observacoes = ?,
                recorrente = ?,
                frequencia = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        db.run(sql, [titulo, responsavel, responsavelId, dataVencimento, observacoes, recorrente, frequencia, taskId], function(err) {
            if (err) {
                console.error(`❌ Erro ao atualizar tarefa ${taskId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Tarefa ${taskId} atualizada`);
                resolve({ taskId, updatedRows: this.changes });
            }
        });
    });
}

// Função para deletar tarefa com exclusão em cascata
function deleteTask(taskId) {
    return new Promise((resolve, reject) => {
        console.log(`🗑️ Iniciando exclusão da tarefa ${taskId} com dependências...`);
        
        db.serialize(() => {
            // Iniciar transação (e adiar checagens de FK até o commit)
            db.run('PRAGMA defer_foreign_keys = ON');
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
                if (err) {
                    console.error(`❌ Erro ao iniciar transação: ${err.message}`);
                    return reject(err);
                }
                
                // 1. Buscar arquivos da tarefa para deletar fisicamente
                db.all('SELECT * FROM arquivos WHERE task_id = ?', [taskId], (errFiles, files) => {
                    if (errFiles) {
                        console.error(`❌ [STEP files-select] ${errFiles.message}`);
                        db.run('ROLLBACK');
                        return reject(new Error(`[files-select] ${errFiles.message}`));
                    }
                    
                    console.log(`📁 Encontrados ${files.length} arquivos para deletar`);
                    
                    // Deletar arquivos físicos
                    files.forEach(file => {
                        try {
                            if (fs.existsSync(file.file_path)) {
                                fs.unlinkSync(file.file_path);
                                console.log(`🗑️ Arquivo físico deletado: ${file.original_name}`);
                            }
                        } catch (fsErr) {
                            console.warn(`⚠️ Erro ao deletar arquivo físico ${file.original_name}: ${fsErr.message}`);
                            // Não interrompe a operação por erro de arquivo físico
                        }
                    });

                    // 2. Deletar logs de atividade da tarefa (referenciam tarefas)
                    db.run('DELETE FROM atividade_logs WHERE task_id = ?', [taskId], function(errAlog) {
                        if (errAlog) {
                            console.error(`❌ [STEP atividade_logs-delete] ${errAlog.message}`);
                            db.run('ROLLBACK');
                            return reject(new Error(`[atividade_logs-delete] ${errAlog.message}`));
                        }
                        console.log(`🗑️ ${this.changes} atividade_logs deletados`);

                        // 3. Deletar logs de arquivos relacionados à tarefa (referenciam arquivos)
                        db.run(`
                            DELETE FROM arquivo_logs 
                            WHERE arquivo_id IN (
                                SELECT id FROM arquivos WHERE task_id = ?
                            )
                        `, [taskId], function(errFlog) {
                            if (errFlog) {
                                console.error(`❌ [STEP arquivo_logs-delete] ${errFlog.message}`);
                                db.run('ROLLBACK');
                                return reject(new Error(`[arquivo_logs-delete] ${errFlog.message}`));
                            }
                            console.log(`🗑️ ${this.changes} arquivo_logs deletados`);

                            // 4. Deletar arquivos da tarefa (filhos diretos)
                            db.run('DELETE FROM arquivos WHERE task_id = ?', [taskId], function(errFilesDel) {
                                if (errFilesDel) {
                                    console.error(`❌ [STEP arquivos-delete] ${errFilesDel.message}`);
                                    db.run('ROLLBACK');
                                    return reject(new Error(`[arquivos-delete] ${errFilesDel.message}`));
                                }
                                console.log(`🗑️ ${this.changes} arquivos deletados do banco`);

                                // 5. Finalmente, deletar a tarefa (pai)
                                db.run('DELETE FROM tarefas WHERE id = ?', [taskId], function(errTaskDel) {
                                    if (errTaskDel) {
                                        console.error(`❌ [STEP tarefas-delete] ${errTaskDel.message}`);
                                        db.run('ROLLBACK');
                                        return reject(new Error(`[tarefas-delete] ${errTaskDel.message}`));
                                    }

                                    // Confirmar transação
                                    db.run('COMMIT', (errCommit) => {
                                        if (errCommit) {
                                            console.error(`❌ [STEP commit] ${errCommit.message}`);
                                            return reject(new Error(`[commit] ${errCommit.message}`));
                                        }
                                        
                                        console.log(`✅ Tarefa ${taskId} e todas suas dependências (${files.length} arquivos) deletadas com sucesso!`);
                                        resolve({ deletedRows: this.changes, deletedFiles: files.length });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// Função para verificar dependências de uma tarefa antes da exclusão
function checkTaskDependencies(taskId) {
    return new Promise((resolve, reject) => {
        console.log(`🔍 Verificando dependências da tarefa ${taskId}...`);
        
        const dependencies = {
            arquivos: 0,
            arquivo_logs: 0,
            atividade_logs: 0
        };
        
        // Contar arquivos
        db.get('SELECT COUNT(*) as count FROM arquivos WHERE task_id = ?', [taskId], (err1, result1) => {
            if (err1) {
                return reject(err1);
            }
            dependencies.arquivos = result1.count;
            
            // Contar logs de arquivos
            db.get(`
                SELECT COUNT(*) as count FROM arquivo_logs 
                WHERE arquivo_id IN (SELECT id FROM arquivos WHERE task_id = ?)
            `, [taskId], (err2, result2) => {
                if (err2) {
                    return reject(err2);
                }
                dependencies.arquivo_logs = result2.count;
                
                // Contar logs de atividade
                db.get('SELECT COUNT(*) as count FROM atividade_logs WHERE task_id = ?', [taskId], (err3, result3) => {
                    if (err3) {
                        return reject(err3);
                    }
                    dependencies.atividade_logs = result3.count;
                    
                    console.log(`📊 Dependências da tarefa ${taskId}:`, dependencies);
                    resolve(dependencies);
                });
            });
        });
    });
}

// Função para inserir log de atividade
function insertActivityLog(logData) {
    return new Promise((resolve, reject) => {
        const { userId, userEmail, action, taskId, taskTitle } = logData;
        
        const sql = `
            INSERT INTO atividade_logs (user_id, user_email, action, task_id, task_title)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        db.run(sql, [userId, userEmail, action, taskId, taskTitle], function(err) {
            if (err) {
                console.error(`❌ Erro ao logar atividade: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Atividade logada: ${action} (Task: ${taskTitle || 'N/A'})`);
                resolve({
                    id: this.lastID,
                    userId,
                    userEmail,
                    action,
                    taskId,
                    taskTitle
                });
            }
        });
    });
}

// Função para buscar logs de atividade
function getActivityLogs(userId = null, limit = 100) {
    return new Promise((resolve, reject) => {
        let sql, params;
        if (userId) {
            sql = `SELECT * FROM atividade_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`;
            params = [userId, limit];
        } else {
            sql = `SELECT * FROM atividade_logs ORDER BY timestamp DESC LIMIT ?`;
            params = [limit];
        }
        
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error(`❌ Erro ao buscar logs de atividade: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Encontrados ${rows.length} logs de atividade`);
                resolve(rows);
            }
        });
    });
}

// ============================================================================
// FUNÇÕES RPA DOMÍNIO - Comparações
// ============================================================================

function createComparacao(comparacaoData) {
  return new Promise((resolve, reject) => {
    const {
      periodo_inicio,
      periodo_fim,
      source_type = 'OTIMIZA_TXT',
      bank_source_type = 'CSV',
      input_files = null,
      status = 'pendente'
    } = comparacaoData;

    const sql = `
      INSERT INTO comparacoes (periodo_inicio, periodo_fim, source_type, bank_source_type, input_files, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const inputFilesJson = input_files ? JSON.stringify(input_files) : null;

    db.run(sql, [periodo_inicio, periodo_fim, source_type, bank_source_type, inputFilesJson, status], function(err) {
      if (err) {
        console.error('❌ Erro ao criar comparação:', err.message);
        reject(err);
      } else {
        console.log(`✅ Comparação criada com sucesso (ID: ${this.lastID})`);
        resolve({ id: this.lastID, ...comparacaoData });
      }
    });
  });
}

function getComparacaoById(id) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM comparacoes WHERE id = ?`;
    db.get(sql, [id], (err, row) => {
      if (err) {
        console.error('❌ Erro ao buscar comparação:', err.message);
        reject(err);
      } else if (!row) {
        resolve(null);
      } else {
        // Parse JSON fields
        if (row.input_files) {
          try {
            row.input_files = JSON.parse(row.input_files);
          } catch (e) {
            row.input_files = null;
          }
        }
        if (row.parsing_issues) {
          try {
            row.parsing_issues = JSON.parse(row.parsing_issues);
          } catch (e) {
            row.parsing_issues = null;
          }
        }
        resolve(row);
      }
    });
  });
}

function listComparacoes(skip = 0, limit = 100) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM comparacoes 
      ORDER BY criado_em DESC 
      LIMIT ? OFFSET ?
    `;
    db.all(sql, [limit, skip], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao listar comparações:', err.message);
        reject(err);
      } else {
        // Parse JSON fields
        rows.forEach(row => {
          if (row.input_files) {
            try {
              row.input_files = JSON.parse(row.input_files);
            } catch (e) {
              row.input_files = null;
            }
          }
          if (row.parsing_issues) {
            try {
              row.parsing_issues = JSON.parse(row.parsing_issues);
            } catch (e) {
              row.parsing_issues = null;
            }
          }
        });
        resolve(rows);
      }
    });
  });
}

function updateComparacaoStatus(id, status, erro = null, stats = {}) {
  return new Promise((resolve, reject) => {
    const updates = [];
    const params = [];

    updates.push('status = ?');
    params.push(status);

    if (erro !== null) {
      updates.push('erro = ?');
      params.push(erro);
    }

    if (stats.started_at) {
      updates.push('started_at = ?');
      params.push(stats.started_at);
    }

    if (stats.finished_at) {
      updates.push('finished_at = ?');
      params.push(stats.finished_at);
    }

    if (stats.qtd_lancamentos_extrato !== undefined) {
      updates.push('qtd_lancamentos_extrato = ?');
      params.push(stats.qtd_lancamentos_extrato);
    }

    if (stats.qtd_lancamentos_razao !== undefined) {
      updates.push('qtd_lancamentos_razao = ?');
      params.push(stats.qtd_lancamentos_razao);
    }

    if (stats.qtd_divergencias !== undefined) {
      updates.push('qtd_divergencias = ?');
      params.push(stats.qtd_divergencias);
    }

    if (stats.parsing_issues) {
      updates.push('parsing_issues = ?');
      params.push(JSON.stringify(stats.parsing_issues));
    }

    params.push(id);

    const sql = `UPDATE comparacoes SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Erro ao atualizar comparação:', err.message);
        reject(err);
      } else {
        console.log(`✅ Comparação ${id} atualizada`);
        resolve({ id, changes: this.changes });
      }
    });
  });
}

function deleteComparacao(id) {
  return new Promise((resolve, reject) => {
    // CASCADE vai deletar divergencias e validation_results automaticamente
    const sql = `DELETE FROM comparacoes WHERE id = ?`;
    db.run(sql, [id], function(err) {
      if (err) {
        console.error('❌ Erro ao deletar comparação:', err.message);
        reject(err);
      } else {
        console.log(`✅ Comparação ${id} deletada`);
        resolve({ id, deletedRows: this.changes });
      }
    });
  });
}

// ============================================================================
// FUNÇÕES RPA DOMÍNIO - Divergências
// ============================================================================

function createDivergencia(divergenciaData) {
  return new Promise((resolve, reject) => {
    const {
      comparacao_id,
      tipo,
      descricao,
      data_extrato,
      descricao_extrato,
      valor_extrato,
      documento_extrato,
      conta_contabil_extrato,
      data_dominio,
      descricao_dominio,
      valor_dominio,
      documento_dominio,
      conta_contabil_dominio
    } = divergenciaData;

    const sql = `
      INSERT INTO divergencias (
        comparacao_id, tipo, descricao,
        data_extrato, descricao_extrato, valor_extrato, documento_extrato, conta_contabil_extrato,
        data_dominio, descricao_dominio, valor_dominio, documento_dominio, conta_contabil_dominio
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      comparacao_id, tipo, descricao,
      data_extrato, descricao_extrato, valor_extrato, documento_extrato, conta_contabil_extrato,
      data_dominio, descricao_dominio, valor_dominio, documento_dominio, conta_contabil_dominio
    ], function(err) {
      if (err) {
        console.error('❌ Erro ao criar divergência:', err.message);
        reject(err);
      } else {
        resolve({ id: this.lastID, ...divergenciaData });
      }
    });
  });
}

function getDivergenciasByComparacaoId(comparacaoId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM divergencias WHERE comparacao_id = ? ORDER BY id`;
    db.all(sql, [comparacaoId], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao buscar divergências:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function deleteDivergenciasByComparacaoId(comparacaoId) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM divergencias WHERE comparacao_id = ?`;
    db.run(sql, [comparacaoId], function(err) {
      if (err) {
        console.error('❌ Erro ao deletar divergências:', err.message);
        reject(err);
      } else {
        resolve({ deletedRows: this.changes });
      }
    });
  });
}

// ============================================================================
// FUNÇÕES RPA DOMÍNIO - Plano de Contas
// ============================================================================

function upsertChartOfAccount(accountData) {
  return new Promise((resolve, reject) => {
    const {
      source = 'dominio',
      account_code,
      account_name,
      account_level,
      parent_code,
      account_type,
      nature,
      is_active = true
    } = accountData;

    // Verifica se já existe
    const checkSql = `SELECT id FROM chart_of_accounts WHERE source = ? AND account_code = ?`;
    db.get(checkSql, [source, account_code], (err, existing) => {
      if (err) {
        console.error('❌ Erro ao verificar conta:', err.message);
        return reject(err);
      }

      if (existing) {
        // Update
        const updateSql = `
          UPDATE chart_of_accounts 
          SET account_name = ?, account_level = ?, parent_code = ?, 
              account_type = ?, nature = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE source = ? AND account_code = ?
        `;
        db.run(updateSql, [
          account_name, account_level, parent_code, account_type, nature, is_active,
          source, account_code
        ], function(updateErr) {
          if (updateErr) {
            console.error('❌ Erro ao atualizar conta:', updateErr.message);
            reject(updateErr);
          } else {
            resolve({ id: existing.id, ...accountData, updated: true });
          }
        });
      } else {
        // Insert
        const insertSql = `
          INSERT INTO chart_of_accounts 
          (source, account_code, account_name, account_level, parent_code, account_type, nature, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(insertSql, [
          source, account_code, account_name, account_level, parent_code, account_type, nature, is_active
        ], function(insertErr) {
          if (insertErr) {
            console.error('❌ Erro ao inserir conta:', insertErr.message);
            reject(insertErr);
          } else {
            resolve({ id: this.lastID, ...accountData, updated: false });
          }
        });
      }
    });
  });
}

function getChartOfAccounts(source = null) {
  return new Promise((resolve, reject) => {
    let sql, params;
    if (source) {
      sql = `SELECT * FROM chart_of_accounts WHERE source = ? ORDER BY account_code`;
      params = [source];
    } else {
      sql = `SELECT * FROM chart_of_accounts ORDER BY source, account_code`;
      params = [];
    }

    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('❌ Erro ao buscar plano de contas:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function deleteChartOfAccountsBySource(source) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM chart_of_accounts WHERE source = ?`;
    db.run(sql, [source], function(err) {
      if (err) {
        console.error('❌ Erro ao deletar plano de contas:', err.message);
        reject(err);
      } else {
        resolve({ deletedRows: this.changes });
      }
    });
  });
}

// ============================================================================
// FUNÇÕES RPA DOMÍNIO - Validação de Contas
// ============================================================================

function createAccountValidationResult(resultData) {
  return new Promise((resolve, reject) => {
    const {
      comparacao_id,
      lancamento_key,
      account_code,
      status,
      reason_code,
      message,
      expected = null,
      meta = null
    } = resultData;

    const sql = `
      INSERT INTO account_validation_results 
      (comparacao_id, lancamento_key, account_code, status, reason_code, message, expected, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const expectedJson = expected ? JSON.stringify(expected) : null;
    const metaJson = meta ? JSON.stringify(meta) : null;

    db.run(sql, [
      comparacao_id, lancamento_key, account_code, status, reason_code, message, expectedJson, metaJson
    ], function(err) {
      if (err) {
        console.error('❌ Erro ao criar resultado de validação:', err.message);
        reject(err);
      } else {
        resolve({ id: this.lastID, ...resultData });
      }
    });
  });
}

function getAccountValidationResultsByComparacaoId(comparacaoId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM account_validation_results WHERE comparacao_id = ?`;
    db.all(sql, [comparacaoId], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao buscar resultados de validação:', err.message);
        reject(err);
      } else {
        // Parse JSON fields
        rows.forEach(row => {
          if (row.expected) {
            try {
              row.expected = JSON.parse(row.expected);
            } catch (e) {
              row.expected = null;
            }
          }
          if (row.meta) {
            try {
              row.meta = JSON.parse(row.meta);
            } catch (e) {
              row.meta = null;
            }
          }
        });
        resolve(rows);
      }
    });
  });
}

function deleteAccountValidationResultsByComparacaoId(comparacaoId) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM account_validation_results WHERE comparacao_id = ?`;
    db.run(sql, [comparacaoId], function(err) {
      if (err) {
        console.error('❌ Erro ao deletar resultados de validação:', err.message);
        reject(err);
      } else {
        resolve({ deletedRows: this.changes });
      }
    });
  });
}

module.exports = {
    db,
    dbPath,
    uploadsDir,
    insertFile,
    getFilesByTaskId,
    getFileById,
    deleteFile,
    incrementDownloadCount,
    logFileActivity,
    deleteFileLogs,
    upsertUser,
    getUserByUid,
    getUserByEmail,
    getAllUsers,
    deleteUser,
    createTask,
    getTaskById,
    getAllTasks,
    getTasksByUser,
    updateTaskStatus,
    updateTask,
    deleteTask,
    checkTaskDependencies,
    insertActivityLog,
    getActivityLog: getActivityLogs,
    checkTaskExists,
    // RPA Domínio - Comparações
    createComparacao,
    getComparacaoById,
    listComparacoes,
    updateComparacaoStatus,
    deleteComparacao,
    // RPA Domínio - Divergências
    createDivergencia,
    getDivergenciasByComparacaoId,
    deleteDivergenciasByComparacaoId,
    // RPA Domínio - Plano de Contas
    upsertChartOfAccount,
    getChartOfAccounts,
    deleteChartOfAccountsBySource,
    // RPA Domínio - Validação
    createAccountValidationResult,
    getAccountValidationResultsByComparacaoId,
    deleteAccountValidationResultsByComparacaoId
  };
  
