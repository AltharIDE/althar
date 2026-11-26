import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The ground of a canvas of boards (src/overlay/ground.ts): one script, which
 * the main process runs in an isolated world of a canvas's view, as it runs
 * the overlay in a page's. Built on its own, as the overlay is, since one
 * build can't make two scripts that share code without splitting them. Its
 * controls are the kit's, in React; their styles go in the page with it,
 * as the build puts them in the script.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/overlay',
    emptyOutDir: false,
    target: 'chrome140',
    // It carries React and the kit's controls now: small to read in again on every load of a canvas of boards.
    minify: true,
    rollupOptions: {
      input: { ground: 'src/overlay/ground.ts' },
      output: { format: 'iife', entryFileNames: '[name].js' },
    },
  },
})
