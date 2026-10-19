import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tailwind CSS v4 se integra como plugin de Vite (sin tailwind.config.js).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, open: false },
});
