import { globSync } from 'node:fs'
import { join } from 'node:path'

import { RuleTester } from 'vite-plus/lint/plugins-dev'
import { describe, expect, it } from 'vite-plus/test'

/*
 * The runtime's structure as lint keeps it (ARCHITECTURE.md, "Where a file goes"): its layers' table, every module in
 * it once, and the two rules that read the code against it, `althar/layers` and `althar/exported-where-made`
 * (lint/layers.js, lint/exports.js). The rules are plain JavaScript outside any package, read here by their address.
 */

// RuleTester runs what it is given at once: each case below is a test of its own, which gives it its cases one at a time.
RuleTester.describe = (_name, run) => run()
RuleTester.it = (_name, run) => run()

type Rule = Parameters<RuleTester['run']>[1]
type Cases = Parameters<RuleTester['run']>[2]
type Case = Cases['valid'][number] | Cases['invalid'][number]

/** A rule of lint/, by its file and its name there. */
const rule = async (file: string, name: string) =>
  ((await import(new URL(`../../../lint/${file}`, import.meta.url).href)) as Record<string, Rule>)[name]!

const layers = await rule('layers.js', 'layers')
const exportedWhereMade = await rule('exports.js', 'exportedWhereMade')

interface Table {
  readonly layers: ReadonlyArray<{
    readonly name: string
    readonly modules?: ReadonlyArray<string>
    readonly areas?: Readonly<Record<string, ReadonlyArray<string>>>
  }>
}
const { layers: table } = (await import(new URL('../layers.js', import.meta.url).href)) as { layers: Table }
const { placesOf } = (await import(new URL('../../../lint/layers.js', import.meta.url).href)) as {
  placesOf: (table: Table) => (path: string) => { readonly layer: string } | undefined
}

const tester = new RuleTester({ languageOptions: { sourceType: 'module', parserOptions: { lang: 'ts' } } })

/** A module of the runtime, by its path under src/. */
const at = (path: string) => `/work/packages/runtime/src/${path}`

/** A case's file and code, as its test is named. */
const codeOf = (test: Case) => (typeof test === 'string' ? test : `${test.filename ?? ''} ${test.code}`)

/** Each case a test of its own, in a run of RuleTester's own: within a run it refuses a case it has read. */
const check = (name: string, checked: Rule, { valid, invalid }: Cases) =>
  describe(name, () => {
    for (const test of valid) it(`leaves ${codeOf(test)}`, () => tester.run(name, checked, { valid: [test], invalid: [] }))
    for (const test of invalid) it(`fails ${codeOf(test)}`, () => tester.run(name, checked, { valid: [], invalid: [test] }))
  })

describe('the layer table', () => {
  const entries = table.layers.flatMap((layer) => [...(layer.modules ?? []), ...Object.values(layer.areas ?? {}).flat()])
  const modules = globSync('**/*.ts', { cwd: join(import.meta.dirname, '../src') }).map((path) => path.replaceAll('\\', '/'))
  const placeOf = placesOf(table)

  it('places every module of src/', () => {
    expect(modules.filter((path) => placeOf(path) === undefined)).toEqual([])
  })

  it('names each module once, and only modules that are there', () => {
    expect(entries.filter((entry, index) => entries.indexOf(entry) !== index)).toEqual([])
    expect(entries.filter((entry) => !entry.includes('*') && !modules.includes(entry))).toEqual([])
  })
})

check('layers', layers, {
  valid: [
    // Down the layers, and within one.
    { filename: at('records.ts'), code: `import { GitFailed } from './errors'` },
    { filename: at('Sessions.ts'), code: `import { handover } from './handover'` },
    // The areas of one layer import each other.
    { filename: at('Projects.ts'), code: `import { Policies } from './Policies'` },
    // A type loads nothing.
    { filename: at('Config.ts'), code: `import type { LoadOptions } from './MachineLoad'` },
    { filename: at('Live.ts'), code: `export type { ShownLaunch } from './Launches'` },
    // A folder's modules, placed by the folder, and imports out of it.
    { filename: at('elsewhere/look.ts'), code: `import { git } from '../git'` },
    { filename: at('api/projects.ts'), code: `import { Sessions } from '../Sessions'\nimport { Queries } from '../Queries'` },
    // Packages, and files outside the runtime's src/.
    { filename: at('git.ts'), code: `import { Effect } from 'effect'` },
    { filename: '/work/packages/ui/src/Button.ts', code: `import { Sessions } from './Sessions'` },
  ],
  invalid: [
    {
      filename: at('records.ts'),
      code: `import { Sessions } from './Sessions'`,
      errors: [{ messageId: 'upward', data: { path: 'records.ts', from: 'store', target: 'Sessions.ts', to: 'sessions' } }],
    },
    // A `type` inside the braces still loads the module.
    {
      filename: at('Config.ts'),
      code: `import { type Copilot } from './Copilot'`,
      errors: [
        {
          messageId: 'upward',
          data: { path: 'Config.ts', from: 'store', target: 'Copilot.ts', to: 'agents · policy · connections · workspace' },
        },
      ],
    },
    {
      filename: at('git.ts'),
      code: `export { Instance } from './Instance'`,
      errors: [{ messageId: 'upward', data: { path: 'git.ts', from: 'kit', target: 'Instance.ts', to: 'store' } }],
    },
    {
      filename: at('elsewhere/look.ts'),
      code: `const runs = () => import('../Runs')`,
      errors: [
        {
          messageId: 'upward',
          data: { path: 'elsewhere/look.ts', from: 'agents · policy · connections · workspace', target: 'Runs.ts', to: 'workflow' },
        },
      ],
    },
    // A module the table doesn't place.
    {
      filename: at('somethingNew.ts'),
      code: `export const n = 1`,
      errors: [{ messageId: 'unplaced', data: { path: 'somethingNew.ts', table: 'packages/runtime/layers.js' } }],
    },
  ],
})

check('exported-where-made', exportedWhereMade, {
  valid: [
    `export const made = 1`,
    `import { made } from './made'\nexport const more = made + 1`,
    `import { made } from './made'\nconst kept = made\nexport { kept }`,
    `const kept = 1\nexport { kept as alsoKept }`,
    `import type { Made } from './made'\nexport type Kept = Made`,
    // An index.ts is a package's or a folder's entry: it passes on what its modules make.
    { filename: at('index.ts'), code: `export { Sessions } from './Sessions'\nexport * from './errors'` },
  ],
  invalid: [
    { code: `export { made } from './made'`, errors: [{ messageId: 'from', data: { name: 'made', source: './made' } }] },
    { code: `export { made as again } from './made'`, errors: [{ messageId: 'from', data: { name: 'again', source: './made' } }] },
    { code: `export type { Made } from './made'`, errors: [{ messageId: 'from', data: { name: 'Made', source: './made' } }] },
    { code: `export * from './made'`, errors: [{ messageId: 'from', data: { name: '*', source: './made' } }] },
    { code: `export * as Made from './made'`, errors: [{ messageId: 'from', data: { name: 'Made', source: './made' } }] },
    { code: `export { pictureType } from '@althar/contracts'`, errors: [{ messageId: 'from' }] },
    {
      code: `import { made, type Made } from './made'\nexport { made, type Made }`,
      errors: [
        { messageId: 'imported', data: { name: 'made', source: './made' } },
        { messageId: 'imported', data: { name: 'Made', source: './made' } },
      ],
    },
    {
      code: `import made from './made'\nexport default made`,
      errors: [{ messageId: 'imported', data: { name: 'default', source: './made' } }],
    },
  ],
})
