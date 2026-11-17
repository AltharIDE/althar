/** Bounded native Linux experiment, run by resource-controls.yml; performance numbers are reported, never asserted. */
import { execFile } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Effect } from 'effect'

import { spawnOwned } from '../src/process'
import { platformTrees, unixTrees } from '../src/processTrees'

if (process.platform !== 'linux' || !process.env.ALTHAR_TEST_CGROUP_ROOT) {
  process.stdout.write(
    'Native CPU-share measurement needs Linux delegation; background-priority fallback is covered by the native tests.\n',
  )
  process.exit(0)
}
const allowed = /^Cpus_allowed_list:\s*(.*)$/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1]
const cpu = allowed?.split(/[,-]/)[0]
if (cpu === undefined) throw new Error('No allowed CPU for a bounded measurement')
const cwd = mkdtempSync(join(tmpdir(), 'althar-resource-measure-'))
const root =
  "const spin='let x=0;function work(){for(let i=0;i<1000000;i++)x+=Math.sqrt(i+x%10);setImmediate(work)}work()';const spawn=require('node:child_process').spawn;const pids=Array.from({length:Number(process.argv[1])},()=>spawn(process.execPath,['-e',spin],{stdio:'ignore'}).pid);console.log(JSON.stringify(pids));setInterval(()=>{},1000)"
const ticks = (pid: number) => {
  const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ') ?? []
  return Number(fields[11]) + Number(fields[12])
}
const rss = (pids: number[]) =>
  pids.reduce((sum, pid) => sum + Number(/^VmRSS:\s*(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0), 0)
const probe = async () => {
  const at = performance.now()
  await new Promise<void>((resolve, reject) =>
    execFile('taskset', ['-c', cpu, 'node', '-e', 'let x=0;for(let i=0;i<1000000;i++)x+=Math.sqrt(i);'], (error) =>
      error ? reject(error) : resolve(),
    ),
  )
  return Math.round(performance.now() - at)
}
const results: Array<{ phase: string; shareA: number; shareB: number; peakRssMiB: number; foregroundProbeMs: number[] }> = []
for (const phase of ['before', 'after']) {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const families: number[][] = []
        const roots: number[] = []
        for (const [owner, count] of [
          ['many', 4],
          ['one', 1],
        ] as const) {
          const owned = yield* spawnOwned(
            {
              command: 'taskset',
              args: ['-c', cpu, 'node', '-e', root, String(count)],
              env: { ALTHAR_WORKER: `measure-${phase}-${owner}` },
            },
            cwd,
            { background: true, trees: phase === 'before' ? unixTrees : platformTrees() },
          )
          roots.push(owned.pid)
          const reader = owned.stdout.getReader()
          let text = ''
          while (!text.includes('\n')) {
            const next = yield* Effect.promise(() => reader.read())
            if (next.done) throw new Error(`Worker failed: ${owned.stderrTail()}`)
            text += new TextDecoder().decode(next.value)
          }
          reader.releaseLock()
          families.push(JSON.parse(text) as number[])
        }
        yield* Effect.promise(() => delay(250))
        const start = families.map((pids) => pids.reduce((sum, pid) => sum + ticks(pid), 0))
        const began = performance.now()
        let peakRss = rss([...roots, ...families.flat()])
        const probes: number[] = []
        for (let i = 0; i < 3; i++) {
          probes.push(yield* Effect.promise(probe))
          peakRss = Math.max(peakRss, rss([...roots, ...families.flat()]))
          yield* Effect.promise(() => delay(250))
        }
        yield* Effect.promise(() => delay(Math.max(0, 3000 - (performance.now() - began))))
        const used = families.map((pids, i) => pids.reduce((sum, pid) => sum + ticks(pid), 0) - (start[i] ?? 0))
        const total = used.reduce((a, b) => a + b, 0)
        return {
          phase,
          shareA: Math.round((100 * (used[0] ?? 0)) / Math.max(1, total)),
          shareB: Math.round((100 * (used[1] ?? 0)) / Math.max(1, total)),
          peakRssMiB: Math.round(peakRss / 1024),
          foregroundProbeMs: probes,
        }
      }),
    ),
  )
  results.push(result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
const report = [
  '### Native CPU sharing',
  '',
  'Two worker families on one allowed CPU: A has four busy children, B has one. Each phase lasts three seconds. Foreground probes run at normal priority. These are measurements, not timing assertions.',
  '',
  '| Scheduling | A CPU % | B CPU % | Peak family RSS MiB | Foreground probe ms |',
  '| --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.phase} | ${r.shareA} | ${r.shareB} | ${r.peakRssMiB} | ${r.foregroundProbeMs.join(', ')} |`),
  '',
].join('\n')
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
