// src/utils/axiosConfig.js
import axios from 'axios';

const isProd = typeof window !== 'undefined' &&
  (window.location.hostname.includes('onrender.com') ||
   window.location.protocol === 'https:');

// base SEM /api. A rota /api entra só nos caminhos das requisições.
const baseURL = isProd
  ? window.location.origin              // ex.: https://projeto-calendario.onrender.com
  : 'http://localhost:3001';            // dev local

const axiosInstance = axios.create({
  baseURL: baseURL.replace(/\/+$/, ''),
  timeout: 15000,
});

// DEBUG opcional: logar base e caminho de cada request
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  console.log('[axios] baseURL:', axiosInstance.defaults.baseURL, '→', config.method?.toUpperCase(), config.url);
  return config;
}, (e) => Promise.reject(e));

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

export const setApiBase = (url) => {
  axiosInstance.defaults.baseURL = `${url}`.replace(/\/+$/, '');
  console.info('[axios] baseURL alterada para', axiosInstance.defaults.baseURL);
};
