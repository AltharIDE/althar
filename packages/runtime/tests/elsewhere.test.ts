import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { compacted, describeWorktree, taskTitleOf, titleOfBranch } from '../src/Elsewhere'
import { claudeFolder, claudeTranscript, codexTranscript, titleFrom } from '../src/elsewhere/conversations'
import { lookAt, statusCount } from '../src/elsewhere/look'
import { madeBy, placesOf, within } from '../src/elsewhere/places'
import { setupsIn, tomlKey, withPlaces, yamlScript } from '../src/elsewhere/setups'
import { isoOf, readCopy } from '../src/elsewhere/stores'

import { computer, digest, PHRASE, sessionIds } from './elsewhereFixtures'
import { repository } from './support'

/*
 * What other tools left for a repository, read as each tool's own code writes it (docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"): worktrees found through git and named from each tool's store, the setups each keeps, and
 * Claude Code's and Codex's conversations, with nothing of any tool's changed.
 */

const look = (machine: ReturnType<typeof computer>) =>
  lookAt([{ bindingId: 'b1', name: 'meridian', path: machine.repository, defaultBranch: 'main' }], placesOf(machine.home, {}, 'darwin'), {
    ours: (path) => within(path, join(machine.home, 'Althar')),
    sessions: new Set(),
  })

describe('looking elsewhere', () => {
  it.effect(
    'finds every worktree another tool made, says whose and what it holds, and leaves out the checkout, Althar’s and gone ones',
    () =>
      Effect.gen(function* () {
        const machine = computer(repository())
        const found = yield* look(machine)
        const by = (path: string) => found.worktrees.find((one) => one.path === path)
        assert.deepStrictEqual(found.worktrees.map((one) => one.tool).toSorted(), [
          'codex',
          'conductor',
          'cursor',
          'hand',
          'orca',
          'paradev',
          't_three_code',
        ])
        const lima = by(machine.worktrees.conductor)
        assert.strictEqual(lima?.branch, 'feature/lima')
        assert.strictEqual(lima?.name, 'lima')
        assert.strictEqual(lima?.uncommitted, 1)
        assert.strictEqual(lima?.ahead, 1)
        assert.strictEqual(lima?.unpushed, 1)
        // Named from Orca's store, its pull request with it.
        const orca = by(machine.worktrees.orca)
        assert.strictEqual(orca?.name, 'Flaky login test')
        assert.strictEqual(orca?.asked, 'Fix the flaky login test')
        assert.deepStrictEqual(orca?.pullRequest, { number: 91, url: 'https://github.com/acme/meridian/pull/91' })
        assert.strictEqual(orca?.uncommitted, 1)
        assert.strictEqual(by(machine.worktrees.t3)?.name, 'Dark mode toggle')
        assert.strictEqual(by(machine.worktrees.t3)?.pullRequest?.number, 93)
        assert.strictEqual(by(machine.worktrees.paradev)?.name, 'Search box')
        // Codex's are detached, and named after the folder Codex made for them.
        assert.strictEqual(by(machine.worktrees.codex)?.branch, null)
        assert.strictEqual(by(machine.worktrees.codex)?.name, 'ab12')
        assert.strictEqual(by(machine.worktrees.hand)?.tool, 'hand')
        assert.isUndefined(by(machine.worktrees.ours))
        assert.isUndefined(found.worktrees.find((one) => one.branch === 'feature/oslo'))
      }),
  )

  it.effect(
    'reads Claude Code’s and Codex’s conversations there, each in the worktree it ran in, and none Althar’s or a sibling folder’s',
    () =>
      Effect.gen(function* () {
        const machine = computer(repository())
        const found = yield* look(machine)
        const keys = found.conversations.map((one) => one.key).toSorted()
        assert.deepStrictEqual(keys, [
          `claude_code:${sessionIds.inRoot}`,
          `claude_code:${sessionIds.inLima}`,
          `codex:${sessionIds.codexLegacy}`,
          `codex:${sessionIds.codexPaged}`,
        ])
        const by = (key: string) => found.conversations.find((one) => one.key === key)
        assert.strictEqual(by(`claude_code:${sessionIds.inRoot}`)?.title, 'Gyroscope fixture failing on CI')
        assert.strictEqual(by(`claude_code:${sessionIds.inRoot}`)?.prompts, 1)
        assert.strictEqual(by(`claude_code:${sessionIds.inRoot}`)?.worktree, null)
        assert.strictEqual(by(`claude_code:${sessionIds.inLima}`)?.title, 'Lima export')
        assert.strictEqual(by(`claude_code:${sessionIds.inLima}`)?.worktree, `worktree:${machine.worktrees.conductor}`)
        assert.strictEqual(by(`codex:${sessionIds.codexLegacy}`)?.title, 'Rename to compass')
        assert.strictEqual(by(`codex:${sessionIds.codexPaged}`)?.worktree, `worktree:${machine.worktrees.codex}`)
        // A session Althar's own agent had is never offered.
        const ours = yield* lookAt(
          [{ bindingId: 'b1', name: 'meridian', path: machine.repository, defaultBranch: 'main' }],
          placesOf(machine.home, {}, 'darwin'),
          { ours: () => false, sessions: new Set([sessionIds.inRoot]) },
        )
        assert.isUndefined(ours.conversations.find((one) => one.id === sessionIds.inRoot))
      }),
  )

  it.effect('lists Codex’s conversations from its state database where it has one, leaving out archived, sub-agents’ and exec’s', () =>
    Effect.gen(function* () {
      const machine = computer(repository(), { codexState: true })
      const found = yield* look(machine)
      const codex = found.conversations.filter((one) => one.agent === 'codex')
      assert.deepStrictEqual(
        codex.map((one) => one.id),
        [sessionIds.codexLegacy],
      )
      assert.strictEqual(codex[0]?.title, 'Rename to compass')
      assert.strictEqual(codex[0]?.startedAt, new Date(1_794_477_600_000).toISOString())
      // A week on, Codex compresses it beside where its database still says it is: read from there all the same.
      const file = codex[0]?.file ?? ''
      writeFileSync(`${file}.zst`, zstdCompressSync(readFileSync(file)))
      rmSync(file)
      const messages = yield* Effect.promise(() => codexTranscript(file))
      assert.deepStrictEqual(
        messages.map((one) => one.text),
        ['Rename the meridian module', 'Renamed it to compass.'],
      )
    }),
  )

  it.effect('changes nothing of any tool’s: their homes and the worktrees’ git folders read the same to the byte', () =>
    Effect.gen(function* () {
      const machine = computer(repository())
      const before = [digest(machine.home), digest(join(machine.repository, '.git', 'worktrees'))]
      yield* look(machine)
      yield* Effect.promise(() =>
        claudeTranscript(join(machine.home, '.claude', 'projects', claudeFolder(machine.repository), `${sessionIds.inRoot}.jsonl`)),
      )
      assert.deepStrictEqual([digest(machine.home), digest(join(machine.repository, '.git', 'worktrees'))], before)
    }),
  )

  it.effect('knows a tool’s worktrees by where it makes them, though the home is reached through a link', () =>
    Effect.gen(function* () {
      const machine = computer(repository())
      const link = join(mkdtempSync(join(tmpdir(), 'althar-link-')), 'home')
      symlinkSync(machine.home, link)
      const found = yield* lookAt(
        [{ bindingId: 'b1', name: 'meridian', path: machine.repository, defaultBranch: 'main' }],
        placesOf(link, {}, 'darwin'),
        { ours: (path) => within(path, join(machine.home, 'Althar')), sessions: new Set() },
      )
      assert.strictEqual(found.worktrees.find((one) => one.path === machine.worktrees.conductor)?.tool, 'conductor')
      assert.strictEqual(found.worktrees.find((one) => one.path === machine.worktrees.cursor)?.tool, 'cursor')
    }),
  )

  it.effect('finds nothing, without failing, where no tool left anything', () =>
    Effect.gen(function* () {
      const home = mkdtempSync(join(tmpdir(), 'althar-empty-home-'))
      const found = yield* lookAt([{ bindingId: 'b', name: 'r', path: repository(), defaultBranch: 'main' }], placesOf(home, {}, 'linux'), {
        ours: () => false,
        sessions: new Set(),
      })
      assert.deepStrictEqual(found, { worktrees: [], setups: [], conversations: [] })
    }),
  )
})

describe('conversations', () => {
  it.effect('keeps the person’s words and the agent’s replies, a reply’s blocks as one, without notes, tool results or side chains', () =>
    Effect.gen(function* () {
      const machine = computer(repository())
      const messages = yield* Effect.promise(() =>
        claudeTranscript(join(machine.home, '.claude', 'projects', claudeFolder(machine.repository), `${sessionIds.inRoot}.jsonl`)),
      )
      assert.deepStrictEqual(
        messages.map((one) => [one.role, one.text]),
        [
          ['person', `Why does the ${PHRASE} fail on CI?`],
          ['agent', 'Looking at the test first.'],
          ['agent', 'The fixture rounds too early. Fixed.'],
        ],
      )
      assert.strictEqual(messages[0]?.at, '2026-11-10T09:00:01.000Z')
    }),
  )

  it.effect('reads Codex’s events, older and paginated, from a compressed rollout too, and its messages where it has no events', () =>
    Effect.gen(function* () {
      const machine = computer(repository())
      const day = join(machine.home, '.codex', 'sessions', '2026', '11', '12')
      const paged = yield* Effect.promise(() =>
        codexTranscript(join(day, `rollout-2026-11-12T11-00-00-${sessionIds.codexPaged}.jsonl.zst`)),
      )
      assert.deepStrictEqual(
        paged.map((one) => [one.role, one.text]),
        [
          ['person', 'Try the detached idea'],
          ['agent', 'Trying it.'],
          ['agent', 'It works.'],
        ],
      )
      const old = join(day, 'rollout-old.jsonl')
      writeFileSync(
        old,
        [
          {
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for x' }] },
          },
          { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] } },
          { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] } },
          'not json',
        ]
          .map((one) => (typeof one === 'string' ? one : JSON.stringify(one)))
          .join('\n'),
      )
      const items = yield* Effect.promise(() => codexTranscript(old))
      assert.deepStrictEqual(
        items.map((one) => [one.role, one.text]),
        [
          ['person', 'Hello'],
          ['agent', 'Hi'],
        ],
      )
    }),
  )

  it('names folders as Claude Code does, a long one cut and marked by its hash', () => {
    assert.strictEqual(claudeFolder('/Users/a.b/my_repo'), '-Users-a-b-my-repo')
    const long = `/x/${'a'.repeat(240)}`
    assert.strictEqual(claudeFolder(long).length, 200 + 1 + claudeFolder(long).split('-').at(-1)!.length)
    assert.notStrictEqual(claudeFolder(long), claudeFolder(`${long}b`))
    assert.strictEqual(titleFrom(`${'word '.repeat(30)}\nsecond line`).length, 80)
  })

  it('joins an agent’s messages in a turn into one reply, and cuts one too long to read', () => {
    const joined = compacted([
      { role: 'person', text: 'Go', at: null },
      { role: 'agent', text: 'One', at: null },
      { role: 'agent', text: 'x'.repeat(9_000), at: null },
    ])
    assert.strictEqual(joined.length, 2)
    assert.isTrue(joined[1]?.text.startsWith('One\n\nxxx'))
    assert.isTrue(joined[1]?.text.endsWith('more characters left out]'))
  })
})

describe('setups', () => {
  it.effect('reads each tool’s setup from the checkout, its variables for where the checkout is set first', () =>
    Effect.gen(function* () {
      const machine = computer(repository())
      const setups = yield* Effect.promise(() => setupsIn(machine.repository, 'main'))
      const by = (tool: string) => setups.find((one) => one.tool === tool)
      assert.deepStrictEqual(by('conductor')?.copy, ['.env'])
      assert.strictEqual(
        by('conductor')?.commands[0],
        `export CONDUCTOR_ROOT_PATH='${machine.repository}'\ncp "$CONDUCTOR_ROOT_PATH/.env" .env && bun install`,
      )
      assert.deepStrictEqual(by('orca')?.commands, ['pnpm install\npnpm build'])
      assert.deepStrictEqual(by('t_three_code')?.commands, ['bun install'])
      assert.deepStrictEqual(by('paradev')?.commands, [
        'bun install',
        `export SUPERSET_ROOT_PATH='${machine.repository}'\ncp $SUPERSET_ROOT_PATH/.env .env`,
      ])
      assert.deepStrictEqual(by('cursor')?.commands, [
        'npm ci',
        `export ROOT_WORKTREE_PATH='${machine.repository}'\ncp $ROOT_WORKTREE_PATH/.env .env`,
      ])
    }),
  )

  it('reads only the shapes of YAML and TOML a setup is written in', () => {
    assert.strictEqual(yamlScript('scripts:\n  setup: bun install # deps\n', 'setup'), 'bun install')
    assert.strictEqual(yamlScript("scripts:\n  setup: 'it''s'\n", 'setup'), "it's")
    assert.strictEqual(yamlScript('scripts:\n  setup: "a\\tb"\n', 'setup'), 'a\tb')
    assert.strictEqual(yamlScript('scripts:\n  setup: >\n    one\n    two\nnext: 1\n', 'setup'), 'one two')
    assert.strictEqual(yamlScript('scripts:\n  archive: x\nsetup: y\n', 'setup'), null)
    assert.strictEqual(yamlScript('other: 1\n', 'setup'), null)
    assert.deepStrictEqual(tomlKey('[setup]\nrun = ["a", \'b\', # c\n  "d"]\n', 'setup', 'run'), ['a', 'b', 'd'])
    assert.strictEqual(tomlKey("[setup]\nrun = '''\nraw \\n'''\n", 'setup', 'run'), 'raw \\n')
    assert.strictEqual(tomlKey('[scripts]\nsetup = "x"\n[other]\nsetup = "y"\n', 'scripts', 'setup'), 'x')
    assert.isUndefined(tomlKey('[setup]\nrun = 3\n', 'setup', 'run'))
    assert.isUndefined(tomlKey('[install]\nrun = "x"\n', 'setup', 'run'))
    assert.strictEqual(withPlaces('hand', 'echo $CONDUCTOR_ROOT_PATH', '/r', 'main'), 'echo $CONDUCTOR_ROOT_PATH')
    assert.strictEqual(
      withPlaces('conductor', 'cd "${CONDUCTOR_WORKSPACE_PATH}" && git diff $CONDUCTOR_DEFAULT_BRANCH', "/o'r", 'main'),
      `export CONDUCTOR_WORKSPACE_PATH="$PWD" CONDUCTOR_DEFAULT_BRANCH='main'\ncd "\${CONDUCTOR_WORKSPACE_PATH}" && git diff $CONDUCTOR_DEFAULT_BRANCH`,
    )
  })
})

describe('whose', () => {
  it('says whose a worktree is by where it is', () => {
    const places = placesOf('/h', { CODEX_HOME: '/c', T3CODE_HOME: '', SUPERSET_HOME_DIR: '/s' }, 'linux')
    const roots = { orca: ['/o'], t3: ['/t'], paradev: ['/p'] }
    const of = (path: string, codexMarked = false) => madeBy({ path, repository: '/r', codexMarked }, places, roots)
    assert.strictEqual(of('/h/conductor/workspaces/r/lima'), 'conductor')
    assert.strictEqual(of('/r/.conductor/lima'), 'conductor')
    assert.strictEqual(of('/o/lima'), 'orca')
    assert.strictEqual(of('/h/.t3/worktrees/r/x'), 't_three_code')
    assert.strictEqual(of('/t/x'), 't_three_code')
    assert.strictEqual(of('/s/worktrees/r/x'), 'paradev')
    assert.strictEqual(of('/p/x'), 'paradev')
    assert.strictEqual(of('/h/.cursor/worktrees/r/x'), 'cursor')
    assert.strictEqual(of('/c/worktrees/ab/r'), 'codex')
    assert.strictEqual(of('/anywhere', true), 'codex')
    assert.strictEqual(of('/r/.claude/worktrees/x'), 'claude_code')
    assert.strictEqual(of('/elsewhere/r-2'), 'hand')
    assert.isFalse(within('/a/bc', '/a/b'))
    assert.deepStrictEqual(placesOf('/h', {}, 'win32').orca, ['/h/AppData/Roaming/orca', '/h/AppData/Roaming/Orca'])
  })

  it('counts what git status lists, a rename once', () => {
    assert.strictEqual(statusCount(''), 0)
    assert.strictEqual(statusCount(' M a\0?? b\0R  new\0old\0'), 3)
  })

  it('reads times as tools write them, and a database that isn’t there as nothing', async () => {
    assert.strictEqual(isoOf(1_794_000_000), new Date(1_794_000_000_000).toISOString())
    assert.strictEqual(isoOf(1_794_000_000_000), new Date(1_794_000_000_000).toISOString())
    assert.strictEqual(isoOf('2026-11-12T10:00:00Z'), '2026-11-12T10:00:00.000Z')
    assert.isNull(isoOf('soon'))
    assert.isNull(isoOf(0))
    assert.isNull(await readCopy('/nowhere/at/all.db', () => 1))
  })

  it('tells a lead what it took over, and names the task as the tool did', () => {
    const worktree = {
      tool: 'conductor' as const,
      path: '/h/conductor/workspaces/r/lima',
      branch: 'feature/login-flake',
      head: 'a'.repeat(40),
      name: 'lima',
      uncommitted: 2,
      unpushed: 1,
      pullRequest: { number: 7, url: 'https://x/pull/7' },
    }
    const said = describeWorktree(worktree)
    assert.include(said, 'made in Conductor as “lima”')
    assert.include(said, '2 files changed and not committed, 1 commit not pushed, its pull request, #7')
    assert.include(
      describeWorktree({ ...worktree, tool: 'hand', branch: null, uncommitted: 0, unpushed: 0, pullRequest: null }),
      'detached at aaaaaaaaaaaa, made by hand',
    )
    // A folder's name is no title: the branch says more.
    assert.strictEqual(taskTitleOf(worktree), 'Login flake')
    assert.strictEqual(taskTitleOf({ ...worktree, name: 'Flaky login test' }), 'Flaky login test')
    assert.strictEqual(taskTitleOf({ ...worktree, name: '', branch: null }), 'Work brought in')
    assert.strictEqual(titleOfBranch('fix/'), 'fix/')
  })
})
