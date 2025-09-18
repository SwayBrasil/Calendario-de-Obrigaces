// src/utils/axiosConfig.js
import axios from 'axios';

const backendFromEnv = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')
  : '';

const isProd = typeof window !== 'undefined' &&
  (window.location.hostname.includes('onrender.com') ||
   window.location.protocol === 'https:');

const baseURL = backendFromEnv || (isProd ? window.location.origin.replace(/\/+$/, '') : 'http://localhost:3001');

const axiosInstance = axios.create({
  baseURL,
  timeout: 15000,
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  console.log('[axios] baseURL:', axiosInstance.defaults.baseURL, '→', (config.method || 'GET').toUpperCase(), config.url);
  return config;
});

axiosInstance.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
      localStorage.removeItem('rememberedEmail');
      localStorage.removeItem('rememberedPassword');
      if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.href = '/';
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
