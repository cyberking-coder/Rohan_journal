import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://<user>.github.io/rohan_journal/ on GitHub Pages,
// but from root during local dev.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/rohan_journal/' : '/',
  server: { port: 5173, host: true },
}))
