import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/dependencies.json':  'http://localhost:8000',
      '/infrastructure.json': 'http://localhost:8000',
      '/tiles':               'http://localhost:8000',
      '/api':                 'http://localhost:8000',
      '/ws':                  { target: 'ws://localhost:8000', ws: true },
    },
  },
})
