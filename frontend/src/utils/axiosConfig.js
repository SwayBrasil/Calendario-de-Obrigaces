// src/utils/axiosConfig.js
import axios from 'axios';

// Detecta ambiente (prod = onrender.com ou https)
const isProd = typeof window !== 'undefined' &&
  (window.location.hostname.includes('onrender.com') ||
   window.location.protocol === 'https:');

// Base URL SEM "/api". O prefixo /api entra apenas nas rotas chamadas.
const defaultBaseURL = isProd
  ? window.location.origin               // ex: https://calendario-de-obrigacoes.onrender.com
  : 'http://localhost:3001';             // dev local

// Instância principal do axios
const axiosInstance = axios.create({
  baseURL: defaultBaseURL.replace(/\/+$/, ''), // remove barras finais
  timeout: 15000,
});

// Interceptor de request → adiciona token e log
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  console.log(
    '[axios] baseURL:',
    axiosInstance.defaults.baseURL,
    '→',
    config.method?.toUpperCase(),
    config.url
  );
  return config;
}, (e) => Promise.reject(e));

// Interceptor de response → trata erros comuns
axiosInstance.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      console.warn('[axios] 401: limpando sessão e redirecionando');
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
      localStorage.removeItem('rememberedEmail');
      localStorage.removeItem('rememberedPassword');
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.href = '/';
      }
    } else if (status === 403) {
      console.warn('[axios] 403: acesso negado');
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;

// Permite alterar dinamicamente a base (ex.: para testes)
export const setApiBase = (url) => {
  axiosInstance.defaults.baseURL = `${url}`.replace(/\/+$/, '');
  console.info('[axios] baseURL alterada para', axiosInstance.defaults.baseURL);
};
