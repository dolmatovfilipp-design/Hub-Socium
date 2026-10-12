import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const apiProxy = {
  // covers /v1/media/* (avatars + post photos) and the rest of the API
  '/v1': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    ws: true,
  },
  '/healthz': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  },
}

/** Same-origin MediaPipe wasm. Camera frames never leave the browser. */
function mediapipeWasmPlugin(): Plugin {
  const copy = () => {
    const src = path.resolve('node_modules/@mediapipe/tasks-vision/wasm')
    const dest = path.resolve('public/mediapipe/wasm')
    if (!existsSync(src)) return
    mkdirSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true })
  }
  return {
    name: 'hub-mediapipe-wasm',
    buildStart: copy,
    configureServer: copy,
    configurePreviewServer: copy,
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mediapipeWasmPlugin()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: apiProxy,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: apiProxy,
  },
})
