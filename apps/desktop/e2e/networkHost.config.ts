import { defineConfig } from 'vite-plus'

/** Use the production host's bundling rules, including UMD dependencies and native Sharp resolution. */
export default defineConfig({
  // The ids apps/host/vite.config.ts bakes in, none here: the test home offers no browser sign-in.
  define: { __ALTHAR_SIGN_IN__: JSON.stringify({ github: '', githubApp: '', gitlab: '', linear: '', copilot: '' }) },
  build: {
    ssr: 'e2e/networkHost.ts',
    outDir: 'test-results/network-host',
    target: 'node24',
    rollupOptions: { external: ['sharp', 'node-pty'], output: { entryFileNames: 'network-host.js' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
