import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path:
//   - Railway / custom domain / local  -> served at root  ("/")
//   - GitHub Pages project site         -> served under "/rohan_journal/"
// The Pages workflow sets DEPLOY_TARGET=gh-pages; everything else uses root.
const base = process.env.DEPLOY_TARGET === 'gh-pages' ? '/rohan_journal/' : '/'

export default defineConfig({
  plugins: [react()],
  base,
  server: { port: 5173, host: true },
  preview: { host: true, allowedHosts: true },
})
