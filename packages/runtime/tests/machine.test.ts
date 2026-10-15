import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { coresOf, type Listed, listingOf, memoryOfMeminfo, pressureOf, readMachine, usedBy, usedOfVmStat } from '../src/machine'

/*
 * What this computer says of how hard it works (machine.ts), from what each
 * system prints: a Mac's `vm_stat` and memory pressure, Linux's meminfo, a
 * `ps` listing on either, and what each piece of work used between two.
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

  it('gives each piece of work what it and everything it started used between two listings, each process once', () => {
    const before = new Map([
      [10, listed(1, 1_000)],
      [11, listed(10, 500)],
      [20, listed(1, 100)],
      [30, listed(1, 9_000)],
    ])
    const after = new Map([
      // The lead, its command, and what that command started since.
      [10, listed(1, 1_200, 100)],
      [11, listed(10, 1_500, 200)],
      [12, listed(11, 300, 50)],
      // A run whose pid was another process's before, with less time than that one had: all of its time is new.
      [30, listed(1, 40, 10)],
      // Someone else's.
      [40, listed(1, 99_999, 999)],
    ])
    const used = usedBy(
      [
        { pid: 10, key: 'task t1' },
        // The same task's reviewer, started under the lead's tree: counted once, for the lead.
        { pid: 11, key: 'task t2' },
        // Gone since: nothing.
        { pid: 20, key: 'coordinator p1' },
        { pid: 30, key: 'run p1' },
      ],
      before,
      after,
    )
    assert.deepStrictEqual(Object.fromEntries(used), {
      'task t1': { cpu: 200 + 1_000 + 300, memory: 350, processes: 3 },
      'run p1': { cpu: 40, memory: 10, processes: 1 },
    })
  })

  it('adds up a piece of work started as several processes', () => {
    const after = new Map([
      [10, listed(1, 100, 1)],
      [20, listed(1, 50, 2)],
    ])
    const used = usedBy(
      [
        { pid: 10, key: 'task t1' },
        { pid: 20, key: 'task t1' },
      ],
      after,
      after,
    )
    assert.deepStrictEqual(used.get('task t1'), { cpu: 0, memory: 3, processes: 2 })
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
})
