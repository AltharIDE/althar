import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The ship lab (lab/ship/README.md): the app's real task screen, drawn from
 * the moments a task with a pull request goes through from Ship to merged,
 * with no runtime behind it. Each direction changes only the Change card's
 * buttons and lines: the task's Outputs import the kit through ui.tsx here.
 */

const outputs = join(import.meta.dirname, '../../src/renderer/features/task/Outputs.tsx')

const directed: Plugin = {
  name: 'ship-lab-directions',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@althar/ui' && importer === outputs) return join(import.meta.dirname, 'ui.tsx')
    return null
  },
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [directed, react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  // The fixtures take only a clock from the testing package, whose files helpers need Node.
  resolve: {
    alias: {
      vitest: join(import.meta.dirname, 'vitest.ts'),
      '@althar/testing': join(import.meta.dirname, '../../../../packages/testing/src/time.ts'),
    },
  },
  server: { port: 6133, strictPort: true },
})
