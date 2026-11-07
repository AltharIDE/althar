import { defineConfig } from 'vite-plus'

/*
 * Point and comment's overlay (src/overlay): one script, which the main
 * process runs in a page's isolated world beside the conversation. A script
 * with no imports or exports of its own, wrapped in a function, so running
 * it again in a world that has it declares nothing twice.
 */
export default defineConfig({
  build: {
    outDir: 'dist/overlay',
    emptyOutDir: false,
    target: 'chrome140',
    minify: false,
    rollupOptions: {
      input: { overlay: 'src/overlay/overlay.ts' },
      output: { format: 'iife', entryFileNames: '[name].js' },
    },
  },
})
