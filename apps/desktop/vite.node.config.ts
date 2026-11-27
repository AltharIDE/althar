import { builtinModules } from 'node:module'

import { defineConfig, loadEnv } from 'vite-plus'

/*
 * The parts that run on Electron's Node: the main process, the runtime's
 * utility process and dictation's speech process, as ES modules. Everything
 * is inlined but Electron and Node's own modules, since Node can't run the
 * workspace's TypeScript as it is. The agent adapters stay packages: they run
 * as processes of their own. So does sherpa-onnx, a native addon that finds
 * its binaries beside it in node_modules, as node-pty, the terminals'
 * pseudo-terminals, does, and electron-updater, whose
 * CommonJS would otherwise share a chunk with the runtime's process.
 */
/** PostHog's project key and host for usage data (src/main/usageData.ts), for a packaged build; empty for any other. */
const usageFor = (mode: string) => {
  const env = mode === 'package' ? loadEnv(mode, import.meta.dirname, 'ALTHAR_POSTHOG_') : {}
  return { key: env.ALTHAR_POSTHOG_KEY ?? '', host: env.ALTHAR_POSTHOG_HOST ?? '' }
}

/**
 * The public ids of Althar's own apps on code hosts and trackers, for their browser sign-in, from the environment or
 * apps/desktop/.env; the release workflow gives the repository variables of the same names. An empty one leaves its
 * service to gh's or glab's sign-in and a pasted token. None is a secret: each is in every build of the app.
 */
const signInFor = (mode: string) => {
  const env = loadEnv(mode, import.meta.dirname, 'ALTHAR_')
  return {
    github: env.ALTHAR_GITHUB_CLIENT_ID ?? '',
    githubApp: env.ALTHAR_GITHUB_APP ?? '',
    gitlab: env.ALTHAR_GITLAB_CLIENT_ID ?? '',
    linear: env.ALTHAR_LINEAR_CLIENT_ID ?? '',
    // Copilot's own app, never the GitHub App sign-in's: its token is the OAuth app's, which Copilot takes.
    copilot: env.ALTHAR_COPILOT_CLIENT_ID || 'Ov23liI3MfkqFXCKYuNh',
  }
}

export default defineConfig(({ mode }) => ({
  define: {
    // A packaged build leaves out the end-to-end tests' hooks, such as the fake agents.
    __ALTHAR_TEST_HOOKS__: JSON.stringify(mode !== 'package'),
    // Only a packaged build is given PostHog's key, from the environment or apps/desktop/.env, so no other build sends usage data.
    __ALTHAR_USAGE__: JSON.stringify(usageFor(mode)),
    // Where reports go (src/main/report): the Worker's address and the mail's, as the build is given them; the environment can say otherwise at run time.
    __ALTHAR_REPORT_URL__: JSON.stringify(process.env.ALTHAR_REPORT_URL ?? ''),
    __ALTHAR_REPORT_EMAIL__: JSON.stringify(process.env.ALTHAR_REPORT_EMAIL ?? 'reports@althar.ai'),
    // Public application identity travels with the app; people signing in never have to configure an environment variable.
    __ALTHAR_SIGN_IN__: JSON.stringify(signInFor(mode)),
  },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      // The main process and the runtime start from a file that keeps V8's compiled code first, then loads the rest (compileCache.ts).
      input: {
        'main/main': 'src/main/boot.ts',
        'runtime/runtime': 'src/runtime/boot.ts',
        'speech/speech': 'src/speech/speech.ts',
        'connection/connection': 'src/connection/connection.ts',
        'computer/worker': 'src/computer/worker.ts',
      },
      external: [
        'sharp',
        'electron',
        'sherpa-onnx-node',
        'node-pty',
        'electron-updater',
        '@trycua/cua-driver',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        // What the processes share of the packages and their dependencies goes in one chunk. Left to itself, Rolldown can split
        // it into chunks that import each other, and one then runs before what it needs from the other is defined.
        codeSplitting: { groups: [{ name: 'shared', test: /node_modules|[\\/]packages[\\/]/, minShareCount: 2 }] },
      },
    },
  },
  ssr: { noExternal: true, target: 'node' },
}))
