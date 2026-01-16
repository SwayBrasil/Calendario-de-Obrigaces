// Serviço de API para o backend do RPA Domínio (agora integrado no mesmo backend)
import axios from 'axios';
import { getAuthToken } from '../utils/tokenUtils';

// Usa o mesmo backend do Calendário de Obrigações
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Criar instância do axios para o RPA Domínio
const rpaApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 120 segundos para processar PDFs grandes
});

// Interceptor para adicionar token de autenticação
rpaApi.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Funções de API do RPA Domínio
export const rpaService = {
  // Criar comparação
  criarComparacao: async (params) => {
    const form = new FormData();
    form.append('periodo_inicio', params.periodo_inicio || params.data_inicio);
    form.append('periodo_fim', params.periodo_fim || params.data_fim);
    
    // Arquivos Otimiza (múltiplos)
    if (params.otimiza_txt_files && params.otimiza_txt_files.length > 0) {
      params.otimiza_txt_files.forEach(file => {
        form.append('otimiza', file);
      });
    }
    
    // Arquivo MPDS (extrato bancário)
    if (params.mpds_pdf) {
      form.append('mpds', params.mpds_pdf);
    } else if (params.mpds_file) {
      form.append('mpds', params.mpds_file);
    }

    const { data } = await rpaApi.post('/api/comparacoes', form, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return data;
  },

  // Listar comparações
  listarComparacoes: async () => {
    const { data } = await rpaApi.get('/api/comparacoes');
    return data;
  },

  // Obter comparação por ID
  obterComparacao: async (id) => {
    const { data } = await rpaApi.get(`/api/comparacoes/${id}`);
    return data;
  },

  // Deletar comparação
  deletarComparacao: async (id) => {
    await rpaApi.delete(`/api/comparacoes/${id}`);
  },

  // Aguardar conclusão da comparação (polling)
  aguardarComparacao: async (id, intervaloInicial = 2000, timeoutMs = 300000) => {
    const inicio = Date.now();
    let intervalo = intervaloInicial;
    const maxIntervalo = 10000;
    let retries = 0;
    const maxRetries = 3;
    
    while (true) {
      try {
        const detalhe = await rpaService.obterComparacao(id);
        retries = 0;
        
        if (detalhe.status === 'concluida') {
          return detalhe;
        }
        
        if (detalhe.status === 'erro') {
          throw new Error(detalhe.erro || 'Erro no processamento da comparação');
        }
        
        if (detalhe.status === 'timeout') {
          throw new Error(detalhe.erro || 'Processamento demorou muito. Tente um PDF menor.');
        }
        
        if (Date.now() - inicio > timeoutMs) {
          throw new Error('Timeout: processamento demorou mais que o esperado');
        }
        
        await new Promise(resolve => setTimeout(resolve, intervalo));
        intervalo = Math.min(intervalo * 1.5, maxIntervalo);
        
      } catch (error) {
        const axiosError = error;
        if (axiosError.code === 'ERR_NETWORK' && retries < maxRetries) {
          retries++;
          console.warn(`Erro de rede, tentativa ${retries}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }
  }
};

export default rpaService;

