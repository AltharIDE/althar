import type { CoverageProviderModule, ResolvedCoverageOptions, Vitest } from 'vite-plus/test/node'

/*
 * Coverage that measures nothing, and whose thresholds, when there are any, are never met: it fails the run as
 * Vitest's coverage gate does, so a test can see whether that gate was checked.
 */
export default {
  getProvider: () => {
    let options: ResolvedCoverageOptions | undefined
    return {
      name: 'never-met',
      initialize: (vitest: Vitest) => {
        options = vitest.config.coverage
      },
      resolveOptions: () => options!,
      clean: () => {},
      onAfterSuiteRun: () => {},
      generateCoverage: () => ({}),
      reportCoverage: () => {
        if (options?.thresholds !== undefined) process.exitCode = 1
      },
    }
  },
} satisfies CoverageProviderModule
