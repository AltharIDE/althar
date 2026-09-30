import { defineConfig } from 'vite-plus'

/* The window's preload script. A sandboxed preload must be CommonJS. */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/preload',
    emptyOutDir: false,
    target: 'node24',
    rollupOptions: {
      input: { preload: 'src/preload/preload.ts' },
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: '[name].cjs' },
    },
  },
})
