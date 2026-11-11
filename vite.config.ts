import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@content': resolve(__dirname, 'content')
    }
  },
  // VITE_BASE_URL=/kteq-web55/ while on the project URL, / once kteq.org DNS is live
  base: process.env.VITE_BASE_URL || '/'
})
