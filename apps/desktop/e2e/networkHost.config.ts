import { defineConfig } from 'vite-plus'

/** Use the production host's bundling rules, including UMD dependencies and native Sharp resolution. */
export default defineConfig({
  build: {
    ssr: 'e2e/networkHost.ts',
    outDir: 'test-results/network-host',
    target: 'node24',
    rollupOptions: { external: ['sharp'], output: { entryFileNames: 'network-host.js' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
