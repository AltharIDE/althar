import { builtinModules } from 'node:module'

import { defineConfig } from 'vite-plus'

/*
 * The parts that run on Electron's Node: the main process and the runtime's
 * utility process, as ES modules. Everything is inlined but Electron and
 * Node's own modules, since Node can't run the workspace's TypeScript as it
 * is. The agent adapters stay packages: they run as processes of their own.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      input: { 'main/main': 'src/main/main.ts', 'runtime/runtime': 'src/runtime/runtime.ts' },
      external: ['electron', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
