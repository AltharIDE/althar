import { createServer } from 'node:net'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { listenersOfLsof, listenersOfNetstat, listenersOfSs, localAddress, parentsOf, portsBelow, treeOf } from '../src/ports'

/*
 * Where something left running listens, found from the machine: its
 * processes' tree and the ports in it, as lsof, ss and netstat say them.
 */

describe('the processes something started', () => {
  it('reads each process’s parent and walks a tree down from its root', () => {
    const parents = parentsOf('    1     0\n  100     1\n  200   100\n  201   100\n  300   200\n  400     1\nnot a line\n')
    assert.deepStrictEqual([...treeOf(parents, [100])].sort(), [100, 200, 201, 300])
    assert.deepStrictEqual([...treeOf(parents, [200, 400])].sort(), [200, 300, 400])
    assert.deepStrictEqual([...treeOf(parents, [])], [])
  })
})

describe('the ports listened on, as each tool says them', () => {
  it('reads lsof’s, on this machine only', () => {
    const out = 'p4242\nf21\nn*:5173\nn127.0.0.1:24678\np4300\nn[::1]:3000\nn192.168.1.20:8080\np4400\nn[::]:8000\nnlocalhost:9229\n'
    assert.deepStrictEqual(listenersOfLsof(out), [
      { pid: 4242, port: 5173 },
      { pid: 4242, port: 24678 },
      { pid: 4300, port: 3000 },
      { pid: 4400, port: 8000 },
      { pid: 4400, port: 9229 },
    ])
  })

  it('reads ss’s, which says the process in its last column', () => {
    const out = [
      'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=19))',
      'LISTEN 0 4096 *:3000 *:* users:(("bun",pid=4300,fd=7),("bun",pid=4301,fd=7))',
      'LISTEN 0 128 10.0.0.5:22 0.0.0.0:*',
      'ESTAB 0 0 127.0.0.1:5173 127.0.0.1:60000 users:(("node",pid=4242,fd=20))',
    ].join('\n')
    assert.deepStrictEqual(listenersOfSs(out), [
      { pid: 4242, port: 5173 },
      { pid: 4300, port: 3000 },
      { pid: 4301, port: 3000 },
    ])
  })

  it('reads netstat’s, on Windows', () => {
    const out = [
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242',
      '  TCP    [::1]:3000             [::]:0                 LISTENING       4300',
      '  TCP    192.168.1.20:139       0.0.0.0:0              LISTENING       4',
      '  TCP    127.0.0.1:5173         127.0.0.1:55000        ESTABLISHED     4242',
    ].join('\r\n')
    assert.deepStrictEqual(listenersOfNetstat(out), [
      { pid: 4242, port: 5173 },
      { pid: 4300, port: 3000 },
    ])
  })

  it('says where a port answers as a browser opens it', () => {
    assert.strictEqual(localAddress(5173), 'http://localhost:5173/')
  })
})

describe.skipIf(process.platform === 'win32')('a server listening on this machine', () => {
  it.effect('is found by its process, and not from one that started none', () =>
    Effect.gen(function* () {
      const server = createServer()
      yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)))
      try {
        const address = server.address()
        const port = typeof address === 'object' && address !== null ? address.port : -1
        assert.include(yield* portsBelow([process.pid]), port)
        // Its parent's tree holds it too; a process that isn't its ancestor doesn't.
        assert.include(yield* portsBelow([process.ppid]), port)
        assert.deepStrictEqual(yield* portsBelow([]), [])
        assert.notInclude(yield* portsBelow([2_147_483_000]), port)
      } finally {
        server.close()
      }
    }),
  )
})
