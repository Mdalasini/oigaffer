import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { flagServer } from './tools/flagServer'

export default defineConfig({
  plugins: [react(), flagServer()],
})
