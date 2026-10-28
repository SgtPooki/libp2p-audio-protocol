import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https is required for microphone access on phones; accept the self-signed cert once.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  build: { target: 'es2022' }
})
