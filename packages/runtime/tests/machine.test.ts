import { execFileSync, spawn } from 'node:child_process'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  ALTHAR,
  coresOf,
  type Listed,
  listedOfStat,
  listingOf,
  listingOfReader,
  memoryOfMeminfo,
  ownersOf,
  pressureOf,
  readMachine,
  sameProcess,
  usedOf,
  marksOf,
  usedOfVmStat,
  valueInEnviron,
  valuesOfPs,
  valuesOfReader,
  WORK,
  workIn,
  workOf,
} from '../src/machine'
import { buildReader, runReader } from '../src/processReader'

/*
 * What this computer says of how hard it works (machine.ts), from what each
 * system prints: a Mac's `vm_stat` and memory pressure, Linux's meminfo, a
 * `ps` listing on either, the Mac reader's and Linux's /proc, whose work
 * each process is, and what each piece of work used between two.
 */

/** A 24 GB M-series Mac with a few agents at work, as `vm_stat` printed it. */
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     6411.
Pages active:                                 524535.
Pages inactive:                               447101.
Pages speculative:                             78207.
Pages throttled:                                   0.
Pages wired down:                             182523.
Pages purgeable:                               16621.
"Translation faults":                     1495487093.
Pages copy-on-write:                       105155692.
File-backed pages:                            338447.
Anonymous pages:                              711396.
Pages stored in compressor:                  1338973.
Pages occupied by compressor:                 294404.
Decompressions:                            109064274.
`

const MEMINFO = `MemTotal:       16318252 kB
MemFree:          612340 kB
MemAvailable:    8159126 kB
Buffers:          204512 kB
`

const listed = (parent: number, cpu: number, memory = 0): Listed => ({ parent, cpu, memory })

describe('this computer', () => {
  it('adds up every core’s time, busy and all of it', () => {
    const core = (user: number, idle: number) => ({ times: { user, nice: 1, sys: 2, irq: 3, idle } })
    assert.deepStrictEqual(coresOf([core(10, 100), core(20, 200)]), { busy: 42, total: 342, count: 2 })
    assert.deepStrictEqual(coresOf([]), { busy: 0, total: 0, count: 0 })
  })

  it('reads a process listing, leaving out what isn’t a process', () => {
    const listing = listingOf(
      [
        '    1     0   1:02.50  12000',
        '  412     1   0:00.03    880',
        '  500   412 1-02:03:04  4',
        'PID PPID TIME RSS',
        '  77   1  ?  3',
        '',
      ].join('\n'),
    )
    assert.deepStrictEqual([...listing.keys()], [1, 412, 500])
    assert.deepStrictEqual(listing.get(1), { parent: 0, cpu: 62_500, memory: 12_000 * 1024 })
    // Days and hours, as a long-running process's time is printed.
    assert.strictEqual(listing.get(500)?.cpu, ((26 * 60 + 3) * 60 + 4) * 1000)
  })

  it('counts memory in use as Activity Monitor does: apps, wired and compressed, not cache', () => {
    assert.strictEqual(usedOfVmStat(VM_STAT), (711_396 - 16_621 + 182_523 + 294_404) * 16_384)
    // Without every count it needs, it says nothing rather than a part.
    assert.isNull(usedOfVmStat(VM_STAT.replace(/^Pages wired down.*$/m, '')))
    assert.isNull(usedOfVmStat('nothing like vm_stat'))
  })

  it('counts memory in use on Linux as all of it less what is available', () => {
    assert.deepStrictEqual(memoryOfMeminfo(MEMINFO), { used: (16_318_252 - 8_159_126) * 1024, total: 16_318_252 * 1024 })
    assert.isNull(memoryOfMeminfo('MemTotal: 1 kB\n'))
  })

  it('reads macOS’s memory pressure in its own levels', () => {
    assert.deepStrictEqual(['1\n', '2', '4', '0', ''].map(pressureOf), ['normal', 'warning', 'critical', null, null])
  })

  it('reads the Mac reader’s listing: parent, start, CPU time with its reaped children’s, and footprint', () => {
    const listing = listingOfReader(
      ['412 1 1793130324619487 4698 177898648', '500 412 1793130324619499 2 409768', 'not a line', ''].join('\n'),
    )
    assert.deepStrictEqual(Object.fromEntries(listing), {
      412: { parent: 1, started: 1_793_130_324_619_487, cpu: 4_698, memory: 177_898_648 },
      500: { parent: 412, started: 1_793_130_324_619_499, cpu: 2, memory: 409_768 },
    })
  })

  it('reads a Linux process from its /proc stat, its reaped children’s time with its own, whatever its name holds', () => {
    // pid (name) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime … starttime vsize rss
    const stat = '4242 (node (a) b) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 50 1200 300 20 0 11 0 98765 1000000 2048 rest'
    assert.deepStrictEqual(listedOfStat(stat, 4096), { parent: 1, cpu: (250 + 50 + 1200 + 300) * 10, memory: 2048 * 4096, started: 98_765 })
    assert.isNull(listedOfStat('not a stat', 4096))
  })

  it('reads whose work a process is from its environment, as each system gives it', () => {
    assert.strictEqual(valueInEnviron('PATH=/bin\0ALTHAR_WORK=task:t1\0HOME=/h\0', WORK), 'task:t1')
    assert.isNull(valueInEnviron('PATH=/bin\0ALTHAR_WORKS=task:t1\0', WORK))
    assert.deepStrictEqual(Object.fromEntries(valuesOfReader('12 task:t1\n13 run:p1\nnonsense\n')), { 12: 'task:t1', 13: 'run:p1' })
    // `ps -E` gives the environment after the command line: its last mention is the environment's.
    const ps = ['  12 node grep ALTHAR_WORK=task:other PATH=/bin ALTHAR_WORK=task:t1 HOME=/h', '  13 /bin/sh -c sleep', ''].join('\n')
    assert.deepStrictEqual(Object.fromEntries(valuesOfPs(ps, WORK)), { 12: 'task:t1' })
  })

  it('names a piece of work in its environment, and reads it back', () => {
    assert.strictEqual(workOf({ kind: 'task', projectId: 'p1', taskId: 't1' }), 'task:t1')
    // A task's run is the task's.
    assert.strictEqual(workOf({ kind: 'run', projectId: 'p1', taskId: 't1' }), 'task:t1')
    assert.strictEqual(workOf({ kind: 'coordinator', projectId: 'p1', taskId: null }), 'coordinator:p1')
    assert.deepStrictEqual(workIn('run:p1'), { kind: 'run', projectId: 'p1' })
    assert.deepStrictEqual(workIn('task:t1'), { kind: 'task', taskId: 't1' })
    assert.isNull(workIn('althar'))
    assert.isNull(workIn('task:'))
  })

  it('gives each process to the first piece of work whose tree reaches it, then to the app, then to the work its environment names', () => {
    const listing = new Map([
      [1, listed(0, 0)],
      // The lead, and the reviewer started under its tree: counted once, for the lead.
      [10, listed(1, 0)],
      [11, listed(10, 0)],
      // The app, its runtime, and the agent the runtime started.
      [50, listed(1, 0)],
      [51, listed(50, 0)],
      [52, listed(51, 0)],
      // A server the lead started in the background, left to launchd, and what it started.
      [60, listed(1, 0)],
      [61, listed(60, 0)],
      // Someone else's.
      [70, listed(1, 0)],
    ])
    const owners = ownersOf(
      listing,
      [
        { pid: 52, key: 'task:t2' },
        { pid: 10, key: 'task:t1' },
        { pid: 11, key: 'task:t3' },
        // Gone: nothing.
        { pid: 20, key: 'coordinator:p1' },
      ],
      50,
      new Map([
        [60, 'task:t1'],
        // A mark on a process a tree reached doesn't take it.
        [11, 'task:t9'],
      ]),
    )
    assert.deepStrictEqual(Object.fromEntries(owners), {
      10: 'task:t1',
      11: 'task:t1',
      50: ALTHAR,
      51: ALTHAR,
      52: 'task:t2',
      60: 'task:t1',
      61: 'task:t1',
    })
  })

  it('gives each piece of work what its processes used between two listings, all of it for one new since', () => {
    const before = new Map([
      [10, listed(1, 1_000)],
      [11, listed(10, 500)],
      [30, listed(1, 9_000)],
    ])
    const after = new Map([
      [10, listed(1, 1_200, 100)],
      [11, listed(10, 1_500, 200)],
      [12, listed(11, 300, 50)],
      // A run whose pid was another process's before, with less time than that one had: all of its time is new.
      [30, listed(1, 40, 10)],
    ])
    const owners = new Map([
      [10, 'task:t1'],
      [11, 'task:t1'],
      [12, 'task:t1'],
      [30, 'run:p1'],
    ])
    assert.deepStrictEqual(Object.fromEntries(usedOf(owners, before, after, false)), {
      'task:t1': { cpu: 200 + 1_000 + 300, memory: 350, processes: 3 },
      'run:p1': { cpu: 40, memory: 10, processes: 1 },
    })
  })

  it('tells a process from a later one given its pid by when it started, where the listing says', () => {
    const was = { parent: 1, cpu: 100, memory: 0, started: 5 }
    assert.isTrue(sameProcess(was, { ...was, cpu: 150 }))
    // Started later, with more time than the one before had: another process all the same.
    assert.isFalse(sameProcess(was, { ...was, cpu: 150, started: 6 }))
    assert.isFalse(sameProcess(listed(1, 100), listed(1, 50)))
    assert.isFalse(sameProcess(undefined, was))
  })

  it('counts what ended between two listings, where a process’s time counts its reaped children’s', () => {
    const before = new Map([
      [10, listed(1, 1_000)],
      // A test run the lead started, and its worker: both end before the second listing, and the lead reaps them.
      [11, listed(10, 400)],
      [12, listed(11, 2_000)],
      // A command started by something that is no work's, ended since.
      [80, listed(1, 7_000)],
    ])
    const after = new Map([
      // The lead's time now counts the run's and its worker's, all of them: 50 its own since, 300 the run's and 1,500 the
      // worker's since the first listing, and 4,000 of a check that started and ended between the two.
      [10, listed(1, 1_000 + 50 + 400 + 300 + 2_000 + 1_500 + 4_000, 100)],
    ])
    const owners = new Map([[10, 'task:t1']])
    assert.deepStrictEqual(usedOf(owners, before, after, true).get('task:t1'), { cpu: 50 + 300 + 1_500 + 4_000, memory: 100, processes: 1 })
    // Where a listing's times count only each process's own, what ended is gone with it, and nothing is taken off.
    const own = new Map([[10, listed(1, 1_050, 100)]])
    assert.deepStrictEqual(usedOf(owners, before, own, false).get('task:t1'), { cpu: 50, memory: 100, processes: 1 })
    // A process whose time was taken off once too often, its parent having ended before it, never counts below none.
    const orphaned = new Map([[10, listed(1, 1_000 + 400, 100)]])
    assert.strictEqual(usedOf(owners, before, orphaned, true).get('task:t1')?.cpu, 0)
  })

  it.live('reads this computer as it is, every part in bounds', () =>
    Effect.gen(function* () {
      const reading = yield* readMachine()
      assert.isAbove(reading.cores.count, 0)
      assert.isAtLeast(reading.cores.total, reading.cores.busy)
      assert.isAbove(reading.memory.total, 0)
      assert.isAtMost(reading.memory.used, reading.memory.total)
      // Where `ps` may run, the listing holds this very process.
      if (reading.processes !== null) assert.isTrue(reading.processes.has(process.pid))
      // Read as each system would be, on whichever this is: what isn't there falls back to what Node says.
      for (const platform of ['darwin', 'linux'] as const) {
        const as = yield* readMachine(platform)
        assert.isAbove(as.memory.total, 0)
        assert.isAtMost(as.memory.used, as.memory.total)
        if (platform === 'linux') assert.isNull(as.pressure)
      }
      // Where processes can't be listed and nothing says the pressure, neither is guessed.
      const elsewhere = yield* readMachine('win32')
      assert.isNull(elsewhere.processes)
      assert.isNull(elsewhere.pressure)
      assert.isAtMost(elsewhere.memory.used, elsewhere.memory.total)
    }),
  )

  it.live('reads whose work a process is from its environment, as this computer gives it', () =>
    Effect.gen(function* () {
      if (process.platform !== 'darwin' && process.platform !== 'linux') return
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', [WORK]: 'task:t1' },
        stdio: 'ignore',
      })
      yield* Effect.callback<void>((resume) => void child.once('spawn', () => resume(Effect.void)))
      // On a Mac, the reader's, built first, as it would be by then: else `ps`'s, which gives it as well.
      if (process.platform === 'darwin') yield* Effect.promise(() => buildReader())
      const marks = yield* marksOf()([child.pid ?? 0, process.pid])
      child.kill()
      assert.deepStrictEqual(Object.fromEntries(marks), { [child.pid ?? 0]: 'task:t1' })
    }),
  )

  it.live('counts what the children a Mac process reaped used, where the reader can be built', () =>
    Effect.gen(function* () {
      if (process.platform !== 'darwin') return
      const reader = yield* Effect.promise(() => buildReader())
      // Without the Command Line Tools there is no reader, and `ps` reads the processes.
      if (reader === null) return
      const own = (text: string | null) => listingOfReader(text ?? '').get(process.pid)?.cpu ?? 0
      const before = own(yield* Effect.promise(() => runReader(reader)))
      execFileSync(process.execPath, ['-e', 'const t = Date.now(); while (Date.now() - t < 400) {}'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      const after = own(yield* Effect.promise(() => runReader(reader)))
      // The child worked 400 ms and ended; this process waited on it, its own time barely moving.
      assert.isAtLeast(after - before, 350)
    }),
  )
})
