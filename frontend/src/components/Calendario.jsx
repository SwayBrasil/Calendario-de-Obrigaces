import React, { useState, useEffect, useRef, useContext } from "react";
import { Calendar, Plus, Filter, Bell, User, Clock, CheckCircle, AlertCircle, XCircle,
  Eye, Trash2, FileText, Home, List, BarChart3, Maximize2, X, LogOut,
  Upload, Download, Image, File, AlertTriangle, Edit, RefreshCw, ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { AuthContext } from "../AuthContext";
import { useNavigate } from "react-router-dom";
import { taskService, userService, logService, agendaTributariaService } from '../services/api';
import axiosInstance from '../utils/axiosConfig';
import "../styles/styles.css";

const Calendario = () => {
  const { user, logout, isAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  // Debug logs para verificar se os valores estão chegando corretamente
  console.log("[Calendario] user recebido:", user);
  console.log("[Calendario] isAdmin recebido:", isAdmin);
  console.log("[Calendario] user.cargo:", user?.cargo);

   
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showTaskDetails, setShowTaskDetails] = useState(false);
  const [showEditTaskModal, setShowEditTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [activeView, setActiveView] = useState("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState({
    status: "todos",
    colaborador: "todos",
    mes: new Date().getMonth(),
  });
  const [tasks, setTasks] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [atividadeLog, setAtividadeLog] = useState([]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  
  // Estados para gerenciamento de arquivos
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showFileInspector, setShowFileInspector] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle'); // 'idle', 'uploading', 'processing', 'completed', 'error'

  // Estados para paginação de tarefas
  const [currentTaskPage, setCurrentTaskPage] = useState(1);
  const [currentReportPage, setCurrentReportPage] = useState(1);
  const [currentHomePage, setCurrentHomePage] = useState(1);
  const tasksPerPage = 5;

  // Estados para Agenda Tributária
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [obrigacoes, setObrigacoes] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [responsavelEmail, setResponsavelEmail] = useState('');
  const [agendaResultado, setAgendaResultado] = useState(null);
  const [agendaError, setAgendaError] = useState(null);
  const [showObrigacoes, setShowObrigacoes] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState({});

  // Estados para Sistema Automatizado de Agenda Tributária (único sistema disponível)
  const [modoAvancado, setModoAvancado] = useState(true); // Sistema automatizado é o padrão e único
  const [sistemaAtualizado, setSistemaAtualizado] = useState(false);
  const [obrigacoesCompletas, setObrigacoesCompletas] = useState([]);
  const [loadingObrigacoesAtualizadas, setLoadingObrigacoesAtualizadas] = useState(false);
  const [criacoesAutomatizadas, setCriacoesAutomatizadas] = useState({});

  const [newTask, setNewTask] = useState({
    titulo: "",
    responsavel: "",
    responsavelId: "",
    dataVencimento: "",
    observacoes: "",
  recorrente: false,
  frequencia: "mensal",
  });

  const [editTask, setEditTask] = useState({
    id: "",
    titulo: "",
    responsavel: "",
    responsavelId: "",
    dataVencimento: "",
    observacoes: "",
    recorrente: false,
    frequencia: "mensal",
  });

  const modalRef = useRef(null);

  const statusColors = {
    pendente: "bg-yellow-100 text-yellow-800 border-yellow-200",
    em_andamento: "bg-blue-100 text-blue-800 border-blue-200",
    finalizado: "bg-green-100 text-green-800 border-green-200",
    vencido: "bg-red-100 text-red-800 border-red-200",
  };

  const statusIcons = {
    pendente: <Clock className="w-4 h-4" />,
    em_andamento: <AlertCircle className="w-4 h-4" />,
    finalizado: <CheckCircle className="w-4 h-4" />,
    vencido: <XCircle className="w-4 h-4" />,
  };

  const statusLabels = {
    pendente: "Pendente",
    em_andamento: "Em Andamento",
    finalizado: "Finalizado",
    vencido: "Vencido/Em Atraso",
  };

  const menuItems = [
    { id: "home", label: "Home", icon: Home, description: "Calendário principal" },
    { id: "tasks", label: "Gerenciador de Tarefas", icon: List, description: "Gestão de tarefas" },
    { id: "reports", label: "Relatórios", icon: BarChart3, description: "Relatórios e estatísticas" },
    ...(isAdmin ? [{ id: "agenda-tributaria", label: "Agenda Tributária", icon: FileText, description: "Obrigações fiscais mensais" }] : []),
  ];

  useEffect(() => {
    if (user) {
      setCurrentUser({
        id: user.uid,
        nome: user.email ? user.email.split("@")[0] : "Usuário",
        tipo: user.cargo || "usuario",
      });
      
      // Inicializar newTask com o ID do usuário atual
      setNewTask(prev => ({
        ...prev,
        responsavelId: user.uid
      }));
    }
  }, [user]);

  // Função para buscar tarefas - movida para fora do useEffect para poder ser reutilizada
  const fetchTasks = async () => {
    try {
      const tasksData = await taskService.getAll();
      const formattedTasks = tasksData.map(task => ({
        ...task,
        dataVencimento: new Date(task.dataVencimento),
        dataCriacao: new Date(task.dataCriacao),
        comprovantes: task.comprovantes || [],
      }));
      setTasks(formattedTasks);
    } catch (error) {
      console.error("Erro ao buscar tarefas:", error);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    fetchTasks();
  }, [currentUser]);

  useEffect(() => {
    const hoje = new Date();
    setTasks((prev) =>
      prev.map((t) =>
        t.status !== "finalizado" && new Date(t.dataVencimento) < hoje
          ? { ...t, status: "vencido" }
          : t
      )
    );
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    
    const fetchUsers = async () => {
      try {
        const usuariosData = await userService.getAll();
        const formattedUsers = usuariosData.map(user => ({
          id: user.id || user.uid,
          nome: user.nome || user.nomeCompleto || (user.email ? user.email.split("@")[0] : "Usuário"),
          tipo: user.tipo || user.cargo || "usuario",
        }));
      setUsuarios(formattedUsers);
      console.log("[USERS DEBUG] Dados originais do servidor:", usuariosData);
      console.log("[USERS DEBUG] Usuários formatados:", formattedUsers);
      console.log("[USERS DEBUG] UID do usuário atual:", user?.uid);
      console.log("[USERS DEBUG] Usuário atual está na lista?", formattedUsers.find(u => u.id === user?.uid));
      console.log("[USERS DEBUG] Lista completa de IDs:", formattedUsers.map(u => ({ id: u.id, nome: u.nome })));
      
      // Log individual de cada usuário
      formattedUsers.forEach((u, index) => {
        console.log(`[USER ${index}] ID: ${u.id}, Nome: "${u.nome}", Tipo: ${u.tipo}`);
      });
      } catch (error) {
        console.error("Erro ao buscar usuários:", error);
      }
    };
    
    fetchUsers();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    
    const fetchLogs = async () => {
      try {
        const logsData = await logService.getAll();
        console.log('[LOGS DEBUG] Dados recebidos do backend:', logsData.length, 'logs');
        console.log('[LOGS DEBUG] Primeiro log:', logsData[0]);
        
        const formattedLogs = logsData.map(log => ({
          ...log,
          timestamp: new Date(log.timestamp),
        }));
        
        console.log('[LOGS DEBUG] Logs formatados:', formattedLogs.length);
        console.log('[LOGS DEBUG] Primeiro log formatado:', formattedLogs[0]);
        
        // O backend já filtra os logs baseado nas permissões do usuário
        // Não precisamos filtrar novamente no frontend
        setAtividadeLog(formattedLogs);
        console.log('[LOGS DEBUG] Logs definidos no state:', formattedLogs.length);
      } catch (error) {
        console.error("Erro ao buscar logs de atividades:", error);
      }
    };
    
    fetchLogs();
  }, [currentUser, isAdmin, user]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const getTasksForDate = (date) =>
    tasks.filter((t) => {
      if (!t.dataVencimento) return false;
      const taskDate = t.dataVencimento instanceof Date ? t.dataVencimento : new Date(t.dataVencimento);
      return taskDate.toDateString() === date.toDateString();
    });

  const getFilteredTasks = () => {
    console.log("[FILTER DEBUG] Iniciando filtros de tarefas...");
    console.log("[FILTER DEBUG] Total de tarefas:", tasks.length);
    console.log("[FILTER DEBUG] Usuário atual:", { uid: user?.uid, email: user?.email });
    console.log("[FILTER DEBUG] isAdmin:", isAdmin);
    
    let filtered = tasks;
    
    if (!isAdmin) {
      console.log("[FILTER DEBUG] Aplicando filtro para usuário comum");
      console.log("[FILTER DEBUG] Tarefas antes do filtro:", filtered.map(t => ({ 
        id: t.id, 
        titulo: t.titulo, 
        responsavelId: t.responsavelId,
        match: t.responsavelId === user.uid 
      })));
      
      filtered = filtered.filter((t) => {
        const match = t.responsavelId === user.uid;
        console.log(`[FILTER DEBUG] Tarefa "${t.titulo}" - responsavelId: "${t.responsavelId}", user.uid: "${user.uid}", match: ${match}`);
        return match;
      });
      
      console.log("[FILTER DEBUG] Tarefas após filtro do usuário:", filtered.length);
    } else {
      console.log("[FILTER DEBUG] Usuário admin - sem filtro de responsável");
    }
    
    if (filters.status !== "todos") {
      const beforeCount = filtered.length;
      filtered = filtered.filter((t) => t.status === filters.status);
      console.log(`[FILTER DEBUG] Filtro de status (${filters.status}): ${beforeCount} -> ${filtered.length}`);
    }
    
    if (filters.colaborador !== "todos" && isAdmin) {
      const beforeCount = filtered.length;
      filtered = filtered.filter((t) => t.responsavelId === filters.colaborador);
      console.log(`[FILTER DEBUG] Filtro de colaborador (${filters.colaborador}): ${beforeCount} -> ${filtered.length}`);
    }
    
    if (filters.mes !== "todos") {
      const beforeCount = filtered.length;
      filtered = filtered.filter((t) => {
        if (!t.dataVencimento) return false;
        const taskDate = t.dataVencimento instanceof Date ? t.dataVencimento : new Date(t.dataVencimento);
        return taskDate.getMonth() === +filters.mes;
      });
      console.log(`[FILTER DEBUG] Filtro de mês (${filters.mes}): ${beforeCount} -> ${filtered.length}`);
    }
    
    console.log("[FILTER DEBUG] Resultado final:", filtered.length, "tarefas");
    return filtered;
  };

  const logActivity = async (action, taskId, taskTitle) => {
    try {
      const logData = {
        userId: user.uid,
        userEmail: user.email,
        action,
        taskId,
        taskTitle,
        taskResponsavelId: newTask.responsavelId || selectedTask?.responsavelId || "",
        timestamp: new Date().toISOString(),
      };
      const createdLog = await logService.create(logData);
      
      // Atualizar logs local imediatamente para refletir na UI
      const formattedLog = {
        ...createdLog,
        timestamp: new Date(createdLog.timestamp),
      };
      
      setAtividadeLog(prev => [formattedLog, ...prev]);
    } catch (error) {
      console.error("Erro ao registrar atividade:", error);
    }
  };

  const handleCreateTask = async () => {
    if (!user) {
      alert("Você precisa estar autenticado para criar uma tarefa!");
      return;
    }
    
    // Verificar se o usuário é admin para poder criar tarefas
    if (!isAdmin) {
      alert("Apenas administradores podem criar tarefas.");
      return;
    }
    
    if (!newTask.titulo.trim() || !newTask.responsavelId || !newTask.dataVencimento) {
      alert("Preencha todos os campos obrigatórios!");
      return;
    }
    const responsavel = usuarios.find((u) => u.id === newTask.responsavelId);
    if (!responsavel) {
      alert("O responsável selecionado não está cadastrado no sistema!");
      return;
    }

    const taskData = {
      titulo: newTask.titulo.trim(),
      responsavel: responsavel.nome,
      responsavelId: responsavel.id,
      dataVencimento: new Date(newTask.dataVencimento).toISOString(),
      status: "pendente",
      observacoes: newTask.observacoes || "",
      comprovantes: [],
      dataCriacao: new Date().toISOString(),
      recorrente: newTask.recorrente,
      frequencia: newTask.frequencia,
    };

    console.log("[CREATE TASK] Usuário autenticado:", user.uid);
    console.log("[CREATE TASK] Responsável selecionado:", responsavel);
    console.log("[CREATE TASK] Dados da tarefa:", taskData);
    console.log("[CREATE TASK] ResponsavelId que será salvo:", responsavel.id);

    try {
      const createdTask = await taskService.create(taskData);
      await logActivity("create_task", createdTask.id, taskData.titulo);
      
      // Atualizar lista local de tarefas
      const formattedTask = {
        ...createdTask,
        dataVencimento: new Date(createdTask.dataVencimento),
        dataCriacao: new Date(createdTask.dataCriacao),
        comprovantes: createdTask.comprovantes || [],
      };
      setTasks(prev => [...prev, formattedTask]);
      
      setShowTaskModal(false);
      setNewTask({
        titulo: "",
        responsavel: "",
        responsavelId: "",
        dataVencimento: "",
        observacoes: "",
        recorrente: false,
        frequencia: "mensal",
      });
      console.log("Tarefa criada com sucesso!");
    } catch (error) {
      console.error("Erro ao criar tarefa:", error.message);
      alert("Erro ao criar tarefa. Tente novamente.");
    }
  };

  const handleUpdateTaskStatus = async (id, status) => {
    const task = tasks.find((t) => t.id === id);
    
    // Verificar se o usuário pode atualizar o status da tarefa
    if (!isAdmin && task?.responsavelId !== user?.uid) {
      alert("Você só pode atualizar o status de suas próprias tarefas.");
      return;
    }

    // Validar se há comprovante anexado para marcar como finalizado
    if (status === "finalizado") {
      const hasComprovantes = task?.comprovantes && task.comprovantes.length > 0;
      if (!hasComprovantes) {
        alert("Para marcar como finalizado, é obrigatório anexar pelo menos um comprovante à tarefa.");
        return;
      }
    }

    try {
      await taskService.updateStatus(id, status);
      await logActivity("update_task_status", id, task?.titulo || "Tarefa");
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      if (selectedTask && selectedTask.id === id) {
        setSelectedTask({ ...selectedTask, status });
      }
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      alert("Erro ao atualizar status. Tente novamente.");
    }
  };

  const handleEditTask = (task) => {
    // Verificar se o usuário é admin para poder editar tarefas
    if (!isAdmin) {
      alert("Apenas administradores podem editar tarefas.");
      return;
    }
    
    // Definir dados da tarefa para edição
    setEditTask({
      id: task.id,
      titulo: task.titulo,
      responsavel: task.responsavel,
      responsavelId: task.responsavelId,
      dataVencimento: task.dataVencimento ? 
        new Date(task.dataVencimento).toISOString().split('T')[0] : "",
      observacoes: task.observacoes || "",
      recorrente: task.recorrente || false,
      frequencia: task.frequencia || "mensal",
    });
    
    setEditingTask(task);
    setShowEditTaskModal(true);
    setShowTaskDetails(false);
  };

  const handleUpdateTask = async () => {
    if (!user) {
      alert("Você precisa estar autenticado para editar uma tarefa!");
      return;
    }
    
    // Verificar se o usuário é admin para poder editar tarefas
    if (!isAdmin) {
      alert("Apenas administradores podem editar tarefas.");
      return;
    }
    
    if (!editTask.titulo.trim() || !editTask.responsavelId || !editTask.dataVencimento) {
      alert("Preencha todos os campos obrigatórios!");
      return;
    }
    
    const responsavel = usuarios.find((u) => u.id === editTask.responsavelId);
    if (!responsavel) {
      alert("O responsável selecionado não está cadastrado no sistema!");
      return;
    }

    const taskData = {
      titulo: editTask.titulo.trim(),
      responsavel: responsavel.nome,
      responsavelId: responsavel.id,
      dataVencimento: new Date(editTask.dataVencimento).toISOString(),
      observacoes: editTask.observacoes || "",
      recorrente: editTask.recorrente,
      frequencia: editTask.frequencia,
    };

    try {
      const updatedTask = await taskService.update(editTask.id, taskData);
      await logActivity("edit_task", editTask.id, taskData.titulo);
      
      // Atualizar lista local de tarefas
      const formattedTask = {
        ...updatedTask,
        dataVencimento: new Date(updatedTask.dataVencimento),
        dataCriacao: new Date(updatedTask.dataCriacao),
        comprovantes: updatedTask.comprovantes || [],
      };
      
      setTasks(prev => prev.map(t => 
        t.id === editTask.id ? formattedTask : t
      ));
      
      // Atualizar tarefa selecionada se for a mesma
      if (selectedTask && selectedTask.id === editTask.id) {
        setSelectedTask(formattedTask);
      }
      
      setShowEditTaskModal(false);
      setEditingTask(null);
      setEditTask({
        id: "",
        titulo: "",
        responsavel: "",
        responsavelId: "",
        dataVencimento: "",
        observacoes: "",
        recorrente: false,
        frequencia: "mensal",
      });
      alert("Tarefa atualizada com sucesso!");
    } catch (error) {
      console.error("Erro ao atualizar tarefa:", error.message);
      alert("Erro ao atualizar tarefa. Tente novamente.");
    }
  };

  const handleDeleteTask = async (id) => {
    // Verificar se o usuário é admin para poder excluir tarefas
    if (!isAdmin) {
      alert("Apenas administradores podem excluir tarefas.");
      return;
    }
    
    if (window.confirm("Tem certeza de que deseja excluir esta tarefa?")) {
      try {
        const task = tasks.find((t) => t.id === id);
        await taskService.delete(id);
        await logActivity("delete_task", id, task?.titulo || "Tarefa");
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setShowTaskDetails(false);
        setSelectedTask(null);
      } catch (error) {
        console.error("Erro ao excluir tarefa:", error);
        alert("Erro ao excluir tarefa. Tente novamente.");
      }
    }
  };

  // Função para validar tipo de arquivo
  const validateFileType = (file) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ];
    return allowedTypes.includes(file.type);
  };
  
  // Função para validar tamanho do arquivo (máximo 10MB)
  const validateFileSize = (file) => {
    const maxSize = 10 * 1024 * 1024; // 10MB em bytes
    return file.size <= maxSize;
  };
  
  // Função para gerar preview do arquivo
  const generateFilePreview = (file) => {
    return new Promise((resolve) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            type: 'image',
            url: e.target.result,
            name: file.name,
            size: file.size
          });
        };
        reader.readAsDataURL(file);
      } else {
        resolve({
          type: 'document',
          url: null,
          name: file.name,
          size: file.size,
          fileType: file.type
        });
      }
    });
  };
  
  // Função para formatar tamanho do arquivo
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // Função para selecionar arquivo e mostrar preview inline
  const handleFileSelect = async (taskId, file) => {
    console.log('[DEBUG] handleFileSelect chamado:', { taskId, fileName: file?.name });
    if (!file) {
      console.log('[DEBUG] Arquivo não fornecido');
      return;
    }
    
    console.log('[DEBUG] Limpando erros anteriores...');
    setFileError(null);
    
    // Validar tipo de arquivo
    console.log('[DEBUG] Validando tipo de arquivo:', file.type);
    if (!validateFileType(file)) {
      console.log('[DEBUG] Tipo de arquivo inválido:', file.type);
      setFileError('Tipo de arquivo não suportado. Use imagens (JPEG, PNG, GIF, WebP) ou documentos (PDF, Word, Excel, TXT, CSV).');
      return;
    }
    
    // Validar tamanho do arquivo
    console.log('[DEBUG] Validando tamanho do arquivo:', file.size);
    if (!validateFileSize(file)) {
      console.log('[DEBUG] Arquivo muito grande:', file.size);
      setFileError('Arquivo muito grande. O tamanho máximo é 10MB.');
      return;
    }
    
    console.log('[DEBUG] Arquivo válido, configurando states para preview inline...');
    setSelectedFile({ file, taskId });
    const preview = await generateFilePreview(file);
    setFilePreview(preview);
    console.log('[DEBUG] Preview configurado - exibindo controles inline');
  };
  
  
  // Função para confirmar upload do arquivo
  const handleConfirmUpload = async () => {
    if (!selectedFile) {
      console.error('[UPLOAD] Erro: selectedFile está vazio');
      return;
    }
    
    console.log('[UPLOAD] Iniciando processo de upload...');
    console.log('[UPLOAD] selectedFile:', selectedFile);
    
    setIsUploading(true);
    setUploadProgress(0);
    setFileError(null);
    setUploadStatus('uploading');
    
    try {
      const { file, taskId } = selectedFile;
      
      console.log('[UPLOAD] Dados do arquivo:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
      console.log('[UPLOAD] TaskId:', taskId);
      
      // Verificar se o token de autenticação existe
      const token = localStorage.getItem('authToken');
      console.log('[UPLOAD] Token de autenticação presente:', !!token);
      if (token) {
        console.log('[UPLOAD] Primeiros 20 chars do token:', token.substring(0, 20) + '...');
      }
      
      // Simular progresso de upload com feedback visual aprimorado
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            setUploadStatus('processing');
            return prev;
          }
          return prev + 10;
        });
      }, 100);
      
      // Criar FormData para envio do arquivo
      const formData = new FormData();
      formData.append('file', file);
      formData.append('taskId', taskId);
      
      console.log('[UPLOAD] FormData criado:');
      for (let [key, value] of formData.entries()) {
        console.log(`[UPLOAD] FormData - ${key}:`, value);
      }
      
      console.log('[UPLOAD] Enviando requisição para /api/upload...');
      console.log('[UPLOAD] URL completa:', axiosInstance.defaults.baseURL + '/api/upload');
      
      // Enviar arquivo para o backend
      const response = await axiosInstance.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log('[UPLOAD] Progresso real do upload:', progress + '%');
        }
      });
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadStatus('completed');
      
      console.log('[UPLOAD] ✅ Resposta recebida com sucesso!');
      console.log('[UPLOAD] Status da resposta:', response.status);
      console.log('[UPLOAD] Headers da resposta:', response.headers);
      console.log('[UPLOAD] Dados da resposta:', response.data);
      
      // Verificar se a resposta contém os dados esperados
      if (!response.data || !response.data.url) {
        console.error('[UPLOAD] ❌ Resposta inválida - dados incompletos:', response.data);
        throw new Error('Resposta do servidor incompleta');
      }
      
      const fileMetadata = {
        url: response.data.url,
        name: response.data.name,
        size: response.data.size,
        type: response.data.type,
        uploadDate: response.data.uploadDate,
        uploadedBy: response.data.uploadedBy,
        id: response.data.id
      };
      
      console.log('[UPLOAD] Metadata do arquivo criado:', fileMetadata);
      
      // O arquivo já foi salvo no backend via upload endpoint
      
      await logActivity("upload_file", taskId, tasks.find((t) => t.id === taskId)?.titulo || "Tarefa");
      
      // Atualizar estado local
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { 
            ...t, 
            comprovantes: [...(t.comprovantes || []), fileMetadata] 
          } : t
        )
      );
      
      if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask({
          ...selectedTask,
          comprovantes: [...(selectedTask.comprovantes || []), fileMetadata]
        });
      }
      
      // Limpar estados após um breve delay para mostrar o feedback de sucesso
      setTimeout(() => {
        setSelectedFile(null);
        setFilePreview(null);
        setUploadProgress(0);
        setIsUploading(false);
        setUploadStatus('idle');
      }, 1500);
      
    } catch (error) {
      console.error("[UPLOAD] ❌ Erro ao fazer upload do arquivo:", error);
      
      // Log detalhado do erro
      if (error.response) {
        // O servidor respondeu com um código de erro
        console.error("[UPLOAD] Status do erro:", error.response.status);
        console.error("[UPLOAD] Headers do erro:", error.response.headers);
        console.error("[UPLOAD] Dados do erro:", error.response.data);
        console.error("[UPLOAD] Mensagem do servidor:", error.response.data?.error || error.response.data?.message);
      } else if (error.request) {
        // A requisição foi feita mas não houve resposta
        console.error("[UPLOAD] Sem resposta do servidor:", error.request);
        console.error("[UPLOAD] Status da requisição:", error.request.status);
        console.error("[UPLOAD] Ready state:", error.request.readyState);
      } else {
        // Erro na configuração da requisição
        console.error("[UPLOAD] Erro na configuração:", error.message);
      }
      
      console.error("[UPLOAD] Config da requisição:", error.config);
      console.error("[UPLOAD] Stack trace:", error.stack);
      
      // Limpar progresso em caso de erro
      const progressInterval = setInterval(() => {}, 1);
      clearInterval(progressInterval);
      
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          "Erro ao fazer upload do arquivo. Tente novamente.";
      
      setFileError(errorMessage);
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('error');
    }
  };

  // Função para cancelar upload
  const handleCancelUpload = () => {
    setSelectedFile(null);
    setFilePreview(null);
    setUploadProgress(0);
    setIsUploading(false);
    setFileError(null);
    setUploadStatus('idle');
  };
  
  // Função para obter ícone do tipo de arquivo
  const getFileIcon = (fileType) => {
    if (fileType.startsWith('image/')) {
      return <Image className="w-5 h-5 text-blue-600" />;
    } else if (fileType.includes('pdf')) {
      return <FileText className="w-5 h-5 text-red-600" />;
    } else if (fileType.includes('word')) {
      return <FileText className="w-5 h-5 text-blue-600" />;
    } else if (fileType.includes('excel') || fileType.includes('sheet')) {
      return <FileText className="w-5 h-5 text-green-600" />;
    } else {
      return <File className="w-5 h-5 text-gray-600" />;
    }
  };
  
  // Função legada para manter compatibilidade
  const handleFileUpload = async (id, file) => {
    console.log('[DEBUG] handleFileUpload chamado:', { id, file: file?.name });
    if (!file) {
      console.log('[DEBUG] Nenhum arquivo selecionado');
      alert("Selecione um arquivo para upload!");
      return;
    }
    console.log('[DEBUG] Chamando handleFileSelect...');
    await handleFileSelect(id, file);
  };

  const handleCloseModal = (modalType) => {
    if (modalType === "task") {
      setShowTaskModal(false);
      setNewTask({
        titulo: "",
        responsavel: "",
        responsavelId: user?.uid || "",
        dataVencimento: "",
        observacoes: "",
        recorrente: false,
        frequencia: "mensal",
      });
    } else if (modalType === "edit") {
      setShowEditTaskModal(false);
      setEditingTask(null);
      setEditTask({
        id: "",
        titulo: "",
        responsavel: "",
        responsavelId: "",
        dataVencimento: "",
        observacoes: "",
        recorrente: false,
        frequencia: "mensal",
      });
    } else if (modalType === "details") {
      setShowTaskDetails(false);
      setSelectedTask(null);
    } else if (modalType === "logout") {
      setShowLogoutConfirm(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const minimizeSidebar = () => {
    setSidebarCollapsed(true);
  };

  const maximizeSidebar = () => {
    setSidebarCollapsed(false);
  };

  // Função para calcular dados da paginação
  const getPaginationData = (data, currentPage, itemsPerPage) => {
    const totalItems = data.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentItems = data.slice(startIndex, endIndex);
    
    return {
      currentItems,
      totalPages,
      totalItems,
      startIndex,
      endIndex: Math.min(endIndex, totalItems),
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1
    };
  };
  
  // Componente de navegação de páginas
  const PaginationControls = ({ currentPage, setCurrentPage, totalPages, totalItems, startIndex, endIndex, label }) => {
    if (totalPages <= 1) return null;
    
    return (
      <div className="flex justify-between items-center mt-4 p-4 bg-gray-50 rounded-lg">
        <small className="text-gray-600">
          Mostrando {startIndex + 1} a {endIndex} de {totalItems} {label}
        </small>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Anterior
          </button>
          
          {/* Páginas */}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
            // Mostrar apenas algumas páginas para não ficar muito longo
            if (totalPages > 7 && page > 3 && page < totalPages - 2 && Math.abs(page - currentPage) > 1) {
              return page === 4 || page === totalPages - 3 ? (
                <span key={page} className="px-2 py-1 text-gray-500">...</span>
              ) : null;
            }
            
            return (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  page === currentPage
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {page}
              </button>
            );
          })}
          
          <button
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Próxima
          </button>
        </div>
      </div>
    );
  };

  const days = getDaysInMonth(selectedDate);
  const currentMonth = selectedDate.getMonth();
  const currentYear = selectedDate.getFullYear();

  const renderCalendarView = () => (
    <div className="flex-1 p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                {selectedDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedDate(new Date(currentYear, currentMonth - 1, 1))}
                  className="p-2 hover:bg-gray-100 rounded-md transition-colors"
                >
                  {"‹"}
                </button>
                <button
                  onClick={() => setSelectedDate(new Date())}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                >
                  Hoje
                </button>
                <button
                  onClick={() => setSelectedDate(new Date(currentYear, currentMonth + 1, 1))}
                  className="p-2 hover:bg-gray-100 rounded-md transition-colors"
                >
                  {"›"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
                <div key={day} className="p-2 text-center text-sm font-medium text-gray-600 bg-gray-50 rounded">
                  {day}
                </div>
              ))}

              {days.map((day, i) => {
                const isCurrentMonth = day.getMonth() === currentMonth;
                const isToday = day.toDateString() === new Date().toDateString();
                const dayTasks = getTasksForDate(day);

                return (
                  <div
                    key={i}
                    className={`
                      min-h-20 p-1 border rounded transition-all
                      ${isCurrentMonth ? "bg-white hover:bg-gray-50" : "bg-gray-50 text-gray-400"}
                      ${isToday ? "ring-2 ring-blue-500 bg-blue-50" : ""}
                      ${dayTasks.length > 0 ? "hover:shadow-md" : ""}
                    `}
                    onClick={() => dayTasks.length > 0 && setSelectedTask(dayTasks[0])}
                  >
                    <div className="text-sm font-medium mb-1">{day.getDate()}</div>
                    <div className="space-y-1 overflow-hidden">
                      {dayTasks.slice(0, 2).map((task) => (
                        <div 
                          key={task.id} 
                          className={`text-xs p-1 rounded truncate ${statusColors[task.status]}`}
                          title={task.titulo}
                        >
                          {task.titulo.length > 20 ? task.titulo.substring(0, 20) + '...' : task.titulo}
                        </div>
                      ))}
                      {dayTasks.length > 2 && (
                        <div className="text-xs text-gray-500">+{dayTasks.length - 2} mais</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Tarefas</h3>
            <div className="space-y-3">
              {getFilteredTasks().length === 0 ? (
                <div className="text-center py-8 text-gray-500">Nenhuma tarefa encontrada.</div>
              ) : (
                (() => {
                  const homePagination = getPaginationData(getFilteredTasks(), currentHomePage, tasksPerPage);
                  return homePagination.currentItems.map((task) => (
                    <div key={task.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-800 truncate" title={task.titulo}>{task.titulo}</h4>
                          <p className="text-sm text-gray-600 mt-1 truncate">Responsável: {task.responsavel}</p>
                          <p className="text-sm text-gray-600 truncate">Vencimento: {task.dataVencimento ? new Date(task.dataVencimento).toLocaleDateString("pt-BR") : "Data não definida"}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium border ${statusColors[task.status]} whitespace-nowrap`}>
                            {statusIcons[task.status]}
                            <span className="ml-1">{statusLabels[task.status]}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>
            

        {/* Paginação para tarefas da home */}
            {(() => {
              const homePagination = getPaginationData(getFilteredTasks(), currentHomePage, tasksPerPage);
              return (
                <PaginationControls
                  currentPage={currentHomePage}
                  setCurrentPage={setCurrentHomePage}
                  totalPages={homePagination.totalPages}
                  totalItems={homePagination.totalItems}
                  startIndex={homePagination.startIndex}
                  endIndex={homePagination.endIndex}
                  label="tarefas"
                />
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );

  const renderTaskManagerView = () => (
    <div className="flex-1 p-6">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800">Gerenciador de Tarefas</h2>
          {isAdmin && (
            <button
              onClick={() => setShowTaskModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nova Tarefa
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="text-yellow-600 font-semibold">Pendentes</div>
            <div className="text-2xl font-bold text-yellow-800">
              {getFilteredTasks().filter((t) => t.status === "pendente").length}
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-blue-600 font-semibold">Em Andamento</div>
            <div className="text-2xl font-bold text-blue-800">
              {getFilteredTasks().filter((t) => t.status === "em_andamento").length}
            </div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-green-600 font-semibold">Finalizadas</div>
            <div className="text-2xl font-bold text-green-800">
              {getFilteredTasks().filter((t) => t.status === "finalizado").length}
            </div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-red-600 font-semibold">Vencidas</div>
            <div className="text-2xl font-bold text-red-800">
              {getFilteredTasks().filter((t) => t.status === "vencido").length}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filtros
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="todos">Todos</option>
                <option value="pendente">Pendente</option>
                <option value="em_andamento">Em Andamento</option>
                <option value="finalizado">Finalizado</option>
                <option value="vencido">Vencido</option>
              </select>
            </div>

            {isAdmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Colaborador</label>
                <select
                  value={filters.colaborador}
                  onChange={(e) => setFilters({ ...filters, colaborador: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="todos">Todos</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mês</label>
              <select
                value={filters.mes}
                onChange={(e) => setFilters({ ...filters, mes: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="todos">Todos</option>
                {[...Array(12)].map((_, i) => (
                  <option key={i} value={i}>{new Date(0, i).toLocaleString("pt-BR", { month: "long" })}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 font-semibold text-gray-700">Tarefa</th>
                <th className="text-left p-3 font-semibold text-gray-700">Responsável</th>
                <th className="text-left p-3 font-semibold text-gray-700">Vencimento</th>
                <th className="text-left p-3 font-semibold text-gray-700">Status</th>
                <th className="text-left p-3 font-semibold text-gray-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const tasksPagination = getPaginationData(getFilteredTasks(), currentTaskPage, tasksPerPage);
                return tasksPagination.currentItems.map((task) => (
                  <tr key={task.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{task.titulo}</td>
                    <td className="p-3">{task.responsavel}</td>
                    <td className="p-3">{task.dataVencimento ? new Date(task.dataVencimento).toLocaleDateString("pt-BR") : "Data não definida"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${statusColors[task.status]}`}>
                        {statusIcons[task.status]}
                        <span className="ml-1">{statusLabels[task.status]}</span>
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setSelectedTask(task); setShowTaskDetails(true); }}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 hover:bg-gray-100 rounded transition-colors text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
        
        {/* Paginação para tarefas */}
        {(() => {
          const tasksPagination = getPaginationData(getFilteredTasks(), currentTaskPage, tasksPerPage);
          return (
            <PaginationControls
              currentPage={currentTaskPage}
              setCurrentPage={setCurrentTaskPage}
              totalPages={tasksPagination.totalPages}
              totalItems={tasksPagination.totalItems}
              startIndex={tasksPagination.startIndex}
              endIndex={tasksPagination.endIndex}
              label="tarefas"
            />
          );
        })()}
      </div>
    </div>
  );

  const renderReportsView = () => {
    // Debug logs para diagnosticar problemas
    console.log('=== DEBUG REPORTS VIEW ===');
    console.log('activeView:', activeView);
    console.log('atividadeLog length:', atividadeLog.length);
    console.log('currentUser:', currentUser);
    console.log('isAdmin:', isAdmin);
    console.log('Sample logs:', atividadeLog.slice(0, 3));
    
    // O backend já filtra os logs baseado nas permissões do usuário
    // Não precisamos aplicar filtro adicional no frontend
    const filteredLogs = atividadeLog;
    
    // Estatísticas dos logs
    const logStats = {
      totalActions: filteredLogs.length,
      tasksCreated: filteredLogs.filter(log => log.action === "create_task").length,
      statusUpdates: filteredLogs.filter(log => log.action === "update_task_status").length,
      tasksDeleted: filteredLogs.filter(log => log.action === "delete_task").length,
      filesUploaded: filteredLogs.filter(log => log.action === "upload_file").length,
    };

    // Função para obter detalhes da ação
    const getActionDetails = (log) => {
      const currentTask = tasks.find(t => t.id === log.taskId);
      const taskTitle = log.taskTitle || currentTask?.titulo || 'Tarefa não encontrada';
      
      switch (log.action) {
        case 'create_task':
          return {
            icon: <Plus className="w-4 h-4 text-blue-600" />,
            label: 'Tarefa Criada',
            description: `Nova tarefa: "${taskTitle}"`,
            color: 'text-blue-600'
          };
        case 'update_task_status':
          const statusLabelsDetail = {
            pendente: "Pendente",
            em_andamento: "Em Andamento", 
            finalizado: "Finalizado",
            vencido: "Vencido/Em Atraso"
          };
          const currentStatus = currentTask?.status || 'unknown';
          const statusLabel = statusLabelsDetail[currentStatus] || currentStatus;
          return {
            icon: <CheckCircle className="w-4 h-4 text-yellow-600" />,
            label: 'Status Atualizado',
            description: `"${taskTitle}" → Status: ${statusLabel}`,
            color: 'text-yellow-600'
          };
        case 'delete_task':
          return {
            icon: <Trash2 className="w-4 h-4 text-red-600" />,
            label: 'Tarefa Excluída',
            description: `Tarefa removida: "${taskTitle}"`,
            color: 'text-red-600'
          };
        case 'upload_file':
          return {
            icon: <FileText className="w-4 h-4 text-green-600" />,
            label: 'Comprovante Anexado',
            description: `Arquivo adicionado à tarefa: "${taskTitle}"`,
            color: 'text-green-600'
          };
        default:
          return {
            icon: <AlertCircle className="w-4 h-4 text-gray-600" />,
            label: 'Ação Desconhecida',
            description: `${log.action} em "${taskTitle}"`,
            color: 'text-gray-600'
          };
      }
    };

    return (
      <div className="flex-1 p-6">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Relatórios de Atividades</h2>
            <span className="text-sm text-gray-600">
              {isAdmin ? "Visualizando: Todas as atividades" : "Visualizando: Apenas suas atividades"}
            </span>
          </div>

          {/* Estatísticas */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-gray-600 font-semibold text-sm">Total de Ações</div>
              <div className="text-2xl font-bold text-gray-800">{logStats.totalActions}</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-blue-600 font-semibold text-sm">Tarefas Criadas</div>
              <div className="text-2xl font-bold text-blue-800">{logStats.tasksCreated}</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="text-yellow-600 font-semibold text-sm">Status Atualizados</div>
              <div className="text-2xl font-bold text-yellow-800">{logStats.statusUpdates}</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="text-red-600 font-semibold text-sm">Tarefas Excluídas</div>
              <div className="text-2xl font-bold text-red-800">{logStats.tasksDeleted}</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-green-600 font-semibold text-sm">Arquivos Enviados</div>
              <div className="text-2xl font-bold text-green-800">{logStats.filesUploaded}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-semibold text-gray-700">Ação</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Tarefa</th>
                  {isAdmin && <th className="text-left p-3 font-semibold text-gray-700">Usuário</th>}
                  <th className="text-left p-3 font-semibold text-gray-700">Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 4 : 3} className="p-6 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="w-8 h-8 text-gray-400" />
                        <span>Nenhum registro de atividade encontrado.</span>
                        {!isAdmin && (
                          <span className="text-sm text-gray-400">Você só pode ver suas próprias atividades.</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const sortedLogs = filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    const reportsPagination = getPaginationData(sortedLogs, currentReportPage, tasksPerPage);
                    return reportsPagination.currentItems.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const actionDetails = getActionDetails(log);
                              return (
                                <>
                                  {actionDetails.icon}
                                  <span className={`font-medium ${actionDetails.color}`}>{actionDetails.label}</span>
                                </>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="font-medium text-gray-800">{log.taskTitle}</span>
                        </td>
                        {isAdmin && (
                          <td className="p-3">
                            <span className="text-gray-600">{log.userEmail}</span>
                          </td>
                        )}
                        <td className="p-3">
                          <span className="text-gray-600">
                            {log.timestamp instanceof Date 
                              ? log.timestamp.toLocaleString("pt-BR") 
                              : new Date(log.timestamp).toLocaleString("pt-BR")}
                          </span>
                        </td>
                      </tr>
                    ));
                  })()
                )}
              </tbody>
            </table>
          </div>
          
          {/* Paginação para relatórios */}
          {(() => {
            const sortedLogs = filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const reportsPagination = getPaginationData(sortedLogs, currentReportPage, tasksPerPage);
            return (
              <PaginationControls
                currentPage={currentReportPage}
                setCurrentPage={setCurrentReportPage}
                totalPages={reportsPagination.totalPages}
                totalItems={reportsPagination.totalItems}
                startIndex={reportsPagination.startIndex}
                endIndex={reportsPagination.endIndex}
                label="registros"
              />
            );
          })()}
        </div>
      </div>
    );
  };

  // Funções da Agenda Tributária
  const carregarObrigacoes = async () => {
    try {
      setAgendaLoading(true);
      const response = await axiosInstance.get('/api/agenda-tributaria/obrigacoes');
      setObrigacoes(response.data.obrigacoesPorMes);
    } catch (error) {
      console.error('Erro ao carregar obrigações:', error);
      setAgendaError('Erro ao carregar obrigações tributárias');
    } finally {
      setAgendaLoading(false);
    }
  };

  const criarTarefasMes = async () => {
    if (!selectedYear || !selectedMonth) {
      setAgendaError('Selecione ano e mês');
      return;
    }

    try {
      setAgendaLoading(true);
      setAgendaError(null);
      setAgendaResultado(null);

      const response = await axiosInstance.post('/api/agenda-tributaria/criar-mes', {
        ano: selectedYear,
        mes: selectedMonth,
        responsavelEmail: responsavelEmail || undefined
      });

      setAgendaResultado({
        tipo: 'mes',
        dados: response.data
      });
    } catch (error) {
      console.error('Erro ao criar tarefas do mês:', error);
      setAgendaError(error.response?.data?.error || 'Erro ao criar tarefas do mês');
    } finally {
      setAgendaLoading(false);
    }
  };

  const criarTarefasAno = async () => {
    if (!selectedYear) {
      setAgendaError('Selecione um ano');
      return;
    }

    if (!window.confirm(`Tem certeza que deseja criar TODAS as tarefas de ${selectedYear}? Isso criará mais de 50 tarefas!`)) {
      return;
    }

    try {
      setAgendaLoading(true);
      setAgendaError(null);
      setAgendaResultado(null);

      const response = await axiosInstance.post('/api/agenda-tributaria/criar-ano', {
        ano: selectedYear,
        responsavelEmail: responsavelEmail || undefined
      });

      setAgendaResultado({
        tipo: 'ano',
        dados: response.data
      });
    } catch (error) {
      console.error('Erro ao criar tarefas do ano:', error);
      setAgendaError(error.response?.data?.error || 'Erro ao criar tarefas do ano');
    } finally {
      setAgendaLoading(false);
    }
  };

  const criarTarefasProximoMes = async () => {
    try {
      setAgendaLoading(true);
      setAgendaError(null);
      setAgendaResultado(null);

      const response = await axiosInstance.post('/api/agenda-tributaria/proximo-mes', {
        responsavelEmail: responsavelEmail || undefined
      });

      setAgendaResultado({
        tipo: 'proximo-mes',
        dados: response.data
      });
    } catch (error) {
      console.error('Erro ao criar tarefas do próximo mês:', error);
      setAgendaError(error.response?.data?.error || 'Erro ao criar tarefas do próximo mês');
    } finally {
      setAgendaLoading(false);
    }
  };

  const toggleMonth = (mes) => {
    setExpandedMonths(prev => ({
      ...prev,
      [mes]: !prev[mes]
    }));
  };

  const getYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear - 1; i <= 2030; i++) {
      years.push(i);
    }
    return years;
  };


  const getMonthName = (monthNum) => {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return months[monthNum - 1];
  };

  // Carregar obrigações quando a aba agenda-tributaria for ativa
  useEffect(() => {
    if (activeView === 'agenda-tributaria' && isAdmin) {
      carregarObrigacoes();
    }
  }, [activeView, isAdmin]);

  // Funções do Sistema Automatizado de Agenda Tributária
  const buscarObrigacoesAtualizadas = async () => {
    try {
      setLoadingObrigacoesAtualizadas(true);
      setAgendaError(null);
      
      console.log('[FRONTEND] Iniciando busca de obrigações atualizadas...');
      
      // Primeiro, tenta buscar as obrigações completas via API
      const responseCompletas = await agendaTributariaService.getObrigacoesCompletas();
      console.log('[FRONTEND] Resposta das obrigações completas:', responseCompletas);
      
      if (responseCompletas && responseCompletas.obrigacoesPorMes && responseCompletas.obrigacoesPorMes.length > 0) {
        setObrigacoesCompletas(responseCompletas.obrigacoesPorMes);
        setSistemaAtualizado(true);
        console.log('[FRONTEND] ✅ Obrigações completas carregadas com sucesso!');
        console.log('[FRONTEND] Total de meses:', responseCompletas.obrigacoesPorMes.length);
        console.log('[FRONTEND] Total de obrigações:', responseCompletas.totalObrigacoes);
      } else {
        // Se não conseguir as obrigações completas, tenta buscar atualizações
        console.log('[FRONTEND] Tentando buscar atualizações...');
        const responseAtualizacoes = await agendaTributariaService.buscarAtualizacoes();
        console.log('[FRONTEND] Resposta das atualizações:', responseAtualizacoes);
        
        if (responseAtualizacoes && responseAtualizacoes.obrigacoesPorMes) {
          setObrigacoesCompletas(responseAtualizacoes.obrigacoesPorMes);
          setSistemaAtualizado(true);
          console.log('[FRONTEND] ✅ Atualizações carregadas com sucesso!');
        } else {
          throw new Error('Não foi possível carregar dados atualizados');
        }
      }
    } catch (error) {
      console.error('[FRONTEND] ❌ Erro ao buscar obrigações atualizadas:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Erro ao buscar obrigações atualizadas';
      setAgendaError(errorMessage);
      setSistemaAtualizado(false);
    } finally {
      setLoadingObrigacoesAtualizadas(false);
    }
  };

  const criarTarefasComDadosAtualizados = async (periodo) => {
    if (!sistemaAtualizado) {
      setAgendaError('Primeiro busque as obrigações atualizadas');
      return;
    }

    try {
      setAgendaLoading(true);
      setAgendaError(null);
      setAgendaResultado(null);

      let response;
      
      if (periodo.mes) {
        // Criar tarefas do mês usando API
        response = await agendaTributariaService.criarTarefasMesAPI(
          periodo.ano, 
          periodo.mes, 
          responsavelEmail || undefined
        );
      } else {
        // Criar tarefas do ano usando API
        response = await agendaTributariaService.criarTarefasAnoAPI(
          periodo.ano, 
          responsavelEmail || undefined
        );
      }

      setCriacoesAutomatizadas(prev => ({
        ...prev,
        [JSON.stringify(periodo)]: {
          timestamp: new Date().toISOString(),
          resultado: response
        }
      }));

      setAgendaResultado({
        tipo: periodo.mes ? 'mes-automatizado' : 'ano-automatizado',
        dados: response,
        periodo
      });
      
      // Recarregar tarefas após criação bem-sucedida
      console.log('[AGENDA-AUTOMATIZADA] Recarregando lista de tarefas...');
      await fetchTasks();
      console.log('[AGENDA-AUTOMATIZADA] Lista de tarefas recarregada!');
      
    } catch (error) {
      console.error('Erro ao criar tarefas com dados atualizados:', error);
      setAgendaError(error.response?.data?.error || 'Erro ao criar tarefas com dados atualizados');
    } finally {
      setAgendaLoading(false);
    }
  };

  const criarTarefasMesAutomatizado = async () => {
    await criarTarefasComDadosAtualizados({
      ano: selectedYear,
      mes: selectedMonth
    });
  };

  const criarTarefasAnoAutomatizado = async () => {
    if (!window.confirm(`Tem certeza que deseja criar TODAS as tarefas automatizadas de ${selectedYear}? Isso criará tarefas com dados atualizados da API!`)) {
      return;
    }

    await criarTarefasComDadosAtualizados({
      ano: selectedYear
    });
  };

  const renderAgendaTributariaView = () => {
    if (!isAdmin) {
      return (
        <div className="flex-1 p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800">Acesso Restrito</h3>
              <p className="text-gray-600">Apenas administradores podem acessar a Agenda Tributária</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header com status do sistema */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <RefreshCw className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Agenda Tributária</h2>
                  <p className="text-gray-600">Sistema automatizado com dados atualizados da API</p>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                sistemaAtualizado 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {sistemaAtualizado ? '✅ Sistema Atualizado' : '⏳ Aguardando Dados'}
              </div>
            </div>
            
            {!sistemaAtualizado && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-800 font-medium">Primeiro passo: Buscar obrigações atualizadas</p>
                    <p className="text-blue-600 text-sm">Carregue os dados mais recentes da API para criar tarefas precisas</p>
                  </div>
                  <button
                    onClick={buscarObrigacoesAtualizadas}
                    disabled={loadingObrigacoesAtualizadas}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-medium"
                  >
                    {loadingObrigacoesAtualizadas ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {loadingObrigacoesAtualizadas ? 'Carregando...' : 'Buscar Dados'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Configurações */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
              Configurações
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  {getYearOptions().map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {getMonthName(i + 1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Responsável (opcional)
                </label>
                <input
                  type="email"
                  value={responsavelEmail}
                  onChange={(e) => setResponsavelEmail(e.target.value)}
                  placeholder="admin@empresa.com"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Deixe vazio para usar o primeiro administrador
                </p>
              </div>
            </div>
          </div>

          {/* Ações Principais */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
              Ações
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={criarTarefasMesAutomatizado}
                disabled={agendaLoading || !sistemaAtualizado}
                className="p-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {agendaLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  )}
                  <div className="text-left">
                    <div className="font-semibold">Criar Mês</div>
                    <div className="text-sm opacity-90">
                      {getMonthName(selectedMonth)}/{selectedYear}
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={criarTarefasAnoAutomatizado}
                disabled={agendaLoading || !sistemaAtualizado}
                className="p-4 bg-blue-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {agendaLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Calendar className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  )}
                  <div className="text-left">
                    <div className="font-semibold">Criar Ano Completo</div>
                    <div className="text-sm opacity-90">
                      {selectedYear} (12 meses)
                    </div>
                  </div>
                </div>
              </button>
            </div>
            
            {!sistemaAtualizado && (
              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <div className="flex items-center gap-2 text-yellow-800">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">Busque os dados atualizados primeiro</span>
                </div>
              </div>
            )}
          </div>

          {/* Informações do sistema quando atualizado */}
          {sistemaAtualizado && obrigacoesCompletas.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-800">Sistema Pronto</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-green-700">Obrigações carregadas:</span>
                  <span className="ml-2 font-bold text-green-800">{obrigacoesCompletas.length}</span>
                </div>
                <div>
                  <span className="text-green-700">Última atualização:</span>
                  <span className="ml-2 font-bold text-green-800">{new Date().toLocaleString('pt-BR')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Resultado */}
          {agendaResultado && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <h3 className="text-lg font-semibold text-green-800">Sucesso!</h3>
              </div>
              
              <p className="text-green-700 mb-3">{agendaResultado.dados.message}</p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {agendaResultado.tipo === 'ano' ? (
                  <>
                    <div>
                      <span className="font-medium">Meses processados:</span>
                      <span className="ml-2">{agendaResultado.dados.mesesProcessados}</span>
                    </div>
                    <div>
                      <span className="font-medium">Sucessos:</span>
                      <span className="ml-2 text-green-600">{agendaResultado.dados.sucessos}</span>
                    </div>
                    <div>
                      <span className="font-medium">Erros:</span>
                      <span className="ml-2 text-red-600">{agendaResultado.dados.erros}</span>
                    </div>
                    <div>
                      <span className="font-medium">Total de tarefas:</span>
                      <span className="ml-2 font-bold">{agendaResultado.dados.totalTarefasCriadas}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="font-medium">Período:</span>
                      <span className="ml-2">{agendaResultado.dados.mes}/{agendaResultado.dados.ano}</span>
                    </div>
                    <div>
                      <span className="font-medium">Tarefas criadas:</span>
                      <span className="ml-2 font-bold">{agendaResultado.dados.tarefasCriadas}</span>
                    </div>
                    <div>
                      <span className="font-medium">Responsável:</span>
                      <span className="ml-2">{agendaResultado.dados.responsavel}</span>
                    </div>
                  </>
                )}
              </div>

              {agendaResultado.dados.detalhes && agendaResultado.dados.detalhes.erros && agendaResultado.dados.detalhes.erros.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <h4 className="font-medium text-red-800 mb-2">Erros encontrados:</h4>
                  <ul className="list-disc list-inside text-red-700 text-sm">
                    {agendaResultado.dados.detalhes.erros.map((erro, index) => (
                      <li key={index}>Mês {erro.mes}: {erro.erro}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Erro */}
          {agendaError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <span className="text-red-800 font-medium">Erro</span>
              </div>
              <p className="text-red-700 mt-1">{agendaError}</p>
            </div>
          )}

          {/* Obrigações */}
          {showObrigacoes && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Obrigações Tributárias</h2>
                <button
                  onClick={carregarObrigacoes}
                  disabled={agendaLoading}
                  className="text-blue-600 hover:text-blue-700 flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${agendaLoading ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>

              {agendaLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-600">Carregando obrigações...</span>
                </div>
              ) : obrigacoes.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Nenhuma obrigação encontrada</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {obrigacoes.map((mesObj) => (
                    <div key={mesObj.mes} className="border rounded-lg">
                      <button
                        onClick={() => toggleMonth(mesObj.mes)}
                        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Calendar className="w-5 h-5 text-blue-600" />
                          <span className="font-semibold text-gray-800">
                            {mesObj.mesNome}
                          </span>
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                            {mesObj.totalObrigacoes} obrigações
                          </span>
                        </div>
                        {expandedMonths[mesObj.mes] ? 
                          <ChevronUp className="w-5 h-5 text-gray-500" /> : 
                          <ChevronDown className="w-5 h-5 text-gray-500" />
                        }
                      </button>

                      {expandedMonths[mesObj.mes] && (
                        <div className="p-4 border-t">
                          <div className="space-y-3">
                            {mesObj.obrigacoes.map((obrigacao, index) => (
                              <div key={index} className="bg-white border rounded-lg p-4">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <h4 className="font-medium text-gray-800 mb-2">
                                      {obrigacao.titulo}
                                    </h4>
                                    <p className="text-sm text-gray-600 mb-2">
                                      {obrigacao.observacoes}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-4 h-4 text-blue-600" />
                                      <span className="text-sm font-medium text-blue-600">
                                        Vencimento: dia {obrigacao.vencimento}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeView) {
      case "home":
        return renderCalendarView();
      case "tasks":
        return renderTaskManagerView();
      case "reports":
        return renderReportsView();
      case "agenda-tributaria":
        return renderAgendaTributariaView();
      default:
        return renderCalendarView();
    }
  };

  if (!currentUser) {
    return <div className="flex items-center justify-center h-screen">Carregando usuário...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div
        className={`sidebar bg-white border-r transition-all duration-300 flex flex-col flex-shrink-0 ${
          sidebarCollapsed ? "w-20" : "w-64"
        }`}
      >
        {/* Header da Sidebar */}
        <div className="sidebar-header p-4 border-b border-gray-100">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3">
              <div className="p-1 bg-blue-100 rounded-lg">
                <Calendar className="w-5 h-5 text-blue-600" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Sistema de Tarefas</h1>

              </div>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="flex justify-center">
              
            </div>
          )}
        </div>

        {/* Navegação */}
        <nav className="sidebar-nav flex-1 py-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-3 mx-0 px-3 py-3 rounded-lg text-left transition-all duration-200 group ${
                  activeView === item.id
                    ? "bg-blue-50 text-blue-700 shadow-sm border border-blue-100"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                title={sidebarCollapsed ? item.label : ""}
                aria-label={item.label}
              >
                <div className={`p-1.5 rounded-md transition-colors ${
                  activeView === item.id
                    ? ""
                    : "text-gray-500 group-hover:bg-gray-100 group-hover:text-gray-700"
                }`}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </div>
                {!sidebarCollapsed && (
                  <div className="flex flex-col justify-center min-w-0 flex-1">
                    <span className="font-medium text-sm truncate">{item.label}</span>
                    <span className="text-xs opacity-75 truncate">{item.description}</span>
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer da Sidebar */}
        <div className="p-4 border-t border-gray-100">
          {!sidebarCollapsed && (
            <button
              onClick={minimizeSidebar}
              className="w-full flex items-center justify-center gap-2 p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm"
              title="Minimizar Sidebar"
              aria-label="Minimizar Sidebar"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              <span></span>
            </button>
          )}
          {sidebarCollapsed && (
            <button
              onClick={maximizeSidebar}
              className="w-full flex items-center justify-center p-2.5 text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors shadow-sm"
              title="Maximizar Sidebar"
              aria-label="Maximizar Sidebar"
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                {menuItems.find((item) => item.id === activeView)?.label || "Home"}
              </h2>
              <p className="text-sm text-gray-600">
                {menuItems.find((item) => item.id === activeView)?.description || "Calendário principal"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4">
                <User className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{currentUser.nome}</span>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    isAdmin ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {isAdmin ? "Admin" : "Colaborador"}
                </span>
                <button
                  onClick={() => navigate("/home")}
                  className="p-1 hover:bg-gray-100 rounded transition-colors text-blue-600"
                  title="Voltar para Home"
                >
                  <Home className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors text-red-600"
                  title="Sair"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {renderContent()}

        {showTaskModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" ref={modalRef}>
              <div className="flex items-center justify-between p-6 border-b">
                <h3 className="text-lg font-semibold text-gray-800">Nova Tarefa</h3>
                <button onClick={() => handleCloseModal("task")} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Título da tarefa"
                    value={newTask.titulo}
                    onChange={(e) => setNewTask({ ...newTask, titulo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsável</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newTask.responsavelId}
                    onChange={(e) => {
                      const usuario = usuarios.find((u) => u.id === e.target.value);
                      setNewTask({
                        ...newTask,
                        responsavelId: e.target.value,
                        responsavel: usuario ? usuario.nome : "",
                      });
                    }}
                  >
                    <option value="">Selecione um responsável</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.id === user?.uid ? "(Eu)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Vencimento</label>
                  <input
                    type="date"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={newTask.dataVencimento}
                    onChange={(e) => setNewTask({ ...newTask, dataVencimento: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows="3"
                    placeholder="Observações da tarefa"
                    value={newTask.observacoes}
                    onChange={(e) => setNewTask({ ...newTask, observacoes: e.target.value })}
                  ></textarea>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"></label>
                  <input
                    type="checkbox"
                    className="mr-2 leading-tight"
                    checked={newTask.recorrente}
                    onChange={(e) => setNewTask({ ...newTask, recorrente: e.target.checked })}
                  />
                  <span>Recorrente</span>
                </div>
                {newTask.recorrente && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Frequência</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={newTask.frequencia}
                      onChange={(e) => setNewTask({ ...newTask, frequencia: e.target.value })}
                    >
                      <option value="mensal">Mensal</option>
                      <option value="semanal">Semanal</option>
                      <option value="diario">Diário</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 p-6 border-t">
                <button
                  onClick={() => handleCloseModal("task")}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateTask}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Criar Tarefa
                </button>
              </div>
            </div>
          </div>
        )}

        {showTaskDetails && selectedTask && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-sm max-h-sm overflow-y-auto mx-4">
              <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-full ${statusColors[selectedTask.status]}`}>
                    {statusIcons[selectedTask.status]}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{selectedTask.titulo}</h3>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedTask.status]} mt-1`}>
                      {statusLabels[selectedTask.status]}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={() => handleCloseModal("details")} 
                  className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                  title="Fechar detalhes"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4">
                <div className="space-y-4">
                  {/* Informações da Tarefa */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-md font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      Informações da Tarefa
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-600 mb-1">Responsável:</span>
                        <div className="flex items-center gap-2">
                          <User className="w-3 h-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-800">{selectedTask.responsavel}</span>
                          {selectedTask.responsavelId === user?.uid && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full">Você</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-600 mb-1">Data de Vencimento:</span>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span className={`text-sm font-medium ${
                            selectedTask.dataVencimento && new Date(selectedTask.dataVencimento) < new Date() && selectedTask.status !== 'finalizado'
                              ? 'text-red-600' : 'text-gray-800'
                          }`}>
                            {selectedTask.dataVencimento ? new Date(selectedTask.dataVencimento).toLocaleDateString("pt-BR") : "Data não definida"}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-600 mb-1">Status:</span>
                        {isAdmin || selectedTask.responsavelId === user?.uid ? (
                          <select
                            className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-medium"
                            value={selectedTask.status}
                            onChange={(e) => handleUpdateTaskStatus(selectedTask.id, e.target.value)}
                          >
                            <option value="pendente">Pendente</option>
                            <option value="em_andamento">Em Andamento</option>
                            <option value="finalizado">Finalizado</option>
                          </select>
                        ) : (
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedTask.status]} w-fit`}>
                            {statusIcons[selectedTask.status]}
                            <span className="ml-1">{statusLabels[selectedTask.status]}</span>
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-600 mb-1">Data de Criação:</span>
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-800">
                            {selectedTask.dataCriacao ? new Date(selectedTask.dataCriacao).toLocaleDateString("pt-BR") : "Data não definida"}
                          </span>
                        </div>
                      </div>
                      
                      {selectedTask.recorrente && (
                        <div className="flex flex-col md:col-span-2">
                          <span className="text-xs font-medium text-blue-700 mb-1">Tarefa Recorrente:</span>
                          <span className="text-sm font-medium text-blue-800 capitalize bg-blue-50 px-2 py-1 rounded w-fit">{selectedTask.frequencia}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Observações */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-md font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                      Observações
                    </h4>
                    <div className="bg-gray-50 p-3 rounded-md border-l-4 border-blue-500">
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {selectedTask.observacoes || "Nenhuma observação foi adicionada para esta tarefa."}
                      </p>
                    </div>
                  </div>

                  {/* Comprovantes */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-md font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <Upload className="w-4 h-4 text-green-600" />
                      Comprovantes
                      <span className="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                        {selectedTask.comprovantes?.length || 0} arquivo(s)
                      </span>
                    </h4>
                    
                    {(isAdmin || selectedTask.responsavelId === user?.uid) && (
                      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <label className="block text-xs font-medium text-blue-800 mb-2">
                          Adicionar novo comprovante:
                        </label>
                        <input
                          type="file"
                          className="w-full p-2 text-sm border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                          onChange={(e) => handleFileUpload(selectedTask.id, e.target.files[0])}
                          accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                        />
                        <p className="text-xs text-blue-600 mt-1">
                          Formatos aceitos: JPG, PNG, PDF, DOC, XLS, TXT, CSV (máx. 10MB)
                        </p>
                        
                        {/* Preview e controles de upload inline */}
                        {selectedFile && selectedFile.taskId === selectedTask.id && (
                          <div className="mt-4 p-4 bg-white border border-blue-300 rounded-lg">
                            <h5 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                              <Upload className="w-4 h-4 text-blue-600" />
                              Preview do Arquivo
                            </h5>
                            
                            {fileError ? (
                              <div className="text-red-600 mb-4 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-600" />
                                <span className="text-sm">{fileError}</span>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex-shrink-0">
                                    {getFileIcon(filePreview?.fileType || selectedFile.file.type)}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-800">
                                      {filePreview?.name || selectedFile.file.name}
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      {formatFileSize(filePreview?.size || selectedFile.file.size)}
                                    </p>
                                  </div>
                                </div>
                                
                                {filePreview?.type === "image" && (
                                  <div className="border rounded-lg overflow-hidden">
                                    <img
                                      src={filePreview.url}
                                      alt="Preview"
                                      className="max-w-full max-h-32 mx-auto"
                                    />
                                  </div>
                                )}
                                
                                {/* Barra de progresso */}
                                {isUploading && (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600">Enviando arquivo...</span>
                                      <span className="text-blue-600 font-medium">{uploadProgress}%</span>
                                    </div>
                                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all duration-300 ${
                                          uploadProgress === 100
                                            ? "bg-green-500"
                                            : "bg-blue-500"
                                        }`}
                                        style={{ width: `${uploadProgress}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                )}
                                
                                {/* Status de upload */}
                                {uploadStatus === 'completed' && (
                                  <div className="flex items-center gap-2 text-green-600">
                                    <CheckCircle className="w-4 h-4" />
                                    <span className="text-sm font-medium">Arquivo enviado com sucesso!</span>
                                  </div>
                                )}
                                
                                {uploadStatus === 'error' && (
                                  <div className="flex items-center gap-2 text-red-600">
                                    <XCircle className="w-4 h-4" />
                                    <span className="text-sm font-medium">Erro no upload</span>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Botões de ação */}
                            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-gray-200">
                              <button
                                onClick={handleCancelUpload}
                                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                                disabled={isUploading}
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleConfirmUpload}
                                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center gap-1"
                                disabled={isUploading || !!fileError}
                              >
                                {isUploading ? (
                                  <>
                                    <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                    Enviando...
                                  </>
                                ) : (
                                  <>
                                    <Upload className="w-3 h-3" />
                                    Confirmar Upload
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTask.comprovantes && selectedTask.comprovantes.length > 0 ? (
                        selectedTask.comprovantes.map((proof, index) => {
                          // Lidar com comprovantes antigos (strings) e novos (objetos)
                          const fileUrl = typeof proof === 'string' ? proof : proof.url;
                          const fileName = typeof proof === 'string' ? proof.split("/").pop() : proof.name;
                          const fileType = typeof proof === 'string' ? 'unknown' : proof.type;
                          const fileSize = typeof proof === 'string' ? null : proof.size;
                          const uploadDate = typeof proof === 'string' ? null : proof.uploadDate;
                          const uploadedBy = typeof proof === 'string' ? null : proof.uploadedBy;
                          
                          return (
                            <div key={index} className="group flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all duration-200 border border-gray-200">
                              <div className="flex-shrink-0">
                                {getFileIcon(fileType)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-gray-800 truncate" title={fileName}>
                                    {fileName}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                  {fileSize && (
                                    <span className="flex items-center gap-1">
                                      <File className="w-3 h-3" />
                                      {formatFileSize(fileSize)}
                                    </span>
                                  )}
                                  {uploadDate && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {new Date(uploadDate).toLocaleDateString('pt-BR')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = fileUrl;
                                    link.download = fileName;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  className="p-1.5 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-full transition-colors"
                                  title="Baixar arquivo"
                                >
                                  <Download className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-6">
                          <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-gray-500 text-xs">
                            Nenhum comprovante anexado ainda.
                          </p>
                          {(isAdmin || selectedTask.responsavelId === user?.uid) && (
                            <p className="text-gray-400 text-xs mt-1">
                              Use o campo acima para adicionar arquivos.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between gap-3 p-4 border-t bg-gray-50">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Bell className="w-3 h-3" />
                  {selectedTask.dataVencimento && new Date(selectedTask.dataVencimento) < new Date() && selectedTask.status !== 'finalizado' ? (
                    <span className="text-red-600 font-medium">⚠️ Tarefa em atraso</span>
                  ) : selectedTask.dataVencimento && new Date(selectedTask.dataVencimento).getTime() - new Date().getTime() < 24 * 60 * 60 * 1000 && selectedTask.status !== 'finalizado' ? (
                    <span className="text-yellow-600 font-medium">⏰ Vence em breve</span>
                  ) : (
                    <span>Última atualização: {new Date().toLocaleDateString('pt-BR')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCloseModal("details")}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    Fechar
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => handleEditTask(selectedTask)}
                        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center gap-2"
                      >
                        <Edit className="w-3 h-3" />
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteTask(selectedTask.id)}
                        className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center gap-2"
                      >
                        <Trash2 className="w-3 h-3" />
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {showEditTaskModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" ref={modalRef}>
              <div className="flex items-center justify-between p-6 border-b">
                <h3 className="text-lg font-semibold text-gray-800">Editar Tarefa</h3>
                <button onClick={() => handleCloseModal("edit")} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Título da tarefa"
                    value={editTask.titulo}
                    onChange={(e) => setEditTask({ ...editTask, titulo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsável</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={editTask.responsavelId}
                    onChange={(e) => {
                      const usuario = usuarios.find((u) => u.id === e.target.value);
                      setEditTask({
                        ...editTask,
                        responsavelId: e.target.value,
                        responsavel: usuario ? usuario.nome : "",
                      });
                    }}
                  >
                    <option value="">Selecione um responsável</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.id === user?.uid ? "(Eu)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Vencimento</label>
                  <input
                    type="date"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={editTask.dataVencimento}
                    onChange={(e) => setEditTask({ ...editTask, dataVencimento: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows="3"
                    placeholder="Observações da tarefa"
                    value={editTask.observacoes}
                    onChange={(e) => setEditTask({ ...editTask, observacoes: e.target.value })}
                  ></textarea>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"></label>
                  <input
                    type="checkbox"
                    className="mr-2 leading-tight"
                    checked={editTask.recorrente}
                    onChange={(e) => setEditTask({ ...editTask, recorrente: e.target.checked })}
                  />
                  <span>Recorrente</span>
                </div>
                {editTask.recorrente && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Frequência</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={editTask.frequencia}
                      onChange={(e) => setEditTask({ ...editTask, frequencia: e.target.value })}
                    >
                      <option value="mensal">Mensal</option>
                      <option value="semanal">Semanal</option>
                      <option value="diario">Diário</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 p-6 border-t">
                <button
                  onClick={() => handleCloseModal("edit")}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateTask}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Atualizar Tarefa
                </button>
              </div>
            </div>
          </div>
        )}

        {showLogoutConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-xs mx-3 p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Confirmar Logout</h3>
              <p className="text-gray-600 text-sm mb-4 text-center">Tem certeza de que deseja sair?</p>
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => handleCloseModal("logout")}
                  className="px-3 py-1 text-gray-600 hover:text-gray-800 transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Calendario;
