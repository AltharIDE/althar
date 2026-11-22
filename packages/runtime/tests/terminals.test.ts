import { basename } from 'node:path'

import { until } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Stream } from 'effect'

import { Launches } from '../src/Launches'
import { Live, type LiveEvent } from '../src/Live'
import { NotFound } from '../src/errors'
import { envOf, isShell, keptOf, type Pty, type PtyOptions, PtySpawner, shellOf, Terminals } from '../src/Terminals'

/*
 * The person's own terminals: one opens in the folder asked for, what it
 * prints reaches every window attached and is kept for one that attaches
 * again, the keys and size go to the shell, a window that can't keep up holds
 * the shell, what runs in front says closing it stops something, and one
 * that ends well is gone while one that ends badly stays to say how.
 */

class FakePty implements Pty {
  readonly pid = 4242
  /** In front, the shell it started as, whichever the system's is, till a test says otherwise. */
  process: string
  readonly written: Array<string> = []
  readonly sizes: Array<readonly [number, number]> = []
  paused = false
  killed = false
  private data: Array<(data: string) => void> = []
  private exit: Array<(exit: { readonly exitCode: number; readonly signal?: number }) => void> = []
  constructor(
    readonly file: string,
    readonly options: PtyOptions,
  ) {
    this.process = basename(file)
  }
  onData(listener: (data: string) => void) {
    this.data.push(listener)
  }
  onExit(listener: (exit: { readonly exitCode: number; readonly signal?: number }) => void) {
    this.exit.push(listener)
  }
  write(data: string) {
    this.written.push(data)
  }
  resize(cols: number, rows: number) {
    this.sizes.push([cols, rows])
  }
  pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
  kill() {
    this.killed = true
  }
  print(data: string) {
    for (const listener of this.data) listener(data)
  }
  end(exitCode: number) {
    for (const listener of this.exit) listener({ exitCode })
  }
  endBy(exitCode: number, signal: number) {
    for (const listener of this.exit) listener({ exitCode, signal })
  }
}

/** The service with fake shells, or with what a test starts them with instead. */
const setUp = (spawn?: PtySpawner['Service']['spawn']) => {
  const ptys: Array<FakePty> = []
  const asked: Array<{ readonly projectId: string; readonly taskId: string | null; readonly launchId?: string }> = []
  const launches = Layer.succeed(
    Launches,
    Launches.of({
      terminalFolder: (input: { readonly projectId: string; readonly taskId: string | null; readonly launchId?: string }) =>
        Effect.sync(() => {
          asked.push(input)
          return input.launchId !== undefined
            ? { path: '/runs/ios', where: 'main' }
            : input.taskId === null
              ? { path: '/repo', where: 'althar' }
              : { path: `/worktrees/${input.taskId}`, where: 'A task' }
        }),
    } as unknown as Launches['Service']),
  )
  const spawner = Layer.succeed(
    PtySpawner,
    PtySpawner.of({
      spawn:
        spawn ??
        ((file, _args, options) => {
          const pty = new FakePty(file, options)
          ptys.push(pty)
          return pty
        }),
    }),
  )
  const layer = Terminals.layer.pipe(Layer.provideMerge(Layer.mergeAll(launches, spawner, Live.layer)))
  return { ptys, asked, layer }
}

/** What has been printed of a terminal, as a window attached to it sees it. */
const reading = (terminals: Terminals['Service'], id: string) =>
  Effect.gen(function* () {
    const seen: Array<string> = []
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(terminals.attach(id), (chunk) =>
        Effect.sync(() => seen.push(chunk._tag === 'Data' ? chunk.data : `[exit ${chunk.code}]`)),
      ),
    )
    yield* Effect.sleep('5 millis')
    return { seen, fiber }
  })

const settle = Effect.sleep('20 millis')

describe('terminals', () => {
  it.live('opens in the folder asked for, once by its id, and says so', () => {
    const { ptys, asked, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      const live = yield* Live
      const events: Array<LiveEvent> = []
      yield* Effect.forkChild(Stream.runForEach(yield* live.subscribe, (event) => Effect.sync(() => events.push(event))))
      const project = yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const task = yield* terminals.open({ id: 'term_task0001', projectId: 'p', taskId: 't', cols: 100, rows: 30 })
      const run = yield* terminals.open({ id: 'term_fromrun1', projectId: 'p', taskId: null, launchId: 'l', cols: 80, rows: 24 })
      const again = yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      assert.deepStrictEqual([project.folder, task.folder, run.folder, again.folder], ['/repo', '/worktrees/t', '/runs/ios', '/repo'])
      assert.deepStrictEqual([project.where, task.where, run.where], ['althar', 'A task', 'main'])
      assert.strictEqual(ptys.length, 3)
      assert.strictEqual(asked.length, 3)
      assert.deepStrictEqual([ptys[1]?.options.cwd, ptys[1]?.options.cols, ptys[1]?.options.rows], ['/worktrees/t', 100, 30])
      assert.strictEqual(ptys[0]?.options.env.TERM, 'xterm-256color')
      assert.deepStrictEqual(
        (yield* terminals.ofProject('p')).map((one) => one.id),
        ['term_project1', 'term_task0001', 'term_fromrun1'],
      )
      assert.deepStrictEqual((yield* terminals.ofProject('elsewhere')).length, 0)
      yield* settle
      const last = events.findLast((event) => event._tag === 'Terminals')
      assert.strictEqual(last?._tag === 'Terminals' ? last.terminals.length : 0, 3)
    }).pipe(Effect.provide(layer))
  })

  it.live('sends what it prints to each window, and what it printed before to one that attaches later', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const pty = ptys[0]!
      const first = yield* reading(terminals, 'term_project1')
      pty.print('$ ')
      pty.print('ls\r\n')
      const output = (window: typeof first) => Effect.sync(() => window.seen.join(''))
      yield* until(output(first), (data) => data === '$ ls\r\n')
      const second = yield* reading(terminals, 'term_project1')
      yield* until(output(second), (data) => data === '$ ls\r\n')
      pty.print('a.txt\r\n')
      yield* until(output(second), (data) => data === '$ ls\r\na.txt\r\n')
      yield* until(output(first), (data) => data === '$ ls\r\na.txt\r\n')
      yield* terminals.write('term_project1', 'echo hi\r')
      yield* terminals.resize('term_project1', 120, 40)
      assert.deepStrictEqual(pty.written, ['echo hi\r'])
      assert.deepStrictEqual(pty.sizes, [[120, 40]])
      yield* Fiber.interrupt(first.fiber)
      yield* Fiber.interrupt(second.fiber)
    }).pipe(Effect.provide(layer))
  })

  it.live('holds the shell while a window can’t keep up, and lets it go once it has', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const pty = ptys[0]!
      // A window that takes nothing: what waits for it fills, and the shell is held.
      const pulled = yield* Stream.toPull(terminals.attach('term_project1'))
      for (let i = 0; i < 40; i++) {
        pty.print(`line ${i}\r\n`)
        yield* settle
      }
      assert.isTrue(pty.paused)
      // It reads all that waited, and the shell goes on, nothing lost.
      let read = ''
      while (!read.includes('line 39')) read += (yield* pulled).map((chunk) => (chunk._tag === 'Data' ? chunk.data : '')).join('')
      yield* settle
      assert.isFalse(pty.paused)
      for (let i = 0; i < 40; i++) assert.include(read, `line ${i}\r\n`)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.live('says a shell ended after all that waited for a window behind, and lets the shell go for a window that leaves', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      yield* terminals.open({ id: 'term_behind1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const pty = ptys[0]!
      const pulled = yield* Stream.toPull(terminals.attach('term_behind1'))
      for (let i = 0; i < 40; i++) {
        pty.print(`line ${i}\r\n`)
        yield* settle
      }
      assert.isTrue(pty.paused)
      pty.end(1)
      yield* settle
      // Everything it printed comes first, then how it ended.
      const read: Array<string> = []
      while (!read.includes('[exit 1]'))
        for (const chunk of yield* pulled) read.push(chunk._tag === 'Data' ? chunk.data : `[exit ${chunk.code}]`)
      assert.include(read.join(''), 'line 39')
      assert.strictEqual(read.at(-1), '[exit 1]')

      // A window that leaves while behind holds the shell no longer.
      yield* terminals.open({ id: 'term_behind2', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const other = ptys[1]!
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Stream.toPull(terminals.attach('term_behind2'))
          for (let i = 0; i < 40; i++) {
            other.print(`line ${i}\r\n`)
            yield* settle
          }
          assert.isTrue(other.paused)
        }),
      )
      yield* settle
      assert.isFalse(other.paused)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.live('says what runs in front, so closing it, or quitting, says it stops something', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      yield* terminals.open({ id: 'term_other1', projectId: 'q', taskId: null, cols: 80, rows: 24 })
      const pty = ptys[0]!
      const [idle] = yield* terminals.ofProject('p')
      assert.isFalse(idle?.busy)
      assert.strictEqual(yield* terminals.busy, 0)
      pty.process = 'bun'
      yield* Effect.sleep('1100 millis')
      const [busy] = yield* terminals.ofProject('p')
      assert.deepStrictEqual([busy?.busy, busy?.title], [true, 'bun'])
      // Quit counts it, in any project; the idle shell beside it, not.
      assert.strictEqual(yield* terminals.busy, 1)
      yield* terminals.close('term_project1')
      assert.isTrue(pty.killed)
      assert.strictEqual((yield* terminals.ofProject('p')).length, 0)
      assert.strictEqual(yield* terminals.busy, 0)
    }).pipe(Effect.provide(layer))
  })

  it.live('is gone once its shell ends well, and stays to say how where it ended badly', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      yield* terminals.open({ id: 'term_project2', projectId: 'p', taskId: 't', cols: 80, rows: 24 })
      const window = yield* reading(terminals, 'term_project2')
      ptys[0]!.end(0)
      ptys[1]!.print('bye\r\n')
      ptys[1]!.end(130)
      yield* settle
      assert.deepStrictEqual(
        (yield* terminals.ofProject('p')).map((one) => [one.id, one.exited?.code ?? null, one.busy]),
        [['term_project2', 130, false]],
      )
      assert.deepStrictEqual(window.seen, ['bye\r\n', '[exit 130]'])
      // A window that comes back sees how it ended.
      const later = yield* reading(terminals, 'term_project2')
      yield* settle
      assert.deepStrictEqual(later.seen, ['bye\r\n', '[exit 130]'])
      const missing = yield* Effect.flip(terminals.write('term_project1', 'x'))
      assert.strictEqual(missing._tag, 'NotFound')
      // The task settles: its terminals close.
      yield* terminals.closeAll('p', 't')
      assert.strictEqual((yield* terminals.ofProject('p')).length, 0)
    }).pipe(Effect.provide(layer))
  })

  it.live('stops every shell as the runtime stops', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const terminals = yield* Terminals
        yield* terminals.open({ id: 'term_project1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      }).pipe(Effect.provide(layer))
      assert.isTrue(ptys[0]?.killed)
    })
  })
})

describe('terminals that aren’t there, or have ended', () => {
  it.live('says a terminal it doesn’t have is gone, and leaves one that ended badly alone', () => {
    const { ptys, layer } = setUp()
    return Effect.gen(function* () {
      const terminals = yield* Terminals
      const missing = yield* Effect.flip(Stream.runDrain(terminals.attach('term_none')))
      assert.instanceOf(missing, NotFound)
      // Closing what isn't there, or a project with none, changes nothing.
      yield* terminals.close('term_none')
      yield* terminals.closeAll('nowhere')
      yield* terminals.open({ id: 'term_ended1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      const pty = ptys[0]!
      pty.end(1)
      yield* settle
      // Keys and a new size for a shell that ended go nowhere.
      yield* Effect.ignore(terminals.write('term_ended1', 'ls\n'))
      yield* Effect.ignore(terminals.resize('term_ended1', 100, 30))
      assert.deepStrictEqual([pty.written, pty.sizes], [[], []])
      assert.strictEqual((yield* terminals.ofProject('p')).length, 1)
      // One stopped by a signal stays too, though its code was 0.
      yield* terminals.open({ id: 'term_signal1', projectId: 'p', taskId: null, cols: 80, rows: 24 })
      ptys[1]!.endBy(0, 9)
      yield* settle
      assert.strictEqual((yield* terminals.ofProject('p')).length, 2)
    }).pipe(Effect.provide(layer))
  })

  for (const thrown of [new Error('no such file'), 'refused'])
    it.live(`says why a shell couldn’t start (${String(thrown)})`, () => {
      const { layer } = setUp(() => {
        throw thrown
      })
      return Effect.gen(function* () {
        const failed = yield* Effect.flip((yield* Terminals).open({ id: 'term_fail1', projectId: 'p', taskId: null, cols: 80, rows: 24 }))
        assert.include(String(failed), `couldn't start`)
        assert.include(String(failed), thrown instanceof Error ? thrown.message : thrown)
      }).pipe(Effect.provide(layer))
    })
})

describe('a terminal’s shell and what it keeps', () => {
  it('starts the person’s own shell as a login shell, else the system’s', () => {
    assert.deepStrictEqual(
      shellOf('darwin', { SHELL: '/opt/homebrew/bin/fish' }, () => true),
      {
        file: '/opt/homebrew/bin/fish',
        args: ['-l'],
      },
    )
    assert.deepStrictEqual(
      shellOf('darwin', { SHELL: '/gone' }, () => false),
      { file: '/bin/zsh', args: ['-l'] },
    )
    assert.deepStrictEqual(
      shellOf('linux', {}, (path) => path === '/bin/bash'),
      { file: '/bin/bash', args: ['-l'] },
    )
    assert.deepStrictEqual(
      shellOf('linux', {}, () => false),
      { file: '/bin/sh', args: ['-l'] },
    )
    assert.strictEqual(shellOf('win32', { SHELL: '/bin/zsh' }).file, 'powershell.exe')
  })

  it('gives the shell Althar’s environment, less Althar’s own, as a colour terminal', () => {
    const env = envOf(
      { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', ALTHAR_PROFILE: 'x', NODE_OPTIONS: '--inspect', HOME: '/h', EMPTY: undefined },
      'darwin',
      '0.9.0',
    )
    assert.deepStrictEqual(env, {
      PATH: '/usr/bin',
      HOME: '/h',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Althar',
      TERM_PROGRAM_VERSION: '0.9.0',
      LANG: 'en_US.UTF-8',
    })
    assert.strictEqual(envOf({ LANG: 'de_DE.UTF-8' }, 'linux', '1').LANG, 'de_DE.UTF-8')
    assert.isUndefined(envOf({}, 'win32', '1').LANG)
  })

  it('tells the shell from a program in front of it, a login shell’s dash and Windows’ .exe too', () => {
    assert.isTrue(isShell('zsh', '/bin/zsh'))
    assert.isTrue(isShell('-zsh', '/bin/zsh'))
    assert.isTrue(isShell('', '/bin/zsh'))
    assert.isTrue(isShell('powershell.exe', 'powershell.exe'))
    assert.isFalse(isShell('vim', '/bin/zsh'))
    // Linux names it by its path, as it was started.
    assert.isTrue(isShell('/bin/bash', '/bin/bash'))
    assert.isTrue(isShell('-/bin/bash', '/bin/bash'))
    assert.isTrue(isShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell.exe'))
    assert.isFalse(isShell('/usr/bin/sleep', '/bin/bash'))
  })

  it.live('starts a real shell through node-pty, and hears what it prints and that it ended', () =>
    Effect.gen(function* () {
      const { spawn } = yield* PtySpawner
      const windows = process.platform === 'win32'
      const pty = spawn(windows ? 'cmd.exe' : '/bin/sh', windows ? ['/c', 'echo althar-pty'] : ['-c', 'echo althar-pty'], {
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        env: envOf(process.env, process.platform, '1'),
      })
      let printed = ''
      const [heard, exit] = yield* Effect.all(
        [
          Effect.callback<string>((resume) => {
            pty.onData((data) => {
              printed += data
              if (printed.includes('althar-pty')) resume(Effect.succeed(printed))
            })
          }),
          Effect.callback<number>((resume) => {
            pty.onExit(({ exitCode }) => resume(Effect.succeed(exitCode)))
          }),
        ],
        { concurrency: 'unbounded' },
      )
      assert.include(heard, 'althar-pty')
      assert.strictEqual(exit, 0)
    }).pipe(Effect.provide(PtySpawner.node)),
  )

  it('keeps the end of what was printed, cut at the start of a line', () => {
    const pieces = ['first line\nsecond line\n', 'third\n']
    const size = keptOf(pieces, 29, 19)
    assert.deepStrictEqual(pieces, ['second line\n', 'third\n'])
    assert.strictEqual(size, 18)
    const whole = ['a\nb\n']
    assert.strictEqual(keptOf(whole, 4, 10), 4)
    assert.deepStrictEqual(whole, ['a\nb\n'])
    const many = ['xxxx', 'yyyy', 'zz\nzz']
    assert.strictEqual(keptOf(many, 13, 4), 2)
    // A piece with no line in what is kept of it goes whole.
    const one = ['abcdefghij']
    assert.strictEqual(keptOf(one, 10, 4), 0)
    assert.deepStrictEqual(one, [''])
    assert.deepStrictEqual(many, ['zz'])
  })
})
