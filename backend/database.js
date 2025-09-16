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
                reject(err);
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

// Função para deletar tarefa
function deleteTask(taskId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM tarefas WHERE id = ?`;
        db.run(sql, [taskId], function(err) {
            if (err) {
                console.error(`❌ Erro ao deletar tarefa ${taskId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`✅ Tarefa ${taskId} deletada`);
                resolve({ deletedRows: this.changes });
            }
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

module.exports = {
    db,
    dbPath,          // <--- opcional
    uploadsDir,
    insertFile,
    getFilesByTaskId,
    getFileById,
    deleteFile,
    incrementDownloadCount,
    logFileActivity,
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
    insertActivityLog,
    getActivityLog: getActivityLogs,
    checkTaskExists
  };
  
