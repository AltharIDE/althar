/*
 * What the workflows must say for quarantine to keep its word (quarantine.ts). A job that reads the quarantine skips a
 * test whose quarantine lapsed, unless the step says `lapsed: run`; a job that measures coverage must say it, or the
 * lines a lapsed test covers drop out of the measurement and a package can fall under its gate for no change of its
 * own. Nothing else would notice a new coverage job that forgot it, so the queue checks every workflow
 * (`bun workflows.ts check`, in queue.yml's `measures`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Step {
  readonly uses?: string
  readonly run?: string
  readonly with?: Readonly<Record<string, unknown>>
  readonly env?: Readonly<Record<string, unknown>>
}

interface Job {
  readonly steps?: ReadonlyArray<Step>
}

/** A workflow as YAML gives it: its jobs and their steps. */
export interface Workflow {
  readonly jobs?: Readonly<Record<string, Job>>
}

const QUARANTINE = './.github/actions/flaky/quarantine'

/** Whether a step measures coverage: runs a package's `test:coverage`, as a command or a word its command reads. */
const measures = (step: Step) =>
  [step.run ?? '', ...Object.values(step.env ?? {}).map(String)].some((text) => text.includes('test:coverage'))

/** Each job, as `file: job`, that measures coverage and reads the quarantine without `lapsed: run`. */
export const unmeasured = (workflows: Readonly<Record<string, Workflow>>): ReadonlyArray<string> =>
  Object.entries(workflows).flatMap(([file, workflow]) =>
    Object.entries(workflow.jobs ?? {}).flatMap(([name, job]) => {
      const steps = job.steps ?? []
      if (!steps.some(measures)) return []
      const reads = steps.filter((step) => step.uses === QUARANTINE)
      return reads.some((step) => step.with?.lapsed !== 'run') ? [`${file}: ${name}`] : []
    }),
  )

const main = (process.argv[1] ?? '').replaceAll('\\', '/').endsWith('/workflows.ts')

if (main && process.argv[2] === 'check') {
  const folder = join(import.meta.dirname, '../../../.github/workflows')
  // Bun reads YAML itself, as queue.yml does: the check needs no install.
  const { YAML } = (globalThis as unknown as { Bun: { YAML: { parse: (text: string) => Workflow } } }).Bun
  const workflows = Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => [name, YAML.parse(readFileSync(join(folder, name), 'utf8'))]),
  )
  const missing = unmeasured(workflows)
  if (missing.length > 0) {
    for (const job of missing)
      process.stdout.write(
        `::error::${job} measures coverage and reads the quarantine without \`lapsed: run\`: a lapsed test would be skipped there, and what it covers fall out of the measurement.\n`,
      )
    process.exit(1)
  }
  process.stdout.write(`Every job that measures coverage runs its lapsed tests (${Object.keys(workflows).length} workflows).\n`)
}
