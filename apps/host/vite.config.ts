import { defineConfig, loadEnv } from 'vite-plus'
import { testing } from '@althar/testing/vitest'
import { releaseLicenses } from './scripts/release-licenses'

/*
 * The public ids of Althar's own apps on code hosts, for a home's sign-in by a code the person types in any browser, from
 * the environment or apps/host/.env; the release workflow gives the repository variables of the same names. None is a
 * secret. A home leaves out Linear's, whose browser comes back to the computer it runs on (src/home.ts).
 */
const env = loadEnv('production', import.meta.dirname, 'ALTHAR_')
const signIn = {
  github: env.ALTHAR_GITHUB_CLIENT_ID ?? '',
  githubApp: env.ALTHAR_GITHUB_APP ?? '',
  gitlab: env.ALTHAR_GITLAB_CLIENT_ID ?? '',
  linear: '',
  copilot: env.ALTHAR_COPILOT_CLIENT_ID || 'Ov23liI3MfkqFXCKYuNh',
}

export default defineConfig({
  plugins: [releaseLicenses()],
  define: { __ALTHAR_SIGN_IN__: JSON.stringify(signIn) },
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node24',
    rollupOptions: { external: ['sharp', 'node-pty'], output: { entryFileNames: 'althar-host.js', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
  test: {
    ...testing('medium'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    silent: 'passed-only',
    coverage: {
      include: ['src/**/*.ts'],
      // Only process wiring; the command runner is covered directly and the built entry is exercised by process tests.
      exclude: ['src/main.ts', 'src/worker.ts'],
      reporter: ['text', 'html'],
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
