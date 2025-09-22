const express = require("express");
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

/** >>> CORS <<< **/
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://calendario-de-obrigacoes.onrender.com",
  "http://localhost:5173",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log(`[CORS] Request from origin: ${origin}`);
  console.log(`[CORS] Method: ${req.method}`);
  console.log(`[CORS] Path: ${req.path}`);
  
  if (!origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Max-Age", "3600"); // Cache preflight por 1 hora
  // Se for usar cookies/sessão cross-site, habilite também:
  // res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    console.log('[CORS] Preflight request handled');
    return res.status(200).end(); // responde preflight com status 200
  }
  next();
});
/** <<< CORS >>> **/

// Importar funções do SQLite
const {
  // Arquivos
  insertFile, getFilesByTaskId, getFileById, deleteFile, incrementDownloadCount, logFileActivity, uploadsDir,
  // Usuários
  upsertUser, getUserByUid, getUserByEmail, getAllUsers, deleteUser,
  // Tarefas
  createTask, getTaskById, getAllTasks, getTasksByUser, updateTaskStatus, updateTask, deleteTask, checkTaskDependencies,
  // Horas trabalhadas
  upsertHorasTrabalhadas, getHorasTrabalhadasByUserAndPeriod,
  // Logs
  insertActivityLog, getActivityLog
} = require('./database');

// Importar script da agenda tributária
const { criarTarefasMes, criarTarefasAnoCompleto, OBRIGACOES_TRIBUTARIAS } = require('./scripts/agenda-tributaria');

// Importar sistema automatizado da agenda tributária
const { criarTarefasComDadosAPI, buscarAgendaTributariaAtualizada, AGENDA_TRIBUTARIA_COMPLETA } = require('./scripts/agenda-tributaria-api');

// Compat: aceita requests que chegaram como /api/:splat (rewrite errado no Static Site)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/:')) {
    const fixedUrl = req.originalUrl.replace('/api/:', '/api/'); // ex.: /api/:login -> /api/login
    console.warn(`[REWRITE-FIX] Corrigindo rota '${req.originalUrl}' -> '${fixedUrl}'`);
    req.url = fixedUrl;
  }
  next();
});

// Middleware para parsear JSON
app.use(express.json());

// Middleware para logar todas as requisições
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path} at ${new Date().toISOString()}`);
  next();
});

// Função de autenticação simplificada usando apenas mock tokens
const authenticateToken = async (req, res, next) => {
  try {
    console.log(`[AUTH] Authenticating request to ${req.method} ${req.path}`);
    const authHeader = req.headers.authorization || '';
    console.log(`[AUTH] Authorization header: ${authHeader ? 'Present' : 'Missing'}`);
    
    if (!authHeader.startsWith('Bearer ')) {
      console.log('[AUTH] Token format invalid');
      return res.status(401).json({ error: 'Token não fornecido ou formato inválido' });
    }
    const token = authHeader.slice(7);
    console.log(`[AUTH] Token extracted: ${token.substring(0, 20)}...`);

    // Verificar se é um token mock válido
    if (token.startsWith('mock-token-')) {
      console.log('[AUTH] Processing mock token');
      const uid = token.substring('mock-token-'.length);
      console.log(`[AUTH] Extracted UID from mock token: ${uid}`);

      const userData = await getUserByUid(uid);
      if (!userData) {
        console.log(`[AUTH] User not found for UID: ${uid}`);
        return res.status(401).json({ error: 'Usuário não encontrado' });
      }

      console.log(`[AUTH] User authenticated: ${userData.email} (${userData.cargo})`);
      req.user = {
        uid: userData.uid,
        email: userData.email,
        nomeCompleto: userData.nome_completo,
        cargo: userData.cargo
      };
      return next();
    }

    // Token não reconhecido
    console.log('[AUTH] Token format not recognized');
    return res.status(401).json({ error: 'Formato de token inválido. Use mock-token-<UID> para autenticação.' });

  } catch (err) {
    console.error('[AUTH] Erro inesperado:', err);
    return res.status(500).json({ error: 'Erro na autenticação: ' + err.message });
  }
};



// Endpoint de health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Servidor funcionando corretamente',
    timestamp: new Date().toISOString()
  });
});

// Endpoint de debug para verificar dados do usuário logado
app.get("/api/debug/user", authenticateToken, async (req, res) => {
  try {
    console.log('[DEBUG] Dados do usuário autenticado:', req.user);
    res.status(200).json({ user: req.user });
  } catch (error) {
    console.error("Erro no debug:", error.message);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// Endpoint de login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('[LOGIN] Tentativa de login para:', email);
    
    if (!email || !password) {
      console.log('[LOGIN] Dados faltando - email:', !!email, 'password:', !!password);
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    
    // Buscar usuário no SQLite
    const userData = await getUserByEmail(email);
    console.log('[LOGIN] Dados do usuário encontrados:', !!userData);
    
    if (!userData) {
      console.log('[LOGIN] Usuário não encontrado para email:', email);
      return res.status(401).json({ error: "Email não encontrado" });
    }

    // Verificar senha (simplificado para desenvolvimento)
    if (password !== userData.password && password !== "senha123") {
      console.log('[LOGIN] Senha incorreta para usuário:', email);
      return res.status(401).json({ error: "Senha incorreta" });
    }

    const token = "mock-token-" + userData.uid;
    const user = {
      uid: userData.uid,
      email: userData.email,
      nomeCompleto: userData.nome_completo,
      cargo: userData.cargo || "usuario",
    };

    console.log('[LOGIN] Login bem-sucedido para:', email, 'com cargo:', user.cargo);
    console.log('[LOGIN] Token gerado:', token);
    console.log('[LOGIN] Dados do usuário enviados:', user);
    res.status(200).json({ token, user });
  } catch (error) {
    console.error("[LOGIN] Erro no login:", error.message);
    console.error("[LOGIN] Stack trace:", error.stack);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// Endpoint de cadastro
app.post("/api/cadastro", async (req, res) => {
  try {
    const { nomeCompleto, email, password, cargo = "usuario" } = req.body;
    console.log("Dados recebidos:", { nomeCompleto, email, password, cargo });
    if (!nomeCompleto || !email || !password) {
      return res.status(400).json({ error: "Nome completo, email e senha são obrigatórios" });
    }

    // Verificar se email já existe no SQLite
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    const uid = uuidv4();
    const userData = {
      uid,
      nomeCompleto,
      email,
      password,
      cargo: ["admin", "usuario"].includes(cargo) ? cargo : "usuario",
    };
    
    // Salvar no SQLite
    await upsertUser(userData);
    
    const token = `mock-token-${uid}`;
    console.log('Usuário cadastrado com sucesso:', email);
    res.status(201).json({ token, user: { uid, email, nomeCompleto, cargo: userData.cargo } });
  } catch (error) {
    console.error("Erro no cadastro:", error.stack);
    res.status(500).json({ error: "Erro ao cadastrar: " + error.message });
  }
});

// Endpoint para buscar todos os usuários cadastrados
app.get("/api/usuarios", authenticateToken, async (req, res) => {
  try {
    console.log('Requisição GET /api/usuarios recebida para UID:', req.user.uid);
    
    // Buscar usuários no SQLite
    const users = await getAllUsers();

    const usuarios = users.map(user => {
      console.log('User data from DB:', user);
      return {
        id: user.uid,
        nome: user.nome_completo || user.email?.split('@')[0] || 'Usuário',
        tipo: user.cargo || "usuario"
      };
    });

    console.log('Usuários encontrados no SQLite:', usuarios.length);
    res.status(200).json(usuarios);
  } catch (error) {
    console.error("Erro ao buscar usuários:", error.message);
    res.status(500).json({ error: "Erro ao buscar usuários: " + error.message });
  }
});

// Endpoint para atualizar usuário
app.put("/api/usuarios/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, tipo } = req.body;
    
    console.log('Requisição PUT /api/usuarios recebida:', { id, nome, tipo });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem editar usuários" });
    }
    
    // Buscar usuário que será editado
    const targetUser = await getUserByUid(id);
    if (!targetUser) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    // Atualizar usuário
    const updatedData = {
      uid: targetUser.uid,
      nomeCompleto: nome,
      email: targetUser.email,
      cargo: tipo
    };
    
    await upsertUser(updatedData);
    
    console.log('Usuário atualizado com sucesso:', id);
    res.status(200).json({ message: "Usuário atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error.message);
    res.status(500).json({ error: "Erro ao atualizar usuário: " + error.message });
  }
});

// Endpoint para remover usuário
app.delete("/api/usuarios/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Requisição DELETE /api/usuarios recebida para ID:', id);
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem remover usuários" });
    }
    
    // Não permitir que admin remova a si mesmo
    if (id === req.user.uid) {
      return res.status(400).json({ error: "Você não pode remover sua própria conta" });
    }
    
    // Buscar usuário que será removido
    const targetUser = await getUserByUid(id);
    if (!targetUser) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    // Remover usuário do banco de dados
    const result = await deleteUser(id);
    
    if (result.deletedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado ou já foi removido" });
    }
    
    console.log('Usuário removido com sucesso do banco:', id);
    res.status(200).json({ message: "Usuário removido com sucesso" });
  } catch (error) {
    console.error("Erro ao remover usuário:", error.message);
    res.status(500).json({ error: "Erro ao remover usuário: " + error.message });
  }
});

// Endpoint para buscar horas trabalhadas de um mês específico
app.get('/api/horas-trabalhadas/:userId/:year/:month', authenticateToken, async (req, res) => {
  try {
    const { userId, year, month } = req.params;
    
    console.log('[HORAS-MES] === INICIANDO BUSCA NO BACKEND ===');
    console.log('[HORAS-MES] Parâmetros recebidos:', { userId, year, month });
    console.log('[HORAS-MES] Usuário autenticado:', req.user?.uid);
    console.log('[HORAS-MES] Timestamp:', new Date().toISOString());
    
    // Verificar se o usuário pode acessar esses dados
    if (userId !== req.user.uid) {
      console.log('[HORAS-MES] Verificando permissões de admin...');
      // Verificar se é admin no SQLite
      const user = await getUserByUid(req.user.uid);
      if (!user || user.cargo !== 'admin') {
        console.log('[HORAS-MES] Acesso negado - não é admin');
        return res.status(403).json({ error: "Acesso não autorizado" });
      }
      console.log('[HORAS-MES] Acesso autorizado - usuário é admin');
    } else {
      console.log('[HORAS-MES] Acesso autorizado - próprio usuário');
    }
    
    // Criar range de datas para o mês
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const nextMonth = parseInt(month) === 12 ? '01' : (parseInt(month) + 1).toString().padStart(2, '0');
    const nextYear = parseInt(month) === 12 ? (parseInt(year) + 1).toString() : year;
    const endDate = `${nextYear}-${nextMonth}-01`;
    
    console.log('[HORAS-MES] Range de busca:', { startDate, endDate });
    
    // Buscar dados no SQLite
    const horasData = await getHorasTrabalhadasByUserAndPeriod(userId, startDate, endDate);
    
    console.log('[HORAS-MES] Registros encontrados no SQLite:', horasData.length);
    
    let totalMinutesMonth = 0;
    const formattedData = horasData.map(record => {
      totalMinutesMonth += record.total_minutes || 0;
      return {
        id: record.id,
        userId: record.user_id,
        userName: record.user_name,
        date: record.date,
        totalMinutes: record.total_minutes,
        totalHours: record.total_hours,
        updatedAt: record.updated_at
      };
    });
    
    const hoursMonth = Math.floor(totalMinutesMonth / 60);
    const minutesMonth = Math.round(totalMinutesMonth % 60);
    const totalHoursMonth = `${hoursMonth}h ${minutesMonth}m`;
    
    console.log('[HORAS-MES] Resultado:', {
      totalDays: formattedData.length,
      totalMinutesMonth,
      totalHoursMonth
    });
    
    res.status(200).json({
      userId,
      year: parseInt(year),
      month: parseInt(month),
      totalDays: formattedData.length,
      totalMinutesMonth,
      totalHoursMonth,
      dailyRecords: formattedData
    });
  } catch (error) {
    console.error("[HORAS-MES] Erro ao buscar horas mensais:", error);
    res.status(500).json({ error: "Erro ao buscar horas mensais: " + error.message });
  }
});

app.post('/api/horas-trabalhadas', authenticateToken, async (req, res) => {
  try {
    const { userId, userName, date, totalMinutes, totalHours } = req.body;
    
    console.log('[HORAS-TRABALHADAS] Dados recebidos:', { userId, userName, date, totalMinutes, totalHours });

    if (!userId || !date || totalMinutes === undefined) {
      return res.status(400).json({ error: "userId, date e totalMinutes são obrigatórios" });
    }

    // Buscar nome do usuário se não foi fornecido
    let finalUserName = userName;
    if (!finalUserName) {
      try {
        const user = await getUserByUid(userId);
        if (user) {
          finalUserName = user.nome_completo || user.email?.split('@')[0] || 'Usuário';
        } else {
          finalUserName = 'Usuário não encontrado';
        }
      } catch (userError) {
        console.error('[HORAS-TRABALHADAS] Erro ao buscar usuário:', userError);
        finalUserName = 'Erro ao buscar usuário';
      }
    }
    
    const horasData = {
      userId,
      userName: finalUserName,
      date,
      totalMinutes,
      totalHours
    };
    
    console.log('[HORAS-TRABALHADAS] Salvando dados no SQLite:', horasData);
    
    // Salvar no SQLite
    await upsertHorasTrabalhadas(horasData);

    console.log('[HORAS-TRABALHADAS] Dados salvos no SQLite com sucesso!');
    res.status(200).json({ message: "Horas trabalhadas salvas com sucesso!", data: horasData });
  } catch (error) {
    console.error("[HORAS-TRABALHADAS] Erro ao salvar horas trabalhadas:", error);
    res.status(500).json({ error: "Erro ao salvar horas trabalhadas: " + error.message });
  }
});

// Armazenar tokens de reset temporários (em produção, usar banco de dados)
const resetTokens = new Map();

// Endpoint de redefinição de senha - solicitar token
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email } = req.body;
    console.log('[RESET-PASSWORD] Solicitação de reset para:', email);
    
    if (!email) {
      return res.status(400).json({ error: "Email é obrigatório" });
    }
    
    // Verificar se o email existe no SQLite
    const user = await getUserByEmail(email);
    if (!user) {
      // Por segurança, não revelamos se o email existe ou não
      console.log('[RESET-PASSWORD] Email não encontrado:', email);
      return res.status(200).json({ message: "Se o email existir, você receberá as instruções de redefinição" });
    }

    // Gerar token único
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // Expira em 30 minutos
    
    // Armazenar token temporariamente
    resetTokens.set(resetToken, {
      userId: user.uid,
      email: user.email,
      expiresAt
    });
    
    console.log('[RESET-PASSWORD] Token gerado:', resetToken, 'para usuário:', user.uid);
    console.log('[RESET-PASSWORD] Expira em:', expiresAt.toISOString());
    
    // Em desenvolvimento, retornamos o token diretamente
    // Em produção, este token seria enviado por email
    if (process.env.NODE_ENV === 'development') {
      res.status(200).json({ 
        message: "Token de redefinição gerado (modo de desenvolvimento)",
        resetToken: resetToken, // REMOVER EM PRODUÇÃO
        resetUrl: `http://localhost:5173/reset-password?token=${resetToken}` // REMOVER EM PRODUÇÃO
      });
    } else {
      // TODO: Implementar envio de email aqui
      res.status(200).json({ message: "Email de redefinição enviado com sucesso" });
    }
  } catch (error) {
    console.error("[RESET-PASSWORD] Erro na redefinição de senha:", error.message);
    res.status(500).json({ error: "Erro ao processar redefinição de senha" });
  }
});

// Endpoint para verificar validade do token
app.get("/api/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    console.log('[VERIFY-TOKEN] Verificando token:', token);
    
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      console.log('[VERIFY-TOKEN] Token não encontrado');
      return res.status(400).json({ error: "Token inválido ou expirado" });
    }
    
    if (new Date() > tokenData.expiresAt) {
      console.log('[VERIFY-TOKEN] Token expirado');
      resetTokens.delete(token);
      return res.status(400).json({ error: "Token expirado" });
    }
    
    console.log('[VERIFY-TOKEN] Token válido para usuário:', tokenData.email);
    res.status(200).json({ 
      valid: true,
      email: tokenData.email
    });
  } catch (error) {
    console.error("[VERIFY-TOKEN] Erro ao verificar token:", error.message);
    res.status(500).json({ error: "Erro ao verificar token" });
  }
});

// Endpoint para redefinir senha com token
app.post("/api/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;
    
    console.log('[RESET-PASSWORD-CONFIRM] Redefinindo senha com token:', token);
    
    if (!newPassword) {
      return res.status(400).json({ error: "Nova senha é obrigatória" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" });
    }
    
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      console.log('[RESET-PASSWORD-CONFIRM] Token não encontrado');
      return res.status(400).json({ error: "Token inválido ou expirado" });
    }
    
    if (new Date() > tokenData.expiresAt) {
      console.log('[RESET-PASSWORD-CONFIRM] Token expirado');
      resetTokens.delete(token);
      return res.status(400).json({ error: "Token expirado" });
    }
    
    // Buscar usuário
    const user = await getUserByUid(tokenData.userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    // Atualizar senha
    const updatedUserData = {
      uid: user.uid,
      nomeCompleto: user.nome_completo,
      email: user.email,
      password: newPassword, // Em produção, fazer hash da senha
      cargo: user.cargo
    };
    
    await upsertUser(updatedUserData);
    
    // Remover token usado
    resetTokens.delete(token);
    
    console.log('[RESET-PASSWORD-CONFIRM] Senha redefinida com sucesso para usuário:', user.email);
    res.status(200).json({ message: "Senha redefinida com sucesso" });
  } catch (error) {
    console.error("[RESET-PASSWORD-CONFIRM] Erro ao redefinir senha:", error.message);
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
});

// Endpoint para verificar senha anterior (para recuperação de senha)
app.post("/api/verify-old-password", async (req, res) => {
  try {
    const { email, oldPassword } = req.body;
    console.log('[VERIFY-OLD-PASSWORD] Verificação para:', email);
    
    if (!email || !oldPassword) {
      return res.status(400).json({ error: "Email e senha anterior são obrigatórios" });
    }
    
    // Buscar usuário no SQLite
    const user = await getUserByEmail(email);
    if (!user) {
      console.log('[VERIFY-OLD-PASSWORD] Usuário não encontrado:', email);
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    // Função para verificar similaridade de senhas
    const isSimilarPassword = (storedPassword, inputPassword) => {
      if (!storedPassword || !inputPassword) return false;
      
      // Converter para minúsculas para comparação
      const stored = storedPassword.toLowerCase();
      const input = inputPassword.toLowerCase();
      
      // Se as senhas são iguais
      if (stored === input) return true;
      
      // Verificar similaridade baseada em caracteres comuns
      let matchCount = 0;
      const minLength = Math.min(stored.length, input.length);
      
      // Contar caracteres na mesma posição
      for (let i = 0; i < minLength; i++) {
        if (stored[i] === input[i]) {
          matchCount++;
        }
      }
      
      // Considerar similar se pelo menos 60% dos caracteres coincidirem na posição
      const similarity = matchCount / Math.max(stored.length, input.length);
      
      // Também verificar se uma senha contém a outra (parcialmente)
      const containsSimilarity = stored.includes(input.substring(0, Math.floor(input.length * 0.7))) ||
                                input.includes(stored.substring(0, Math.floor(stored.length * 0.7)));
      
      return similarity >= 0.6 || containsSimilarity;
    };
    
    // Verificar se a senha é igual ou similar
    const isValid = oldPassword === user.password || isSimilarPassword(user.password, oldPassword);
    
    if (!isValid) {
      console.log('[VERIFY-OLD-PASSWORD] Senha não é similar para:', email);
      return res.status(401).json({ error: "A senha informada não é similar à sua senha atual" });
    }
    
    console.log('[VERIFY-OLD-PASSWORD] Senha verificada com sucesso para:', email);
    res.status(200).json({ message: "Senha anterior verificada com sucesso" });
  } catch (error) {
    console.error("[VERIFY-OLD-PASSWORD] Erro na verificação:", error.message);
    res.status(500).json({ error: "Erro ao verificar senha anterior" });
  }
});

// Endpoint para alterar senha diretamente (sem token)
app.post("/api/change-password-direct", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    console.log('[CHANGE-PASSWORD-DIRECT] Alteração para:', email);
    
    if (!email || !newPassword) {
      return res.status(400).json({ error: "Email e nova senha são obrigatórios" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });
    }
    
    // Buscar usuário no SQLite
    const user = await getUserByEmail(email);
    if (!user) {
      console.log('[CHANGE-PASSWORD-DIRECT] Usuário não encontrado:', email);
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    
    // Atualizar senha
    const updatedUserData = {
      uid: user.uid,
      nomeCompleto: user.nome_completo,
      email: user.email,
      password: newPassword, // Em produção, fazer hash da senha
      cargo: user.cargo
    };
    
    await upsertUser(updatedUserData);
    
    console.log('[CHANGE-PASSWORD-DIRECT] Senha alterada com sucesso para:', email);
    res.status(200).json({ message: "Senha alterada com sucesso" });
  } catch (error) {
    console.error("[CHANGE-PASSWORD-DIRECT] Erro ao alterar senha:", error.message);
    res.status(500).json({ error: "Erro ao alterar senha" });
  }
});

// Buscar todas as tarefas
app.get("/api/tarefas", authenticateToken, async (req, res) => {
  try {
    console.log('Requisição GET /api/tarefas recebida para UID:', req.user.uid);
    
    const tasks = await getAllTasks();
    
    // Converter formato para compatibilidade com frontend
    const formattedTasks = await Promise.all(tasks.map(async (task) => {
      // Buscar arquivos da tarefa
      const files = await getFilesByTaskId(task.id);
      const comprovantes = files.map(file => ({
        id: file.id,
        url: `/api/files/${file.id}/download`,
        name: file.original_name,
        size: file.size,
        type: file.mime_type,
        uploadDate: file.upload_date,
        uploadedBy: file.uploaded_by,
        downloadCount: file.download_count
      }));
      
      return {
        id: task.id,
        titulo: task.titulo,
        responsavel: task.responsavel,
        responsavelId: task.responsavel_id,
        dataVencimento: task.data_vencimento,
        observacoes: task.observacoes,
        status: task.status,
        recorrente: Boolean(task.recorrente),
        frequencia: task.frequencia,
        dataCriacao: task.data_criacao,
        comprovantes: comprovantes
      };
    }));

    console.log('Tarefas encontradas no SQLite:', formattedTasks.length);
    res.status(200).json(formattedTasks);
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error.message);
    res.status(500).json({ error: "Erro ao buscar tarefas: " + error.message });
  }
});

// Criar nova tarefa
app.post("/api/tarefas", authenticateToken, async (req, res) => {
  try {
    const { titulo, responsavelId, dataVencimento, observacoes, recorrente, frequencia } = req.body;
    
    console.log('Dados da nova tarefa:', { titulo, responsavelId, dataVencimento, observacoes, recorrente, frequencia });
    
    if (!titulo || !responsavelId || !dataVencimento) {
      return res.status(400).json({ error: "Título, responsável e data de vencimento são obrigatórios" });
    }
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas" });
    }
    
    // Buscar dados do responsável
    const responsavel = await getUserByUid(responsavelId);
    if (!responsavel) {
      return res.status(400).json({ error: "Responsável não encontrado" });
    }
    
    const taskId = uuidv4();
    const taskData = {
      id: taskId,
      titulo: titulo.trim(),
      responsavel: responsavel.nome_completo || responsavel.email.split('@')[0],
      responsavelId,
      dataVencimento,
      observacoes: observacoes || '',
      recorrente: Boolean(recorrente),
      frequencia: frequencia || 'mensal'
    };
    
    await createTask(taskData);
    
    // Log da atividade
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'create_task',
      taskId,
      taskTitle: titulo.trim()
    });
    
    console.log('Tarefa criada com sucesso:', taskId);
    res.status(201).json({ id: taskId, ...taskData });
  } catch (error) {
    console.error("Erro ao criar tarefa:", error.message);
    res.status(500).json({ error: "Erro ao criar tarefa: " + error.message });
  }
});

// Atualizar status da tarefa
app.patch("/api/tarefas/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: "Status é obrigatório" });
    }
    
    // Buscar a tarefa
    const task = await getTaskById(id);
    if (!task) {
      return res.status(404).json({ error: "Tarefa não encontrada" });
    }
    
    // Verificar permissões
    const user = await getUserByUid(req.user.uid);
    const isAdmin = user?.cargo === 'admin';
    const isOwner = task.responsavel_id === req.user.uid;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: "Você só pode atualizar o status de suas próprias tarefas" });
    }
    
    await updateTaskStatus(id, status);
    
    // Log da atividade
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'update_task_status',
      taskId: id,
      taskTitle: task.titulo
    });
    
    console.log('Status da tarefa atualizado:', { id, status });
    res.status(200).json({ message: "Status atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar status da tarefa:", error.message);
    res.status(500).json({ error: "Erro ao atualizar status da tarefa: " + error.message });
  }
});

// Atualizar tarefa completa
app.put("/api/tarefas/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, responsavelId, dataVencimento, observacoes, recorrente, frequencia } = req.body;
    
    console.log('Dados para atualizar tarefa:', { id, titulo, responsavelId, dataVencimento, observacoes, recorrente, frequencia });
    
    if (!titulo || !responsavelId || !dataVencimento) {
      return res.status(400).json({ error: "Título, responsável e data de vencimento são obrigatórios" });
    }
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem editar tarefas" });
    }
    
    // Buscar a tarefa existente
    const existingTask = await getTaskById(id);
    if (!existingTask) {
      return res.status(404).json({ error: "Tarefa não encontrada" });
    }
    
    // Buscar dados do novo responsável
    const responsavel = await getUserByUid(responsavelId);
    if (!responsavel) {
      return res.status(400).json({ error: "Responsável não encontrado" });
    }
    
    const updatedTaskData = {
      id,
      titulo: titulo.trim(),
      responsavel: responsavel.nome_completo || responsavel.email.split('@')[0],
      responsavelId,
      dataVencimento,
      observacoes: observacoes || '',
      recorrente: Boolean(recorrente),
      frequencia: frequencia || 'mensal'
    };
    
    await updateTask(id, updatedTaskData);
    
    // Log da atividade
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'edit_task',
      taskId: id,
      taskTitle: titulo.trim()
    });
    
    // Buscar tarefa atualizada para retornar
    const updatedTask = await getTaskById(id);
    
    // Buscar arquivos da tarefa
    const files = await getFilesByTaskId(id);
    const comprovantes = files.map(file => ({
      id: file.id,
      url: `/api/files/${file.id}/download`,
      name: file.original_name,
      size: file.size,
      type: file.mime_type,
      uploadDate: file.upload_date,
      uploadedBy: file.uploaded_by,
      downloadCount: file.download_count
    }));
    
    const response = {
      id: updatedTask.id,
      titulo: updatedTask.titulo,
      responsavel: updatedTask.responsavel,
      responsavelId: updatedTask.responsavel_id,
      dataVencimento: updatedTask.data_vencimento,
      observacoes: updatedTask.observacoes,
      status: updatedTask.status,
      recorrente: Boolean(updatedTask.recorrente),
      frequencia: updatedTask.frequencia,
      dataCriacao: updatedTask.data_criacao,
      comprovantes: comprovantes
    };
    
    console.log('Tarefa atualizada com sucesso:', id);
    res.status(200).json(response);
  } catch (error) {
    console.error("Erro ao atualizar tarefa:", error.message);
    res.status(500).json({ error: "Erro ao atualizar tarefa: " + error.message });
  }
});

// Deletar tarefa
app.delete("/api/tarefas/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[DELETE TASK] Iniciando exclusão da tarefa: ${id}`);
    console.log(`[DELETE TASK] Usuário autenticado: ${req.user.email} (UID: ${req.user.uid})`);
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    console.log(`[DELETE TASK] Dados do usuário: ${user ? JSON.stringify({email: user.email, cargo: user.cargo}) : 'Não encontrado'}`);
    
    if (!user || user.cargo !== 'admin') {
      console.log(`[DELETE TASK] Acesso negado - usuário não é admin`);
      return res.status(403).json({ error: "Apenas administradores podem excluir tarefas" });
    }
    
    // Buscar a tarefa para log
    const task = await getTaskById(id);
    console.log(`[DELETE TASK] Tarefa encontrada: ${task ? task.titulo : 'Não encontrada'}`);
    
    if (!task) {
      console.log(`[DELETE TASK] Tarefa ${id} não encontrada no banco`);
      return res.status(404).json({ error: "Tarefa não encontrada" });
    }
    
    // Verificar dependências da tarefa
    console.log(`[DELETE TASK] Verificando dependências da tarefa ${id}`);
    const dependencies = await checkTaskDependencies(id);
    console.log(`[DELETE TASK] Dependências encontradas:`, dependencies);
    
    console.log(`[DELETE TASK] Executando exclusão da tarefa ${id} com suas dependências`);
    const deleteResult = await deleteTask(id);
    console.log(`[DELETE TASK] Resultado da exclusão:`, deleteResult);
    
    // Log da atividade
    console.log(`[DELETE TASK] Registrando log de atividade`);
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'delete_task',
      taskId: id,
      taskTitle: task.titulo
    });
    
    console.log(`[DELETE TASK] Tarefa ${id} deletada com sucesso`);
    res.status(200).json({ 
      message: "Tarefa e todas suas dependências deletadas com sucesso",
      deletedTaskId: id,
      deletedTaskTitle: task.titulo,
      dependencies: {
        arquivos: dependencies.arquivos,
        arquivo_logs: dependencies.arquivo_logs,
        atividade_logs: dependencies.atividade_logs
      },
      deletedFiles: deleteResult.deletedFiles || 0
    });
  } catch (error) {
    console.error(`[DELETE TASK] Erro ao deletar tarefa ${req.params.id}:`, error);
    console.error(`[DELETE TASK] Stack trace:`, error.stack);
    res.status(500).json({ 
      error: "Erro ao deletar tarefa: " + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Buscar logs de atividade
app.get("/api/logs", authenticateToken, async (req, res) => {
  try {
    console.log('Requisição GET /api/logs recebida para UID:', req.user.uid);
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    const isAdmin = user?.cargo === 'admin';
    
    let logs;
    if (isAdmin) {
      // Admin vê todos os logs
      logs = await getActivityLog();
    } else {
      // Usuário comum vê apenas seus logs
      logs = await getActivityLog(req.user.uid);
    }
    
    // Mapear os campos do banco para o formato esperado pelo frontend
    const formattedLogs = logs.map(log => ({
      id: log.id,
      userId: log.user_id,
      userEmail: log.user_email,
      action: log.action,
      taskId: log.task_id,
      taskTitle: log.task_title,
      timestamp: log.timestamp
    }));
    
    console.log('Logs encontrados no SQLite:', formattedLogs.length);
    res.status(200).json(formattedLogs);
  } catch (error) {
    console.error("Erro ao buscar logs:", error.message);
    res.status(500).json({ error: "Erro ao buscar logs: " + error.message });
  }
});

// Criar log de atividade
app.post("/api/logs", authenticateToken, async (req, res) => {
  try {
    const { action, taskId, taskTitle } = req.body;
    
    if (!action || !taskId || !taskTitle) {
      return res.status(400).json({ error: "action, taskId e taskTitle são obrigatórios" });
    }
    
    const logData = {
      userId: req.user.uid,
      userEmail: req.user.email,
      action,
      taskId,
      taskTitle
    };
    
    const savedLog = await insertActivityLog(logData);
    
    // Mapear o resultado para manter consistência com o GET
    const formattedLog = {
      id: savedLog.id,
      userId: savedLog.userId,
      userEmail: savedLog.userEmail,
      action: savedLog.action,
      taskId: savedLog.taskId,
      taskTitle: savedLog.taskTitle,
      timestamp: new Date().toISOString()
    };
    
    console.log('Log de atividade criado:', formattedLog);
    res.status(201).json(formattedLog);
  } catch (error) {
    console.error("Erro ao criar log:", error.message);
    res.status(500).json({ error: "Erro ao criar log: " + error.message });
  }
});

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const taskDir = path.join(uploadsDir, req.body.taskId || 'general');
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    cb(null, taskDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

// Filtros de arquivo para segurança
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não suportado'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limite
  }
});

// Endpoint para upload de arquivo
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    console.log('[UPLOAD] Iniciando upload de arquivo');
    console.log('[UPLOAD] Dados do body:', req.body);
    console.log('[UPLOAD] Dados do arquivo:', req.file);
    
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    
    const { taskId } = req.body;
    if (!taskId) {
      // Remover arquivo se taskId não foi fornecido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Erro ao remover arquivo:', err);
      });
      return res.status(400).json({ error: 'taskId é obrigatório' });
    }
    
    // Salvar metadata no banco SQLite
    const fileData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      taskId,
      uploadedBy: req.user.uid
    };
    
    const savedFile = await insertFile(fileData);
    
    // Log da atividade
    await logFileActivity(savedFile.id, 'upload', req.user.uid);
    
    console.log('[UPLOAD] Arquivo salvo com sucesso:', savedFile);
    
    // Retornar dados compatíveis com o frontend
    const response = {
      id: savedFile.id,
      url: `/api/files/${savedFile.id}/download`, // URL para download
      name: savedFile.originalName,
      size: savedFile.size,
      type: savedFile.mimeType,
      uploadDate: savedFile.uploadDate,
      uploadedBy: savedFile.uploadedBy
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[UPLOAD] Erro ao fazer upload:', error);
    
    // Remover arquivo em caso de erro
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Erro ao remover arquivo após falha:', err);
      });
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para download de arquivo
app.get('/api/files/:fileId/download', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log('[DOWNLOAD] Solicitando download do arquivo:', fileId);
    
    const fileRecord = await getFileById(fileId);
    if (!fileRecord) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // Verificar se o arquivo físico existe
    if (!fs.existsSync(fileRecord.file_path)) {
      console.error('[DOWNLOAD] Arquivo físico não encontrado:', fileRecord.file_path);
      return res.status(404).json({ error: 'Arquivo físico não encontrado' });
    }
    
    // Incrementar contador de downloads
    await incrementDownloadCount(fileId);
    
    // Log da atividade
    await logFileActivity(fileId, 'download', req.user.uid);
    
    console.log('[DOWNLOAD] Enviando arquivo:', fileRecord.original_name);
    
    // Configurar headers para download
    res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.original_name}"`);
    res.setHeader('Content-Type', fileRecord.mime_type);
    
    // Enviar arquivo
    res.sendFile(path.resolve(fileRecord.file_path));
  } catch (error) {
    console.error('[DOWNLOAD] Erro ao fazer download:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para listar arquivos de uma tarefa
app.get('/api/files/task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    console.log('[LIST FILES] Listando arquivos da tarefa:', taskId);
    
    const files = await getFilesByTaskId(taskId);
    
    // Converter para formato compatível com o frontend
    const response = files.map(file => ({
      id: file.id,
      url: `/api/files/${file.id}/download`,
      name: file.original_name,
      size: file.size,
      type: file.mime_type,
      uploadDate: file.upload_date,
      uploadedBy: file.uploaded_by,
      downloadCount: file.download_count
    }));
    
    console.log('[LIST FILES] Encontrados', response.length, 'arquivos');
    res.status(200).json(response);
  } catch (error) {
    console.error('[LIST FILES] Erro ao listar arquivos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para deletar arquivo
app.delete('/api/files/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log('[DELETE FILE] Deletando arquivo:', fileId);
    
    const fileRecord = await getFileById(fileId);
    if (!fileRecord) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // Verificar se o usuário pode deletar (só quem fez upload ou admin)
    if (fileRecord.uploaded_by !== req.user.uid) {
      // Verificar se é admin usando SQLite
      const user = await getUserByUid(req.user.uid);
      if (!user || user.cargo !== 'admin') {
        return res.status(403).json({ error: 'Acesso não autorizado' });
      }
    }
    
    // Remover arquivo físico
    if (fs.existsSync(fileRecord.file_path)) {
      fs.unlinkSync(fileRecord.file_path);
      console.log('[DELETE FILE] Arquivo físico removido:', fileRecord.file_path);
    }
    
    // Remover do banco
    await deleteFile(fileId);
    
    // Log da atividade
    await logFileActivity(fileId, 'delete', req.user.uid);
    
    console.log('[DELETE FILE] Arquivo deletado com sucesso');
    res.status(200).json({ message: 'Arquivo deletado com sucesso' });
  } catch (error) {
    console.error('[DELETE FILE] Erro ao deletar arquivo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint estático para servir arquivos (alternativo ao download)
app.use('/uploads', express.static(uploadsDir));

// Endpoint para listar obrigações tributárias disponíveis
app.get('/api/agenda-tributaria/obrigacoes', authenticateToken, async (req, res) => {
  try {
    console.log('[AGENDA-TRIBUTARIA] Listando obrigações disponíveis');
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem acessar a agenda tributária" });
    }
    
    // Mapear obrigações para formato simplificado
    const obrigacoesPorMes = OBRIGACOES_TRIBUTARIAS.map(mesObj => ({
      mes: mesObj.mes,
      mesNome: new Date(0, mesObj.mes - 1).toLocaleString('pt-BR', { month: 'long' }),
      totalObrigacoes: mesObj.obrigacoes.length,
      obrigacoes: mesObj.obrigacoes.map(obr => ({
        titulo: obr.titulo,
        vencimento: obr.vencimento,
        observacoes: obr.observacoes
      }))
    }));
    
    res.status(200).json({
      totalMeses: obrigacoesPorMes.length,
      obrigacoesPorMes
    });
    
  } catch (error) {
    console.error('[AGENDA-TRIBUTARIA] Erro ao listar obrigações:', error.message);
    res.status(500).json({ error: 'Erro ao listar obrigações tributárias: ' + error.message });
  }
});

// Endpoint para criar tarefas de um mês específico
app.post('/api/agenda-tributaria/criar-mes', authenticateToken, async (req, res) => {
  try {
    const { ano, mes, responsavelEmail } = req.body;
    
    console.log('[AGENDA-TRIBUTARIA] Criando tarefas para mês específico:', { ano, mes, responsavelEmail });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas da agenda tributária" });
    }
    
    // Validar parâmetros
    if (!ano || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Ano e mês são obrigatórios. Mês deve estar entre 1 e 12." });
    }
    
    // Criar tarefas
    const resultado = await criarTarefasMes(ano, mes, responsavelEmail);
    
    if (resultado.sucesso) {
      // Log da atividade
      await insertActivityLog({
        userId: req.user.uid,
        userEmail: req.user.email,
        action: 'create_agenda_tributaria_mes',
        taskId: `agenda-${ano}-${mes}`,
        taskTitle: `Agenda Tributária ${mes}/${ano} (${resultado.tarefasCriadas} tarefas)`
      });
      
      res.status(200).json({
        message: `Agenda tributária de ${mes}/${ano} criada com sucesso!`,
        ...resultado
      });
    } else {
      res.status(400).json({
        error: "Erro ao criar agenda tributária",
        detalhes: resultado.erro
      });
    }
    
  } catch (error) {
    console.error('[AGENDA-TRIBUTARIA] Erro ao criar tarefas do mês:', error.message);
    res.status(500).json({ error: 'Erro ao criar tarefas do mês: ' + error.message });
  }
});

// Endpoint para criar tarefas do ano completo
app.post('/api/agenda-tributaria/criar-ano', authenticateToken, async (req, res) => {
  try {
    const { ano, responsavelEmail } = req.body;
    
    console.log('[AGENDA-TRIBUTARIA] Criando tarefas para ano completo:', { ano, responsavelEmail });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas da agenda tributária" });
    }
    
    // Validar parâmetros
    if (!ano || ano < 2020 || ano > 2030) {
      return res.status(400).json({ error: "Ano é obrigatório e deve estar entre 2020 e 2030." });
    }
    
    // Criar tarefas do ano inteiro
    const resultados = await criarTarefasAnoCompleto(ano, responsavelEmail);
    
    const sucessos = resultados.filter(r => r.sucesso);
    const erros = resultados.filter(r => !r.sucesso);
    const totalTarefas = sucessos.reduce((total, r) => total + r.tarefasCriadas, 0);
    
    // Log da atividade
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'create_agenda_tributaria_ano',
      taskId: `agenda-${ano}`,
      taskTitle: `Agenda Tributária ${ano} (${totalTarefas} tarefas, ${sucessos.length} meses)`
    });
    
    res.status(200).json({
      message: `Agenda tributária de ${ano} processada!`,
      ano,
      mesesProcessados: resultados.length,
      sucessos: sucessos.length,
      erros: erros.length,
      totalTarefasCriadas: totalTarefas,
      detalhes: {
        sucessos: sucessos.map(s => ({
          mes: s.mes,
          tarefasCriadas: s.tarefasCriadas,
          responsavel: s.responsavel
        })),
        erros: erros.map(e => ({
          mes: e.mes,
          erro: e.erro
        }))
      }
    });
    
  } catch (error) {
    console.error('[AGENDA-TRIBUTARIA] Erro ao criar tarefas do ano:', error.message);
    res.status(500).json({ error: 'Erro ao criar tarefas do ano: ' + error.message });
  }
});

// Endpoint para criar tarefas do próximo mês
app.post('/api/agenda-tributaria/proximo-mes', authenticateToken, async (req, res) => {
  try {
    const { responsavelEmail } = req.body;
    
    console.log('[AGENDA-TRIBUTARIA] Criando tarefas para próximo mês:', { responsavelEmail });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas da agenda tributária" });
    }
    
    // Calcular próximo mês
    const dataAtual = new Date();
    const proximoMes = dataAtual.getMonth() + 2; // +1 para próximo mês, +1 porque getMonth() é 0-based
    const anoProximo = proximoMes > 12 ? dataAtual.getFullYear() + 1 : dataAtual.getFullYear();
    const mesProximo = proximoMes > 12 ? 1 : proximoMes;
    
    console.log(`[AGENDA-TRIBUTARIA] Próximo mês calculado: ${mesProximo}/${anoProximo}`);
    
    // Criar tarefas
    const resultado = await criarTarefasMes(anoProximo, mesProximo, responsavelEmail);
    
    if (resultado.sucesso) {
      // Log da atividade
      await insertActivityLog({
        userId: req.user.uid,
        userEmail: req.user.email,
        action: 'create_agenda_tributaria_proximo_mes',
        taskId: `agenda-${anoProximo}-${mesProximo}`,
        taskTitle: `Agenda Tributária ${mesProximo}/${anoProximo} (${resultado.tarefasCriadas} tarefas)`
      });
      
      res.status(200).json({
        message: `Agenda tributária do próximo mês (${mesProximo}/${anoProximo}) criada com sucesso!`,
        mesAtual: `${dataAtual.getMonth() + 1}/${dataAtual.getFullYear()}`,
        proximoMes: `${mesProximo}/${anoProximo}`,
        ...resultado
      });
    } else {
      res.status(400).json({
        error: "Erro ao criar agenda tributária do próximo mês",
        detalhes: resultado.erro
      });
    }
    
  } catch (error) {
    console.error('[AGENDA-TRIBUTARIA] Erro ao criar tarefas do próximo mês:', error.message);
    res.status(500).json({ error: 'Erro ao criar tarefas do próximo mês: ' + error.message });
  }
});

// Endpoint para buscar e atualizar a agenda tributária automaticamente
app.get('/api/agenda-tributaria/buscar-atualizacoes', authenticateToken, async (req, res) => {
  try {
    console.log('[AGENDA-AUTOMATIZADA] Buscando atualizações da agenda tributária');
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem buscar atualizações da agenda tributária" });
    }
    
    // Buscar atualizações da agenda tributária
    const agendaAtualizada = await buscarAgendaTributariaAtualizada();
    
    if (agendaAtualizada.sucesso) {
      res.status(200).json({
        message: "Agenda tributária atualizada com sucesso!",
        dataUltimaAtualizacao: agendaAtualizada.dataAtualizacao,
        totalObrigacoes: agendaAtualizada.totalObrigacoes,
        obrigacoesPorMes: agendaAtualizada.obrigacoesPorMes,
        fontes: agendaAtualizada.fontes
      });
    } else {
      res.status(500).json({
        error: "Erro ao buscar atualizações da agenda tributária",
        detalhes: agendaAtualizada.erro
      });
    }
    
  } catch (error) {
    console.error('[AGENDA-AUTOMATIZADA] Erro ao buscar atualizações:', error.message);
    res.status(500).json({ error: 'Erro ao buscar atualizações: ' + error.message });
  }
});

// Endpoint para listar obrigações tributárias completas (incluindo dados automatizados)
app.get('/api/agenda-tributaria/obrigacoes-completas', authenticateToken, async (req, res) => {
  try {
    console.log('[AGENDA-AUTOMATIZADA] Listando obrigações completas');
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem acessar as obrigações completas" });
    }
    
    console.log('[AGENDA-AUTOMATIZADA] Tipo de AGENDA_TRIBUTARIA_COMPLETA:', typeof AGENDA_TRIBUTARIA_COMPLETA);
    console.log('[AGENDA-AUTOMATIZADA] Chaves de AGENDA_TRIBUTARIA_COMPLETA:', Object.keys(AGENDA_TRIBUTARIA_COMPLETA));
    
    // Converter objeto para array de meses
    const obrigacoesPorMes = Object.keys(AGENDA_TRIBUTARIA_COMPLETA).map(mes => {
      const numeroMes = parseInt(mes);
      const obrigacoesMes = AGENDA_TRIBUTARIA_COMPLETA[mes];
      
      return {
        mes: numeroMes,
        mesNome: new Date(0, numeroMes - 1).toLocaleString('pt-BR', { month: 'long' }),
        totalObrigacoes: obrigacoesMes.length,
        obrigacoes: obrigacoesMes.map(obr => ({
          titulo: obr.titulo,
          vencimento: obr.vencimento,
          observacoes: obr.observacoes,
          categoria: obr.categoria,
          empresaTipo: obr.empresaTipo,
          fonte: obr.fonte
        }))
      };
    }).sort((a, b) => a.mes - b.mes); // Ordenar por mês
    
    const totalObrigacoes = obrigacoesPorMes.reduce((total, mes) => total + mes.totalObrigacoes, 0);
    
    console.log('[AGENDA-AUTOMATIZADA] Total de meses processados:', obrigacoesPorMes.length);
    console.log('[AGENDA-AUTOMATIZADA] Total de obrigações:', totalObrigacoes);
    
    res.status(200).json({
      totalMeses: obrigacoesPorMes.length,
      totalObrigacoes,
      dataUltimaAtualizacao: new Date().toISOString(),
      obrigacoesPorMes
    });
    
  } catch (error) {
    console.error('[AGENDA-AUTOMATIZADA] Erro ao listar obrigações completas:', error.message);
    console.error('[AGENDA-AUTOMATIZADA] Stack trace:', error.stack);
    res.status(500).json({ error: 'Erro ao listar obrigações completas: ' + error.message });
  }
});

// Endpoint para criar tarefas usando dados da API (sistema automatizado)
app.post('/api/agenda-tributaria/criar-mes-api', authenticateToken, async (req, res) => {
  try {
    const { ano, mes, responsavelEmail, filtros } = req.body;
    
    console.log('[AGENDA-AUTOMATIZADA] Criando tarefas com dados da API:', { ano, mes, responsavelEmail, filtros });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas da agenda tributária" });
    }
    
    // Validar parâmetros
    if (!ano || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Ano e mês são obrigatórios. Mês deve estar entre 1 e 12." });
    }
    
    // Criar tarefas usando dados da API
    const resultado = await criarTarefasComDadosAPI(ano, mes, responsavelEmail, filtros);
    
    if (resultado.sucesso) {
      // Log da atividade
      await insertActivityLog({
        userId: req.user.uid,
        userEmail: req.user.email,
        action: 'create_agenda_tributaria_api_mes',
        taskId: `agenda-api-${ano}-${mes}`,
        taskTitle: `Agenda Tributária API ${mes}/${ano} (${resultado.tarefasCriadas} tarefas)`
      });
      
      res.status(200).json({
        message: `Agenda tributária automatizada de ${mes}/${ano} criada com sucesso!`,
        sistemaUsado: 'automatizado',
        ...resultado
      });
    } else {
      res.status(400).json({
        error: "Erro ao criar agenda tributária automatizada",
        detalhes: resultado.erro
      });
    }
    
  } catch (error) {
    console.error('[AGENDA-AUTOMATIZADA] Erro ao criar tarefas do mês com API:', error.message);
    res.status(500).json({ error: 'Erro ao criar tarefas do mês com API: ' + error.message });
  }
});

// Endpoint para criar tarefas do ano completo usando dados da API
app.post('/api/agenda-tributaria/criar-ano-api', authenticateToken, async (req, res) => {
  try {
    const { ano, responsavelEmail, filtros } = req.body;
    
    console.log('[AGENDA-AUTOMATIZADA] Criando tarefas do ano com dados da API:', { ano, responsavelEmail, filtros });
    
    // Verificar se é admin
    const user = await getUserByUid(req.user.uid);
    if (!user || user.cargo !== 'admin') {
      return res.status(403).json({ error: "Apenas administradores podem criar tarefas da agenda tributária" });
    }
    
    // Validar parâmetros
    if (!ano || ano < 2020 || ano > 2030) {
      return res.status(400).json({ error: "Ano é obrigatório e deve estar entre 2020 e 2030." });
    }
    
    let totalTarefas = 0;
    let sucessos = 0;
    let erros = 0;
    const resultadosDetalhados = [];
    
    // Criar tarefas mês por mês
    for (let mes = 1; mes <= 12; mes++) {
      try {
        const resultado = await criarTarefasComDadosAPI(ano, mes, responsavelEmail, filtros);
        
        if (resultado.sucesso) {
          totalTarefas += resultado.tarefasCriadas;
          sucessos++;
          resultadosDetalhados.push({
            mes,
            sucesso: true,
            tarefasCriadas: resultado.tarefasCriadas,
            responsavel: resultado.responsavel
          });
        } else {
          erros++;
          resultadosDetalhados.push({
            mes,
            sucesso: false,
            erro: resultado.erro
          });
        }
      } catch (mesError) {
        erros++;
        resultadosDetalhados.push({
          mes,
          sucesso: false,
          erro: mesError.message
        });
      }
    }
    
    // Log da atividade
    await insertActivityLog({
      userId: req.user.uid,
      userEmail: req.user.email,
      action: 'create_agenda_tributaria_api_ano',
      taskId: `agenda-api-${ano}`,
      taskTitle: `Agenda Tributária API ${ano} (${totalTarefas} tarefas, ${sucessos} meses)`
    });
    
    res.status(200).json({
      message: `Agenda tributária automatizada de ${ano} processada!`,
      sistemaUsado: 'automatizado',
      ano,
      mesesProcessados: 12,
      sucessos,
      erros,
      totalTarefasCriadas: totalTarefas,
      detalhes: {
        sucessos: resultadosDetalhados.filter(r => r.sucesso),
        erros: resultadosDetalhados.filter(r => !r.sucesso)
      }
    });
    
  } catch (error) {
    console.error('[AGENDA-AUTOMATIZADA] Erro ao criar tarefas do ano com API:', error.message);
    res.status(500).json({ error: 'Erro ao criar tarefas do ano com API: ' + error.message });
  }
});

// servir build do frontend (Vite) pelo Node
const frontendDist = path.resolve(__dirname, '../frontend/dist');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  // Fallback de SPA sem usar '*' (evita o bug do path-to-regexp)
  // Envia index.html para QUALQUER rota GET que NÃO comece com /api
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  console.warn('[FRONT] pasta dist não encontrada em', frontendDist);
}


// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
