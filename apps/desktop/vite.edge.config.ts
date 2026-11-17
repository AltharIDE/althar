import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

const pages = join(import.meta.dirname, 'src/renderer')

/*
 * The edge of the screen (the island round the notch, or the menu bar's
 * sheet), a page of its own, built apart from the window's (vite.config.ts)
 * after it, into the same folder. It uses a few of the kit's parts and of
 * the window's, through modules that hold far more: built with the window,
 * it shared one chunk with it and loaded the whole kit, 2 MB of script and
 * 445 kB of styles, as Althar starts. Here what it doesn't use is left out:
 * the kit's and the window's own modules are taken to do nothing as they
 * load but their styles, which is how they are written.
 */
const OURS = /[\\/](?:packages[\\/]ui[\\/]src|apps[\\/]desktop[\\/]src[\\/]renderer)[\\/]/

export default defineConfig(({ mode }) => ({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  // The window's build puts what both pages share from public/ there already.
  publicDir: false,
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: false,
    target: 'chrome140',
    sourcemap: true,
    rollupOptions: {
      input: { edge: join(pages, 'edge.html') },
      // Styles always do something as they load; the kit's and the window's modules only where their exports are used.
      treeshake: { moduleSideEffects: (id: string) => (id.endsWith('.css') ? true : OURS.test(id) ? false : undefined) },
    },
  },
}))
