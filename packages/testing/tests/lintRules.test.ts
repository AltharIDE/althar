import { RuleTester } from 'vite-plus/lint/plugins-dev'
import { describe, expect, it } from 'vite-plus/test'

/*
 * Althar's own lint rules (lint/, run on every package by the root vite.config.ts), as they read the code they check:
 * what each fails on, and what it leaves, as the docs it keeps say (docs/decisions/foundations.md, The UI is instant).
 * They are plain JavaScript, outside any package, so they are read here by their address.
 */

// RuleTester runs what it is given at once: each case below is a test of its own, which gives it its cases one at a time.
RuleTester.describe = (_name, run) => run()
RuleTester.it = (_name, run) => run()

/** A rule of lint/, by its file and its name there. */
const rule = async (file: string, name: string) =>
  ((await import(new URL(`../../../lint/${file}`, import.meta.url).href)) as Record<string, Parameters<RuleTester['run']>[1]>)[name]!

const pressAtOnce = await rule('press.js', 'pressAtOnce')
const offTheThread = await rule('thread.js', 'offTheThread')

const tsx = new RuleTester({ languageOptions: { sourceType: 'module', parserOptions: { lang: 'tsx' } } })
const ts = new RuleTester({ languageOptions: { sourceType: 'module', parserOptions: { lang: 'ts' } } })

type Cases = Parameters<RuleTester['run']>[2]
type Case = Cases['valid'][number] | Cases['invalid'][number]

/** A case's code, as its test is named. */
const codeOf = (test: Case) => (typeof test === 'string' ? test : test.code)

/**
 * Each case a test of its own, read by a run of RuleTester's own: within a run it refuses a case it has read, so a test
 * the stress run repeats would read as one written twice. A case that is written twice is still refused, here.
 */
const check = (tester: RuleTester, name: string, rule: Parameters<RuleTester['run']>[1], { valid, invalid }: Cases) =>
  describe(name, () => {
    const codes = [...valid, ...invalid].map(codeOf)
    it('has no case written twice', () => {
      expect(codes.filter((code, at) => codes.indexOf(code) !== at)).toEqual([])
    })
    for (const test of valid) it(`leaves ${codeOf(test)}`, () => tester.run(name, rule, { valid: [test], invalid: [] }))
    for (const test of invalid) it(`fails ${codeOf(test)}`, () => tester.run(name, rule, { valid: [], invalid: [test] }))
  })

/** A component, with what it declares before it returns `jsx`. */
const component = (jsx: string, before = '') => `export function View({ model, close }) {\n${before}\n  return ${jsx}\n}`

check(tsx, 'press-at-once', pressAtOnce, {
  valid: [
    // What shows changes first; the call catches up, and its failure takes it back.
    component(`<Button onClick={() => { close(); void model.save().catch(() => model.reopen()) }} />`),
    // A view model's intent, which changes what shows inside.
    component(`<Button onClick={() => void model.markDone()} />`),
    // A guard first, then the change.
    component(`<Button onClick={() => { if (model.task === null) return; close(); void model.save() }} />`),
    // Busy from the press, and let go of as the call answers: the call's own view model shows what it does.
    component(`<Button onClick={() => { setSaving(true); void model.save().finally(() => setSaving(false)) }} />`),
    component(`<Button onClick={() => { setBusy(true); void model.save().then(() => setBusy(false), fail) }} />`),
    // A `.then` that leaves the answer and takes the press back where it failed is a `.catch`.
    component(`<Button onClick={() => { setBusy(ask); void client.answer(id).then(() => undefined, (failure) => setError(failure)) }} />`),
    // A map of what shows, changed at once, is the press's result, not its busy.
    component(`<Button onClick={() => { setPending((now) => ({ ...now, [id]: value })); void save(id).then(read) }} />`),
    // A handler declared in the file that changes first.
    component(`<Button onClick={go} />`, `  const go = () => { close(); void model.save() }`),
    component(`<Button onClick={(id) => void go(id)} />`, `  function go(id) { model.hide(id); void model.save(id) }`),
    // One passed down, from another file, is review's to read.
    component(`<Button onClick={onSave} />`),
  ],
  invalid: [
    { code: component(`<Button onClick={() => void model.markDone().then(close)} />`), errors: [{ messageId: 'waits' }] },
    { code: component(`<Button onSave={async () => { if (await model.save()) close() }} />`), errors: [{ messageId: 'waits' }] },
    // Busy alone isn't the press's result: what it does waits.
    {
      code: component(`<Button onClick={async () => { setBusy(true); await model.save(); close() }} />`),
      errors: [{ messageId: 'waits', data: { name: 'onClick', how: 'await' } }],
    },
    {
      code: component(`<Button onClick={() => { setError(null); setPending(true); void model.save().then(close) }} />`),
      errors: [{ messageId: 'waits', data: { name: 'onClick', how: '.then' } }],
    },
    // `.finally` waits like `.then`, where what it does is the press's result.
    {
      code: component(`<Button onClick={() => void model.save().finally(close)} />`),
      errors: [{ messageId: 'waits', data: { name: 'onClick', how: '.finally' } }],
    },
    // A function called where it is made runs as the handler does.
    {
      code: component(`<Button onClick={() => void (async () => { for (const id of ids) await model.file(id) })()} />`),
      errors: [{ messageId: 'waits', data: { name: 'onClick', how: 'await' } }],
    },
    // A handler named in place, or called by one, read where it is declared.
    {
      code: component(`<Button onClick={edit} />`, `  const edit = async () => { if (await model.takeBack(id)) restore() }`),
      errors: [{ messageId: 'named', data: { name: 'onClick', handler: 'edit', how: 'await' } }],
    },
    {
      code: component(
        `<Button onClick={(id) => void edit(id)} />`,
        `  async function edit(id) { setBusy(true); await model.takeBack(id); restore() }`,
      ),
      errors: [{ messageId: 'named', data: { name: 'onClick', handler: 'edit', how: 'await' } }],
    },
    {
      code: component(
        `<Button onClick={go} />`,
        `  const make = () => void model.make().then(open)\n  const go = () => { setBusy(true); make() }`,
      ),
      errors: [{ messageId: 'named', data: { name: 'onClick', handler: 'go', how: '.then' } }],
    },
  ],
})

check(ts, 'off-the-thread', offTheThread, {
  valid: [
    `import { execFile, spawn } from 'node:child_process'\nexecFile('git', ['status'])\nspawn('git')`,
    `import { cp } from 'node:fs/promises'\nawait cp('a', 'b', { recursive: true })`,
    // Another function of the same name, not the one imported.
    `import { execSync as run } from 'node:child_process'\nconst later = (run) => run()`,
  ],
  invalid: [
    {
      code: `import { execSync } from 'node:child_process'\nexecSync('git status')`,
      errors: [{ messageId: 'holds', data: { name: 'execSync', what: 'a child process' } }],
    },
    {
      code: `import cp from 'node:child_process'\ncp.spawnSync('git')`,
      errors: [{ messageId: 'holds', data: { name: 'spawnSync', what: 'a child process' } }],
    },
    {
      code: `import * as fs from 'node:fs'\nfs['cpSync']('a', 'b')`,
      errors: [{ messageId: 'holds', data: { name: 'cpSync', what: 'a recursive copy' } }],
    },
    // By another name, imported or taken out under it.
    {
      code: `import { execFileSync as run, spawnSync as probe } from 'node:child_process'\nrun('git')\nconst found = probe('bwrap')`,
      errors: [
        { messageId: 'holds', data: { name: 'execFileSync', what: 'a child process' } },
        { messageId: 'holds', data: { name: 'spawnSync', what: 'a child process' } },
      ],
    },
    {
      code: `import cp from 'node:child_process'\nimport fs from 'node:fs'\nconst { spawnSync: probe } = cp\nconst { cpSync: copy = fs.cpSync } = fs\nconst run = () => probe('bwrap')\ncopy('a', 'b')`,
      errors: [
        { messageId: 'holds', data: { name: 'spawnSync', what: 'a child process' } },
        { messageId: 'holds', data: { name: 'cpSync', what: 'a recursive copy' } },
      ],
    },
  ],
})
