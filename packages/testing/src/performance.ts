import { scale } from './budget.ts'

/** What of a Vitest test's context measuring uses: its benchmarks, and its notes on the run. */
export interface Measuring {
  readonly bench: (name: string, run: () => unknown) => { readonly run: () => Promise<{ readonly latency: { readonly mean: number } }> }
  readonly annotate: (message: string, type: string) => Promise<unknown>
}

/**
 * How fast something is, for a package's performance run (`bun run test:performance`, Vitest's benchmarks in
 * `tests/*.bench.ts`), which gates nothing: no correctness test times what it runs (docs/plans/tests-that-hold.md, F).
 * Each case is benchmarked in turn and shown in the run's table; one whose mean is over its budget, in milliseconds and
 * scaled for the machine as test budgets are, is a warning on the run, never a failure.
 */
export const measure = async (context: Measuring, budget: number, cases: Readonly<Record<string, () => unknown>>): Promise<void> => {
  const over = budget * scale
  for (const [name, run] of Object.entries(cases)) {
    const { latency } = await context.bench(name, run).run()
    if (latency.mean > over)
      await context.annotate(`${name}: ${latency.mean.toFixed(1)} ms on average, over its budget of ${over} ms`, 'warning')
  }
}
