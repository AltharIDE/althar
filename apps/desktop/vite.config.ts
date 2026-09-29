import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* The window: a React app, loaded from a file, so its paths are relative. */
export default defineConfig(({ mode }) => ({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  // One bundle is right for a page read from disk; there is no network to split it for.
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome140', sourcemap: true, chunkSizeWarningLimit: 2_000 },
  test: {
    root: '.',
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      include: ['src/renderer/**/*.{ts,tsx}'],
      // The entry and the routes wire the app together; what they use is tested on its own, and the whole in the end-to-end tests.
      exclude: ['src/renderer/main.tsx', 'src/renderer/router.tsx', 'src/renderer/root.ts', 'src/renderer/features/*/route.tsx'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
}))
