// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Configuração para SPA (Single Page Application)
  build: {
    // Incluir arquivos do public/ no build
    copyPublicDir: true,
    rollupOptions: {
      // Não incluir _redirects no bundle, mas copiá-lo
      external: [],
    },
  },
  // Configuração para desenvolvimento local
  server: {
    // Fallback para index.html em desenvolvimento
    historyApiFallback: true,
  },
  // Configuração para preview
  preview: {
    // Fallback para index.html em preview
    historyApiFallback: true,
  },
});
