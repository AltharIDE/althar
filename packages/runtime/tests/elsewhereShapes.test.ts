import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { claudeSession, claudeSessions, claudeTranscript, codexThreads, codexTranscript, titleFrom } from '../src/elsewhere/conversations'
import { branchFactsOf } from '../src/elsewhere/look'
import { placesOf } from '../src/elsewhere/places'
import { setupsIn, tomlKey, withPlaces, yamlScript } from '../src/elsewhere/setups'
import { isoOf, readStores } from '../src/elsewhere/stores'

import { gitIn } from './elsewhereFixtures'
import { repository } from './support'

/*
 * The shapes other tools write, older and odder ones included, as each is read (docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"): what isn't the person's or the agent's words is left out, a store or file of an older
 * version is read for what it has, and anything that isn't a shape a tool writes is nothing, never a guess.
 */

const folder = () => realpathSync(mkdtempSync(join(tmpdir(), 'althar-shapes-')))
const put = (path: string, body: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}
const jsonl = (lines: ReadonlyArray<unknown>) => lines.map((one) => (typeof one === 'string' ? one : JSON.stringify(one))).join('\n')
const database = (path: string, schema: string) => {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(schema)
  return db
}

describe('Claude Code’s files', () => {
  it('lists a session by its last name, its branch where it is on one, and the person’s words only', async () => {
    const at = folder()
    const file = join(at, 's1.jsonl')
    const user = (message: unknown, more: Record<string, unknown> = {}) => ({
      type: 'user',
      cwd: '/r',
      gitBranch: 'HEAD',
      timestamp: '2026-11-10T09:00:00.000Z',
      message,
      ...more,
    })
    put(
      file,
      jsonl([
        'not json',
        '',
        { type: 'summary', summary: 'From its summary' },
        { type: 'ai-title', aiTitle: '' },
        { type: 'custom-title', customTitle: '  ' },
        user({ content: 'An agent wrote this' }, { origin: { kind: 'agent' } }),
        user({ content: 7 }),
        user({ content: [{ type: 'text', text: '' }] }),
        user({ content: [{ type: 'text', text: '<user_query> Fix it </user_query>' }, { type: 'image' }] }),
        user({ content: 'Then the rest' }, { timestamp: 'never' }),
      ]),
    )
    const session = await claudeSession(file)
    assert.strictEqual(session?.title, 'From its summary')
    assert.strictEqual(session?.prompts, 2)
    assert.isNull(session?.branch)
    assert.strictEqual(session?.lastAt, '2026-11-10T09:00:00.000Z')

    // One where the person never wrote is no conversation.
    put(join(at, 's2.jsonl'), jsonl([user({ content: '<command-name>/clear</command-name>' })]))
    assert.isNull(await claudeSession(join(at, 's2.jsonl')))

    // One too long to read whole is listed from its ends, without how often the person wrote.
    put(
      join(at, 's3.jsonl'),
      jsonl([user({ content: 'Long one' }), { type: 'note', pad: 'x'.repeat(600 * 1024) }, user({ content: 'Last' })]),
    )
    const long = await claudeSession(join(at, 's3.jsonl'))
    assert.strictEqual(long?.title, 'Long one')
    assert.isNull(long?.prompts)
  })

  it('finds a working folder’s sessions, and nothing else in its folder', async () => {
    const home = folder()
    const projects = join(home, '.claude', 'projects', '-r')
    put(join(projects, 'a.jsonl'), jsonl([{ type: 'user', cwd: '/r', message: { content: 'Hello' } }]))
    put(join(projects, 'notes.txt'), 'not a session')
    const found = await claudeSessions(placesOf(home, {}, 'darwin'), ['/r'])
    assert.deepStrictEqual(
      found.map((one) => one.id),
      ['a'],
    )
  })

  it('keeps a reply written as text, joins blocks without an id, and leaves out what isn’t words', async () => {
    const file = join(folder(), 't.jsonl')
    put(
      file,
      jsonl([
        'not json',
        { type: 'user', message: { content: [{ type: 'text', text: 'Go' }] } },
        { type: 'assistant', message: { content: '  Plain reply  ' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'and more' }] } },
        { type: 'assistant', message: { content: 3 } },
        { type: 'assistant', isMeta: true, message: { content: 'meta' } },
        { type: 'user', message: { content: 'Next' } },
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'One' }] } },
        { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Two' }] } },
      ]),
    )
    const messages = await claudeTranscript(file)
    assert.deepStrictEqual(
      messages.map((one) => [one.role, one.text]),
      [
        ['person', 'Go'],
        ['agent', 'Plain reply\n\nand more'],
        ['person', 'Next'],
        ['agent', 'One'],
        ['agent', 'Two'],
      ],
    )
    assert.strictEqual(titleFrom('  First line  \nsecond'), 'First line')
  })
})

describe('Codex’s files', () => {
  it('leaves out what has no words, of events and of older messages alike', async () => {
    const at = folder()
    const events = join(at, 'rollout-events.jsonl')
    put(
      events,
      jsonl([
        { type: 'event_msg' },
        { type: 'event_msg', payload: { type: 'user_message', message: ' ' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage' } } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'Reasoning', content: [{ text: 'hmm' }] } } },
        { type: 'event_msg', payload: { type: 'token_count' } },
      ]),
    )
    assert.deepStrictEqual(
      (await codexTranscript(events)).map((one) => [one.role, one.text]),
      [['agent', 'Done.']],
    )
    const items = join(at, 'rollout-items.jsonl')
    put(
      items,
      jsonl([
        { type: 'response_item', payload: { type: 'message', role: 'user', content: 'not a list' } },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_image' }, { type: 'input_text', text: 'Hi' }] },
        },
        { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Rules' }] } },
        { type: 'response_item', payload: { type: 'reasoning' } },
      ]),
    )
    assert.deepStrictEqual(
      (await codexTranscript(items)).map((one) => [one.role, one.text]),
      [['person', 'Hi']],
    )
  })

  it('lists threads from a state database of any version, by the best name each has', async () => {
    const home = folder()
    const codex = join(home, '.codex')
    put(join(codex, 'session_index.jsonl'), jsonl([{ id: 'named', thread_name: 'Its given name' }, 'not json']))
    const db = database(
      join(codex, 'state_2.sqlite'),
      `CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, name TEXT, title TEXT, first_user_message TEXT, archived INTEGER)`,
    )
    const add = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)')
    add.run('named', '/f/1', '/r', 'A name', null, null, 0)
    add.run('byName', '/f/2', '/r', 'A name', 'A title', null, 0)
    add.run('byTitle', '/f/3', '/r', null, 'A title', null, 0)
    add.run('byWords', '/f/4', '/r/sub', null, null, 'What was asked\nand more', 0)
    add.run('nameless', '/f/5', '/r', null, null, null, 0)
    add.run(null, '/f/6', '/r', null, null, null, 0)
    add.run('elsewhere', '/f/7', '/other', null, null, null, 0)
    add.run('noCwd', '/f/8', null, null, null, null, 0)
    db.close()
    const found = await codexThreads(placesOf(home, {}, 'darwin'), ['/r'])
    assert.deepStrictEqual(
      found.map((one) => [one.id, one.title]),
      [
        ['named', 'Its given name'],
        ['byName', 'A name'],
        ['byTitle', 'A title'],
        ['byWords', 'What was asked'],
        ['nameless', 'Codex conversation'],
      ],
    )
    assert.isTrue(found.every((one) => one.startedAt === null && one.branch === null))
  })

  it('reads rollouts’ first records where its state database is too old to list them', async () => {
    const home = folder()
    const codex = join(home, '.codex')
    database(join(codex, 'state_1.sqlite'), 'CREATE TABLE threads (id TEXT, cwd TEXT)').close()
    const day = join(codex, 'sessions', '2026', '11', '12')
    const meta = (payload: Record<string, unknown>) => jsonl([{ type: 'session_meta', payload }])
    put(join(day, 'rollout-a.jsonl'), meta({ id: 'a', cwd: '/r', timestamp: '2026-11-12T10:00:00Z' }))
    put(join(day, 'rollout-b.jsonl'), jsonl([{ type: 'event_msg', payload: {} }]))
    put(join(day, 'rollout-c.jsonl'), meta({ id: 'c', cwd: '/r', source: 'exec' }))
    put(join(day, 'rollout-d.jsonl'), meta({ cwd: '/r' }))
    put(join(day, 'notes.txt'), 'not a rollout')
    const found = await codexThreads(placesOf(home, {}, 'darwin'), ['/r'])
    assert.deepStrictEqual(
      found.map((one) => [one.id, one.title, one.startedAt]),
      [['a', 'Codex conversation', '2026-11-12T10:00:00.000Z']],
    )
  })
})

describe('setup files', () => {
  it('reads YAML’s blocks and quotes, and nothing of a key with no value', () => {
    assert.strictEqual(yamlScript('scripts:\n\n  # a note\n  - odd\n  setup: |\n    one\n      two\n  archive: x\n', 'setup'), 'one\n  two')
    assert.strictEqual(yamlScript('scripts:\n  setup: |\n\n  next: 1\n', 'setup'), null)
    assert.strictEqual(yamlScript('scripts:\n  setup:\n', 'setup'), null)
    assert.strictEqual(yamlScript('scripts:\n  setup: "  "\n', 'setup'), null)
    assert.strictEqual(yamlScript('scripts:\r\n  setup: bun i\r\n', 'setup'), 'bun i')
  })

  it('reads TOML’s strings of every kind, and nothing of one it can’t', () => {
    assert.strictEqual(tomlKey('[setup]\nrun = """\nline \\\n  joined\\tand\\n"""\n', 'setup', 'run'), 'line joined\tand\n')
    assert.isUndefined(tomlKey('[setup]\nrun = """never closed\n', 'setup', 'run'))
    assert.isUndefined(tomlKey('[setup]\nrun = "never closed\n', 'setup', 'run'))
    assert.isUndefined(tomlKey('[setup]\nrun = "\\x"\n', 'setup', 'run'))
    assert.strictEqual(tomlKey("[setup]\nrun = 'literal'\n", 'setup', 'run'), 'literal')
    assert.isUndefined(tomlKey("[setup]\nrun = 'never closed\n", 'setup', 'run'))
    assert.isUndefined(tomlKey('[setup]\nrun = ["a", 3]\n', 'setup', 'run'))
    assert.isUndefined(tomlKey('[setup]\nrun = ["a" "b"]\n', 'setup', 'run'))
    assert.isUndefined(tomlKey('[setup]\nother = "x"\n', 'setup', 'run'))
    assert.strictEqual(
      withPlaces('orca', 'echo $ORCA_WORKSPACE_NAME', '/r', 'main'),
      'export ORCA_WORKSPACE_NAME="$(basename "$PWD")"\necho $ORCA_WORKSPACE_NAME',
    )
  })

  it('reads each tool’s setup as its older files and other shapes have it', async () => {
    const root = folder()
    put(join(root, '.conductor', 'settings.toml'), '[scripts]\nsetup = ["bun install", "", "bun run build"]\n')
    put(join(root, 't3.json'), JSON.stringify({ scripts: [{ command: 'skip' }, { runOnWorktreeCreate: true, command: '  ' }, 'odd'] }))
    put(join(root, '.superset', 'config.json'), JSON.stringify({ setup: ['npm ci', 4] }))
    put(join(root, '.cursor', 'worktrees.json'), JSON.stringify({ 'setup-worktree': 'setup.sh' }))
    const setups = await setupsIn(root, 'main')
    const by = (tool: string) => setups.find((one) => one.tool === tool)
    assert.deepStrictEqual(by('conductor'), {
      tool: 'conductor',
      file: '.conductor/settings.toml',
      commands: ['bun install', 'bun run build'],
      copy: [],
    })
    assert.isUndefined(by('t_three_code'))
    assert.deepStrictEqual(by('paradev')?.file, '.superset/config.json')
    assert.deepStrictEqual(by('paradev')?.commands, ['npm ci'])
    assert.deepStrictEqual(by('cursor')?.commands, [`bash '${join(root, '.cursor', 'setup.sh')}'`])

    // A setup run from a folder of the checkout goes there first; a file too big to be a setup is none.
    const other = folder()
    put(join(other, '.paradev', 'config.toml'), '[install]\nrun = "bun install"\ncwd = "web"\n[setup]\nrun = "bun run db"\n')
    put(join(other, 'conductor.json'), JSON.stringify({ scripts: { setup: 'x' }, pad: 'x'.repeat(300 * 1024) }))
    put(join(other, '.cursor', 'worktrees.json'), JSON.stringify({ 'setup-worktree-unix': ['npm ci'] }))
    const more = await setupsIn(other, 'main')
    assert.deepStrictEqual(
      more.map((one) => [one.tool, one.commands]),
      [
        ['paradev', ["cd 'web' && bun install", "cd 'web' && bun run db"]],
        ['cursor', ['npm ci']],
      ],
    )
  })
})

describe('tools’ stores', () => {
  it('reads each tool’s store as its older versions wrote it', async () => {
    const home = folder()
    // Orca: a second profile, with no database, its data in the old JSON file.
    const orca = join(home, 'Library', 'Application Support', 'orca')
    put(join(orca, 'orca-profile-index.json'), JSON.stringify({ profiles: [{ id: 'work' }, { name: 'no id' }, 'odd'] }))
    put(
      join(orca, 'profiles', 'work', 'orca-data.json'),
      JSON.stringify({
        repos: [{ path: '/r', worktreeBasePath: '../trees' }, { worktreeBasePath: '/abs/trees' }, { path: '/q' }],
        worktreeMeta: {
          'repo::/trees/a': { displayName: 'A', linkedPR: { url: 'https://x/pull/12/' }, createdAt: '2026-11-01T00:00:00Z' },
          'repo::/trees/b': { linkedPR: { url: 'https://x/pulls' } },
          'repo::': { displayName: 'No path' },
          'repo::/trees/c': 'odd',
        },
      }),
    )
    // T3 Code: the older projection, and its settings' folders.
    put(
      join(home, '.t3', 'userdata', 'settings.json'),
      JSON.stringify({ worktreesDirectory: '/t3now', previousWorktreesDirectories: ['/t3then', ''] }),
    )
    const t3 = database(
      join(home, '.t3', 'userdata', 'statev2.sqlite'),
      'CREATE TABLE projection_threads (title TEXT, worktree_path TEXT, created_at TEXT, deleted_at TEXT)',
    )
    t3.prepare('INSERT INTO projection_threads VALUES (?, ?, ?, NULL)').run('Old thread', '/t3then/x', '2026-10-01T00:00:00Z')
    t3.prepare('INSERT INTO projection_threads VALUES (?, ?, ?, NULL)').run('Blank', ' ', null)
    t3.close()
    // Paradev: an older install's database, before names, pull requests and times; one with no worktrees at all.
    const local = database(
      join(home, '.paradev', 'local.db'),
      `CREATE TABLE workspaces (worktree_path TEXT); CREATE TABLE projects (worktree_base_dir TEXT)`,
    )
    local.exec(`INSERT INTO workspaces VALUES ('/pd/a'), ('/pd/a'), (''); INSERT INTO projects VALUES ('/pd'), ('')`)
    local.close()
    database(join(home, '.paradev', 'host', 'org', 'host.db'), 'CREATE TABLE workspaces (id TEXT)').close()

    const stores = await readStores(placesOf(home, {}, 'darwin'))
    const by = (path: string) => stores.worktrees.find((one) => one.path === path)
    assert.deepStrictEqual(by('/trees/a')?.pullRequest, { number: 12, url: 'https://x/pull/12/' })
    assert.strictEqual(by('/trees/a')?.createdAt, '2026-11-01T00:00:00.000Z')
    assert.isNull(by('/trees/b')?.pullRequest)
    assert.isUndefined(by('/trees/c'))
    // Orca's folder is named either way, one folder where the disk ignores case, as a Mac's does.
    assert.deepStrictEqual([...new Set(stores.roots.orca)], [resolve('/r', '../trees'), '/abs/trees'])
    assert.strictEqual(by('/t3then/x')?.name, 'Old thread')
    assert.deepStrictEqual(stores.roots.t3, ['/t3now', '/t3then'])
    assert.deepStrictEqual(
      stores.worktrees.filter((one) => one.tool === 'paradev').map((one) => [one.path, one.name, one.pullRequest, one.archived]),
      [['/pd/a', null, null, false]],
    )
    assert.deepStrictEqual(stores.roots.paradev, ['/pd'])
    assert.isNull(isoOf(true))
    assert.isNull(isoOf(null))
  })
})

describe('branches', () => {
  it.effect('says how far each branch is past its upstream and its default branch, by what git can say', () =>
    Effect.gen(function* () {
      const root = repository()
      gitIn(root, 'branch', 'level')
      gitIn(root, 'branch', 'gone')
      gitIn(root, 'branch', 'went')
      gitIn(root, 'branch', '-q', '--set-upstream-to=went', 'gone')
      gitIn(root, 'branch', '-q', '-D', 'went')
      gitIn(root, 'switch', '-q', '-c', 'past')
      writeFileSync(join(root, 'past.txt'), 'past\n')
      gitIn(root, 'add', '.')
      gitIn(root, 'commit', '-q', '-m', 'Past')
      gitIn(root, 'branch', '-q', '--set-upstream-to=main', 'past')
      gitIn(root, 'branch', '-q', '--set-upstream-to=main', 'level')
      // No origin here: the default branch as this computer has it.
      const facts = yield* branchFactsOf(root, 'main')
      assert.deepStrictEqual(
        ['main', 'level', 'gone', 'past'].map((name) => [facts.get(name)?.pastUpstream, facts.get(name)?.ahead]),
        [
          [null, 0],
          [0, 0],
          [null, 0],
          [1, 1],
        ],
      )
      assert.isNotNull(facts.get('past')?.at)
      // A default branch it hasn't, or none: the rest, without how far past it each is.
      for (const missing of ['nowhere', null]) {
        const without = yield* branchFactsOf(root, missing)
        assert.deepStrictEqual([without.get('past')?.pastUpstream, without.get('past')?.ahead], [1, null])
      }
    }),
  )
})
