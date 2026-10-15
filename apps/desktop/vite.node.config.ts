import { builtinModules } from 'node:module'

import { defineConfig, loadEnv } from 'vite-plus'

/*
 * The parts that run on Electron's Node: the main process, the runtime's
 * utility process and dictation's speech process, as ES modules. Everything
 * is inlined but Electron and Node's own modules, since Node can't run the
 * workspace's TypeScript as it is. The agent adapters stay packages: they run
 * as processes of their own. So does sherpa-onnx, a native addon that finds
 * its binaries beside it in node_modules, and electron-updater, whose
 * CommonJS would otherwise share a chunk with the runtime's process.
 */
/** PostHog's project key and host for usage data (src/main/usageData.ts), for a packaged build; empty for any other. */
const usageFor = (mode: string) => {
  const env = mode === 'package' ? loadEnv(mode, import.meta.dirname, 'ALTHAR_POSTHOG_') : {}
  return { key: env.ALTHAR_POSTHOG_KEY ?? '', host: env.ALTHAR_POSTHOG_HOST ?? '' }
}

export default defineConfig(({ mode }) => ({
  define: {
    // A packaged build leaves out the end-to-end tests' hooks, such as the fake agents.
    __ALTHAR_TEST_HOOKS__: JSON.stringify(mode !== 'package'),
    // Only a packaged build is given PostHog's key, from the environment or apps/desktop/.env, so no other build sends usage data.
    __ALTHAR_USAGE__: JSON.stringify(usageFor(mode)),
  },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      input: { 'main/main': 'src/main/main.ts', 'runtime/runtime': 'src/runtime/runtime.ts', 'speech/speech': 'src/speech/speech.ts' },
      external: ['electron', 'sherpa-onnx-node', 'electron-updater', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
}))
