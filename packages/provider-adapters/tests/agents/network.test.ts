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

for (const id of ['claude-code', 'codex', 'opencode'] as const) {
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
