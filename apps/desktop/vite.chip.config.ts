import { defineConfig } from 'vite-plus'

/*
 * A page canvas's chip beside a conversation (src/overlay/chip.ts): one
 * script, which the main process runs in an isolated world of the page, as
 * it runs the overlay in a page's and the ground in a canvas of boards'.
 * Built on its own, as they are; no styles of its own outside its shadow
 * root, so nothing of it reaches the page.
 */
export default defineConfig({
  build: {
    outDir: 'dist/overlay',
    emptyOutDir: false,
    target: 'chrome140',
    minify: false,
    rollupOptions: {
      input: { chip: 'src/overlay/chip.ts' },
      output: { format: 'iife', entryFileNames: '[name].js' },
    },
  },
})
