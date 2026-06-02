import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

function moduleHasSideEffects(id: string): boolean {
  const normalized = id.replaceAll('\\', '/')
  return normalized.endsWith('.css')
}

function manualChunks(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/')
  if (normalized.includes('/src/background/translator/providers/FreeDeepLTranslator.ts') ||
    normalized.includes('/src/background/translator/providers/DeepLTranslator.ts')) {
    return 'translator-deepl'
  }
  return undefined
}

export default defineConfig({
  resolve: {
    alias: {
      '#mini-jsx': resolve(projectRoot, 'src/ui/mini-jsx'),
    },
  },
  esbuild: {
    legalComments: 'none',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      treeshake: {
        preset: 'smallest',
        moduleSideEffects: moduleHasSideEffects,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
      input: {
        popup: resolve(projectRoot, 'popup.html'),
        sidepanel: resolve(projectRoot, 'sidepanel.html'),
        background: resolve(projectRoot, 'src/background/index.ts'),
        content: resolve(projectRoot, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        manualChunks,
      },
    },
  },
})
