import axiosInstance from '../utils/axiosConfig';

// ===== SERVIÇOS DE API PARA SQLITE =====

// Usuários
export const userService = {
  // Buscar todos os usuários
  getAll: async () => {
    const response = await axiosInstance.get('/api/usuarios');
    return response.data;
  },

  // Login
  login: async (email, password) => {
    const response = await axiosInstance.post('/api/login', { email, password });
    return response.data;
  },

  // Cadastro
  register: async (userData) => {
    const response = await axiosInstance.post('/api/cadastro', userData);
    return response.data;
  },

  // Reset password
  resetPassword: async (email) => {
    const response = await axiosInstance.post('/api/reset-password', { email });
    return response.data;
  },

  // Upsert user (criar ou atualizar)
  upsert: async (userData) => {
    const response = await axiosInstance.post('/api/usuarios/upsert', userData);
    return response.data;
  },

  // Atualizar último login
  updateLastLogin: async (userId) => {
    const response = await axiosInstance.patch(`/api/usuarios/${userId}/last-login`);
    return response.data;
  }
};

// Tarefas
export const taskService = {
  // Buscar todas as tarefas
  getAll: async () => {
    const response = await axiosInstance.get('/api/tarefas');
    return response.data;
  },

  // Criar nova tarefa
  create: async (taskData) => {
    const response = await axiosInstance.post('/api/tarefas', taskData);
    return response.data;
  },

  // Atualizar status da tarefa
  updateStatus: async (taskId, status) => {
    const response = await axiosInstance.patch(`/api/tarefas/${taskId}/status`, { status });
    return response.data;
  },

  // Atualizar tarefa completa
  update: async (taskId, taskData) => {
    const response = await axiosInstance.put(`/api/tarefas/${taskId}`, taskData);
    return response.data;
  },

  // Deletar tarefa
  delete: async (taskId) => {
    const response = await axiosInstance.delete(`/api/tarefas/${taskId}`);
    return response.data;
  },

  // Buscar arquivos da tarefa
  getFiles: async (taskId) => {
    const response = await axiosInstance.get(`/api/files/task/${taskId}`);
    return response.data;
  },

  // Upload de arquivo
  uploadFile: async (taskId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('taskId', taskId);
    
    const response = await axiosInstance.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  },

  // Deletar arquivo
  deleteFile: async (fileId) => {
    const response = await axiosInstance.delete(`/api/files/${fileId}`);
    return response.data;
  }
};

// Logs
export const logService = {
  // Buscar logs
  getAll: async () => {
    const response = await axiosInstance.get('/api/logs');
    return response.data;
  },

  // Criar novo log
  create: async (logData) => {
    const response = await axiosInstance.post('/api/logs', logData);
    return response.data;
  }
};

// Agenda Tributária
export const agendaTributariaService = {
  // Listar obrigações básicas
  getObrigacoes: async () => {
    const response = await axiosInstance.get('/api/agenda-tributaria/obrigacoes');
    return response.data;
  },

  // Listar obrigações completas (sistema automatizado)
  getObrigacoesCompletas: async () => {
    const response = await axiosInstance.get('/api/agenda-tributaria/obrigacoes-completas');
    return response.data;
  },

  // Buscar atualizações da agenda tributária
  buscarAtualizacoes: async () => {
    const response = await axiosInstance.get('/api/agenda-tributaria/buscar-atualizacoes');
    return response.data;
  },

  // Criar tarefas do mês (sistema básico)
  criarTarefasMes: async (ano, mes, responsavelEmail) => {
    const response = await axiosInstance.post('/api/agenda-tributaria/criar-mes', {
      ano,
      mes,
      responsavelEmail
    });
    return response.data;
  },

  // Criar tarefas do ano (sistema básico)
  criarTarefasAno: async (ano, responsavelEmail) => {
    const response = await axiosInstance.post('/api/agenda-tributaria/criar-ano', {
      ano,
      responsavelEmail
    });
    return response.data;
  },

  // Criar tarefas do próximo mês (sistema básico)
  criarTarefasProximoMes: async (responsavelEmail) => {
    const response = await axiosInstance.post('/api/agenda-tributaria/proximo-mes', {
      responsavelEmail
    });
    return response.data;
  },

  // Criar tarefas do mês com API (sistema automatizado)
  criarTarefasMesAPI: async (ano, mes, responsavelEmail, filtros) => {
    const response = await axiosInstance.post('/api/agenda-tributaria/criar-mes-api', {
      ano,
      mes,
      responsavelEmail,
      filtros
    });
    return response.data;
  },

  // Criar tarefas do ano com API (sistema automatizado)
  criarTarefasAnoAPI: async (ano, responsavelEmail, filtros) => {
    const response = await axiosInstance.post('/api/agenda-tributaria/criar-ano-api', {
      ano,
      responsavelEmail,
      filtros
    });
    return response.data;
  }
};

export default {
  userService,
  taskService,
  logService,
  agendaTributariaService
};
