import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'node' },
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } } });
