import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, beforeAll, it } from '@effect/vitest'
import { Effect, Ref, Stream } from 'effect'

import { connect } from '../../src/AgentConnection'
import { agents } from '../../src/registry'

const cwd = mkdtempSync(join(tmpdir(), 'althar-font-diag-'))
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
  writeFileSync(join(cwd, 'AGENTS.md'), 'Run the supplied test command exactly. Do not inspect sign-ins or change files.\n')
  writeFileSync(
    join(cwd, 'probe.mjs'),
    `
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const steps = [];
const timed = async (name, run) => {
  const at = Date.now();
  try { const value = await run(); steps.push(name + ' ok in ' + (Date.now()-at) + 'ms: ' + String(value).slice(0, 120)); return value; }
  catch (error) { steps.push(name + ' failed in ' + (Date.now()-at) + 'ms: ' + String(error)); }
};
const css = await timed('css', async () => {
  const res = await fetch('https://fonts.googleapis.com/css2?family=Inter', {signal: AbortSignal.timeout(20000)});
  return res.ok ? await res.text() : 'status ' + res.status;
});
const fontUrl = typeof css === 'string' ? /url\\((https:[^)]+)\\)/.exec(css)?.[1] : undefined;
if (fontUrl) await timed('font file', async () => {
  const res = await fetch(fontUrl, {signal: AbortSignal.timeout(20000)});
  return res.status + ' ' + res.headers.get('content-length');
});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', '0'], {stdio:['ignore','pipe','pipe'], env:{...process.env, WATCHPACK_POLLING:'true', NEXT_TELEMETRY_DISABLED:'1'}});
let log = ''; let resolveUrl; let rejectUrl;
const url = new Promise((resolve,reject) => {resolveUrl=resolve;rejectUrl=reject});
const timer = setTimeout(() => rejectUrl(new Error('Next did not start: '+log)), 90000);
child.on('error', rejectUrl);
child.on('exit', code => rejectUrl(new Error('Next exited '+code+': '+log)));
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; const port = /localhost:(\\d+)/.exec(log)?.[1]; if (port && /Ready in/.test(log)) resolveUrl('http://localhost:'+port) });
let status = 0;
try {
  const {stdout:page} = await promisify(execFile)('curl', ['--noproxy', '*', '--max-time', '60', '-fsSL', '-w', '\\n%{http_code}', await url], {encoding:'utf8'});
  status = Number(page.slice(-3));
} catch (error) { steps.push('page failed: ' + String(error)); }
writeFileSync(process.argv[2], JSON.stringify({ steps, status, log }, null, 2));
console.log('DIAG ' + JSON.stringify({ steps, status }));
clearTimeout(timer); child.kill('SIGTERM');
`,
  )
})

it.live('claude next/font diagnostics', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents['claude-code']
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
            Effect.as({ decision: 'allow' as const, reason: 'Diagnostic probe.' }),
          ),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: definition.modes.ask,
        modeOptionId: definition.options.mode,
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
      })
      yield* Stream.runDrain(
        session.prompt('Run exactly this command in your sandbox, no escalation: node probe.mjs diag.json. Report the output.'),
      )
      try {
        process.stdout.write(`DIAG result: ${readFileSync(join(cwd, 'diag.json'), 'utf8')}\n`)
      } catch {
        process.stdout.write('DIAG no result file\n')
      }
      assert.isTrue(true)
    }),
  ),
)
