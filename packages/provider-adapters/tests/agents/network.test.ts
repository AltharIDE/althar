import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, beforeAll, it } from '@effect/vitest'
import { Effect, Ref, Stream } from 'effect'

import { connect } from '../../src/AgentConnection'
import { agents } from '../../src/registry'

// Opt-in against signed-in agents. Dependencies and all writes stay in a scratch folder.
const cwd = mkdtempSync(join(tmpdir(), 'althar-font-network-'))
beforeAll(() => {
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ private: true, dependencies: { next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' } }),
  )
  execFileSync('bun', ['install'], { cwd, stdio: 'pipe' })
  writeFileSync(
    join(cwd, 'next.config.mjs'),
    'export default { agentRules: false, experimental: { cpus: 1 }, webpack(config) { config.parallelism = 1; return config } }',
  )
  mkdirSync(join(cwd, 'pages'))
  writeFileSync(
    join(cwd, 'pages/index.js'),
    `import { Inter } from 'next/font/google'; const inter = Inter({subsets:['latin']}); export default function Page() { return <main className={inter.className}>Font network probe</main> }`,
  )
  writeFileSync(
    join(cwd, 'AGENTS.md'),
    'Run the supplied test commands exactly. Do not inspect sign-ins or change files except the probes’ own output.\n',
  )
  writeFileSync(
    join(cwd, 'probe.mjs'),
    `
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const css = execFileSync('curl', ['--max-time', '30', '-fsSL', 'https://fonts.googleapis.com/css2?family=Inter'], {encoding:'utf8'});
if (!css.includes('font-family:')) throw new Error('Google Fonts CSS missing');
writeFileSync(process.argv[2]+'.css', css);
console.log('GOOGLE_FONTS_CSS_PASSED');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', '0'], {stdio:['ignore','pipe','pipe'], env:{...process.env, WATCHPACK_POLLING:'true', NEXT_TELEMETRY_DISABLED:'1'}});
let log = ''; let resolveUrl; let rejectUrl;
const url = new Promise((resolve,reject) => {resolveUrl=resolve;rejectUrl=reject});
const timer = setTimeout(() => rejectUrl(new Error('Next did not start: '+log)), 90000);
child.on('error', rejectUrl);
child.on('exit', code => rejectUrl(new Error('Next exited '+code+': '+log)));
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; const port = /localhost:(\\d+)/.exec(log)?.[1]; if (port && /Ready in/.test(log)) resolveUrl('http://localhost:'+port) });
try {
  const {stdout:page} = await promisify(execFile)('curl', ['--noproxy', '*', '--max-time', '120', '-fsSL', '-w', '\\n%{http_code}', await url], {encoding:'utf8'});
  const status = Number(page.slice(-3));
  const html = page.slice(0,-4);
  if (status !== 200 || !html.includes('Font network probe') || /Failed to (fetch|download)|next\\/font.*error/i.test(log)) throw new Error('Next/font failed: '+status+' '+log);
  const result = {css: css.includes('font-family:'), next: status, font: 'Inter', log};
  writeFileSync(process.argv[2], JSON.stringify(result));
  console.log('NETWORK_PROBE_PASSED '+JSON.stringify({css:result.css,next:result.next,font:result.font}));
} catch(error) { throw new Error(String(error)+'\\nNext output: '+log); } finally { clearTimeout(timer); child.kill('SIGTERM'); }
`,
  )
})

for (const id of ['codex', 'opencode'] as const) {
  it.live(`${id} reaches Google Fonts and serves next/font inside an ordinary command`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        rmSync(join(cwd, '.next'), { recursive: true, force: true })
        const definition = agents[id]
        const options = { web: true }
        const spec = definition.launch(process.execPath)
        const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
        const asked = yield* Ref.make<string[]>([])
        const connection = yield* connect({
          transport: {
            _tag: 'Process',
            cwd,
            spec: { ...spec, env: { ...spec.env, ...own, ...definition.sessionEnv?.({ ...spec.env, ...own }, options) } },
          },
          permissions: definition.permissions,
          onPermission: (request) =>
            Ref.update(asked, (calls) => [...calls, request.title]).pipe(
              Effect.as({ decision: 'allow' as const, reason: 'Allow everything: public-network probe.' }),
            ),
        })
        const session = yield* connection.newSession({
          cwd,
          mode: definition.modes.ask,
          modeOptionId: definition.options.mode,
          ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
        })
        if (id === 'opencode') yield* session.setOption(definition.options.model, 'opencode-go/deepseek-v4.1-flash')
        const result = `${id}.json`
        const events = yield* Stream.runCollect(
          session.prompt(
            `Run exactly this shell command in your current folder, in the sandbox with no escalation: node probe.mjs ${result}. It fetches public Google Fonts CSS, starts a Next.js dev server using next/font, requests its page and stops it. Do not edit files or try alternatives. Report the command's output.`,
          ),
        )
        process.stdout.write(
          `${id}: ${JSON.stringify(events.filter((event) => event._tag === 'ToolCallUpdate' && ('terminal' in event || 'rawInput' in event)))}\n`,
        )
        const actual = JSON.parse(readFileSync(join(cwd, result), 'utf8')) as { css: boolean; next: number; font: string }
        assert.deepInclude(actual, { css: true, next: 200, font: 'Inter' })
        process.stdout.write(`${id}: ${JSON.stringify(actual)}; permissions=${JSON.stringify(yield* Ref.get(asked))}\n`)
        assert.strictEqual(events.at(-1)?._tag, 'TurnEnded')
      }),
    ),
  )
}

it.live('a sandboxed Codex coordinator runs process substitution', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents.codex
      const options = { contained: { folder: cwd, reads: { allowed: [] as string[], denied: [] as string[] } } }
      const asked = yield* Ref.make<string[]>([])
      const spec = definition.launch(process.execPath)
      const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
      const connection = yield* connect({
        transport: { _tag: 'Process', cwd, spec: { ...spec, env: { ...spec.env, ...own } } },
        permissions: definition.permissions,
        onPermission: (request) =>
          Ref.update(asked, (calls) => [...calls, request.title]).pipe(
            Effect.as({ decision: 'allow' as const, reason: 'Public scratch-folder probe.' }),
          ),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
      })
      const events = yield* Stream.runCollect(
        session.prompt(
          'Run exactly this read-only shell command in the sandbox, with no edits or alternatives: diff <(printf same) <(printf same) && printf PROCESS_SUBSTITUTION_PASSED. Report the output.',
        ),
      )
      process.stdout.write(
        `Coordinator events: ${JSON.stringify(events.filter((event) => event._tag === 'AgentMessage' || event._tag === 'ToolCallUpdate'))}\n`,
      )
      assert.isTrue(
        events.some(
          (event) =>
            event._tag === 'ToolCallUpdate' &&
            'terminal' in event &&
            JSON.stringify(event.terminal).includes('PROCESS_SUBSTITUTION_PASSED'),
        ),
      )
      assert.isTrue(events.some((event) => event._tag === 'ToolCallUpdate' && 'terminal' in event && event.terminal.exit?.code === 0))
      assert.deepStrictEqual(yield* Ref.get(asked), [])
      process.stdout.write('Coordinator process substitution: ran inside the sandbox; no permission requests.\n')
    }),
  ),
)

it.live('a Codex lead asks Althar before an irreversible command inside its sandbox', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents.codex
      const options = { web: true }
      const spec = definition.launch(process.execPath)
      const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
      const asked = yield* Ref.make<string[]>([])
      const connection = yield* connect({
        transport: {
          _tag: 'Process',
          cwd,
          spec: { ...spec, env: { ...spec.env, ...own, ...definition.sessionEnv?.({ ...spec.env, ...own }, options) } },
        },
        permissions: definition.permissions,
        onPermission: (request) =>
          Ref.update(asked, (calls) => [...calls, `${request.title} ${JSON.stringify(request.rawInput ?? {})}`]).pipe(
            Effect.as({ decision: 'reject' as const, reason: 'An irreversible command: the person has not asked for this.' }),
          ),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
      })
      yield* Stream.runCollect(
        session.prompt(
          'Run exactly this shell command in the sandbox, with no escalation and no alternatives: gh pr merge 999999 --repo althar/does-not-exist. Report what happens.',
        ),
      )
      const permissions = yield* Ref.get(asked)
      process.stdout.write(`Codex permissions: ${JSON.stringify(permissions)}\n`)
      assert.isTrue(
        permissions.some((call) => call.includes('gh pr merge 999999') || call.includes('gh pr merge')),
        JSON.stringify(permissions),
      )
    }),
  ),
)

it.live('a Claude Code lead reaches Google Fonts inside its sandbox', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents['claude-code']
      const options = { web: true }
      const spec = definition.launch(process.execPath)
      const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
      const asked = yield* Ref.make<Array<{ readonly title: string; readonly outside: boolean }>>([])
      const connection = yield* connect({
        transport: {
          _tag: 'Process',
          cwd,
          spec: { ...spec, env: { ...spec.env, ...own, ...definition.sessionEnv?.({ ...spec.env, ...own }, options) } },
        },
        permissions: definition.permissions,
        onPermission: (request) =>
          Ref.update(asked, (calls) => [
            ...calls,
            { title: request.title, outside: JSON.stringify(request.rawInput ?? {}).includes('"dangerouslyDisableSandbox":true') },
          ]).pipe(Effect.as({ decision: 'allow' as const, reason: 'Public-network probe, inside the sandbox.' })),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
      })
      const events = yield* Stream.runCollect(
        session.prompt(
          "Run exactly this shell command in your sandbox, with no escalation and no alternatives: curl --max-time 30 -fsSL -o fonts.css 'https://fonts.googleapis.com/css2?family=Inter' && grep -q 'font-family' fonts.css && echo CURL_INSIDE_PASSED. Do not retry outside the sandbox.",
        ),
      )
      const permissions = yield* Ref.get(asked)
      process.stdout.write(`Claude curl permissions: ${JSON.stringify(permissions)}\n`)
      assert.isTrue(
        events.some(
          (event) =>
            event._tag === 'ToolCallUpdate' && 'terminal' in event && JSON.stringify(event.terminal).includes('CURL_INSIDE_PASSED'),
        ),
        JSON.stringify(events.filter((event) => event._tag === 'ToolCallUpdate')),
      )
      assert.isFalse(permissions.some((call) => call.outside))
    }),
  ),
)

// A hand-started dev server is one of the commands a project's reach lists
// (sandboxReach's ALWAYS), so Claude runs it outside its sandbox, where Next
// compiles; inside, its native sandbox stalls on the same compile.
it.live('a hand-started Next dev server runs outside Claude Code’s sandbox and serves next/font', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents['claude-code']
      const port = 45000 + Math.floor(Math.random() * 1000)
      writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({
          private: true,
          scripts: { dev: `next dev --webpack -p ${port}` },
          dependencies: { next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
        }),
      )
      const options = { web: true, sandbox: { commands: ['bun run dev'], hosts: [] as string[], writes: [] as string[] } }
      const spec = definition.launch(process.execPath)
      const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
      const connection = yield* connect({
        transport: {
          _tag: 'Process',
          cwd,
          spec: {
            ...spec,
            env: {
              ...spec.env,
              ...own,
              ...definition.sessionEnv?.({ ...spec.env, ...own }, options),
              WATCHPACK_POLLING: 'true',
            },
          },
        },
        permissions: definition.permissions,
        onPermission: () => Effect.succeed({ decision: 'allow' as const, reason: 'Public dev-server probe.' }),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
      })
      const events = yield* Stream.runCollect(
        session.prompt(
          `Start the project's dev server exactly as it is kept, as a background command, with no escalation and no edits: bun run dev. Do not stop it or run anything else.`,
        ),
      )
      process.stdout.write(
        `Claude dev server started: ${JSON.stringify(events.filter((event) => event._tag === 'ToolCallUpdate')).slice(0, 1500)}\n`,
      )
      let page = ''
      try {
        for (let attempt = 0; attempt < 60 && page === ''; attempt += 1) {
          execFileSync('sleep', ['1'])
          try {
            const html = execFileSync('curl', ['--noproxy', '*', '--max-time', '10', '-fsS', `http://localhost:${port}`], {
              encoding: 'utf8',
            })
            if (html.includes('Font network probe')) page = html
          } catch {
            // Not up yet.
          }
        }
      } finally {
        try {
          execFileSync('sh', ['-c', `lsof -ti tcp:${port} | xargs kill 2>/dev/null || true`])
        } catch {
          // Already gone.
        }
      }
      process.stdout.write(`Claude dev server page: ${page.slice(0, 200)}\n`)
      assert.include(page, 'Font network probe')
    }),
  ),
)

it.live('a Claude Code coordinator runs process substitution, retrying outside the sandbox where its pipes are refused', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents['claude-code']
      const options = {
        contained: { folder: cwd, reads: { allowed: [] as string[], denied: [] as string[] } },
        sandbox: { commands: [] as string[], hosts: [] as string[], writes: [] as string[] },
      }
      const asked = yield* Ref.make<string[]>([])
      const spec = definition.launch(process.execPath)
      const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
      const connection = yield* connect({
        transport: { _tag: 'Process', cwd, spec: { ...spec, env: { ...spec.env, ...own } } },
        permissions: definition.permissions,
        onPermission: (request) =>
          Ref.update(asked, (calls) => [...calls, request.title]).pipe(
            Effect.as({ decision: 'allow' as const, reason: 'Public scratch-folder probe.' }),
          ),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('reader', options) }),
      })
      const events = yield* Stream.runCollect(
        session.prompt(
          'Run exactly this read-only shell command, with no edits or alternatives: diff <(printf same) <(printf same) && printf PROCESS_SUBSTITUTION_PASSED. If the sandbox refuses to open the process-substitution pipes, run the same command outside the sandbox with dangerouslyDisableSandbox true. Report the output.',
        ),
      )
      process.stdout.write(`Claude coordinator events: ${JSON.stringify(events.filter((event) => event._tag === 'ToolCallUpdate'))}\n`)
      assert.isTrue(
        events.some(
          (event) =>
            event._tag === 'ToolCallUpdate' &&
            'terminal' in event &&
            JSON.stringify(event.terminal).includes('PROCESS_SUBSTITUTION_PASSED'),
        ),
      )
      process.stdout.write('Claude coordinator process substitution: ran, inside or just outside the sandbox.\n')
    }),
  ),
)
