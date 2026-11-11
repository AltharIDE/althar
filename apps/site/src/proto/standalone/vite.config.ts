import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The prototype as one page with everything in it, to share as a link:
 * `bun run proto:share` builds it here, and inline.ts folds its script, its
 * styles, its fonts and its pictures into one file. Deleted with src/proto.
 */

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  define: { 'import.meta.env.BUILT_ON': JSON.stringify(new Date().toISOString().slice(0, 10)) },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[local]_[hash:base64:5]' } },
  build: {
    outDir: resolve(import.meta.dirname, '../../../dist/proto'),
    emptyOutDir: true,
    target: 'baseline-widely-available',
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
