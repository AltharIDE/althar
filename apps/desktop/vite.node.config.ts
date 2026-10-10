import { builtinModules } from 'node:module'

import { defineConfig } from 'vite-plus'

/*
 * The parts that run on Electron's Node: the main process, the runtime's
 * utility process and dictation's speech process, as ES modules. Everything
 * is inlined but Electron and Node's own modules, since Node can't run the
 * workspace's TypeScript as it is. The agent adapters stay packages: they run
 * as processes of their own. So does sherpa-onnx, a native addon that finds
 * its binaries beside it in node_modules. Transformers stays external too: its
 * ONNX runtime and tokenizer resources resolve relative to its package.
 */
export default defineConfig(({ mode }) => ({
  // A packaged build leaves out the end-to-end tests' hooks, such as the fake agents.
  define: { __ALTHAR_TEST_HOOKS__: JSON.stringify(mode !== 'package') },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      input: { 'main/main': 'src/main/main.ts', 'runtime/runtime': 'src/runtime/runtime.ts', 'speech/speech': 'src/speech/speech.ts' },
      external: [
        'electron',
        'sherpa-onnx-node',
        '@huggingface/transformers',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
}))
