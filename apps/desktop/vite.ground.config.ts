import { defineConfig } from 'vite-plus'

/*
 * The ground of a canvas of boards (src/overlay/ground.ts): one script, which
 * the main process runs in an isolated world of a canvas's view, as it runs
 * the overlay in a page's. Built on its own, as the overlay is, since one
 * build can't make two scripts that share code without splitting them.
 */
export default defineConfig({
  build: {
    outDir: 'dist/overlay',
    emptyOutDir: false,
    target: 'chrome140',
    minify: false,
    rollupOptions: {
      input: { ground: 'src/overlay/ground.ts' },
      output: { format: 'iife', entryFileNames: '[name].js' },
    },
  },
})
