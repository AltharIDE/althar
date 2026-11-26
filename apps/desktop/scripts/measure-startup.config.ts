import { defineConfig } from 'vite-plus'

/** Bundled by Vite, as the app's runtime is, so the store finds its migrations (`import.meta.glob`); Playwright and Electron stay outside. */
export default defineConfig({
  build: {
    ssr: 'scripts/measure-startup.ts',
    outDir: 'test-results/measure-startup',
    target: 'node24',
    rollupOptions: { external: ['@playwright/test', 'electron', 'sharp'], output: { entryFileNames: 'measure-startup.mjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
