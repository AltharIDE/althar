import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

/* One config for the workbench (vp dev), the tests, and Storybook, which
   reads it for plugins and CSS modules. */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: mode === 'production' ? '[local]_[hash:base64:5]' : '[name]__[local]__[hash:base64:4]',
    },
  },
  server: { port: 5310, strictPort: true },
  test: {
    ...testing('small'),
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // The shared setup (@althar/testing), then this package's own.
    setupFiles: ['@althar/testing/setup', 'tests/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      // Stories and the workbench are examples, exercised by rendering every story; the components carry the gate.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.stories.tsx', 'src/fixtures/**', 'src/storybook/**', 'src/index.ts'],
      reporter: ['text', 'html'],
      // Checked when a test fails too, so a run that only quarantined tests fail still gates on it (@althar/testing).
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
}))
