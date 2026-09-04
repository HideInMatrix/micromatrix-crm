import { fileURLToPath, URL } from 'node:url'
import { VantResolver } from '@vant/auto-import-resolver'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, type Plugin } from 'vite'

function mobileBaseRedirectPlugin(): Plugin {
  return {
    name: 'micromatrix-mobile-base-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (url === '/mobile' || url.startsWith('/mobile?')) {
          const query = url.slice('/mobile'.length)
          res.statusCode = 302
          res.setHeader('Location', `/mobile/${query}`)
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/mobile/',
  plugins: [
    mobileBaseRedirectPlugin(),
    vue(),
    UnoCSS(),
    AutoImport({
      resolvers: [VantResolver()],
      dts: 'src/types/auto-imports.d.ts',
    }),
    Components({
      resolvers: [VantResolver()],
      dts: 'src/types/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@micromatrix/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
