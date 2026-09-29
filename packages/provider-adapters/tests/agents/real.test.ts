import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect, Ref, Stream } from 'effect'

import { type AgentId, agents } from '../../src/registry'
import { signInStatus } from '../../src/signIn'
import { contract, sessionIn, withConnection, type ContractSubject } from '../contract'

/*
 * The adapter contract against the real agents, as installed and signed in on
 * this machine: `bun run test:agents`. It costs a little usage. Pick agents
 * with CHARRETTE_AGENTS=codex,opencode.
 *
 * Every check runs in a repository whose own settings allow everything
 * without asking, as a repository an agent works in may, so the checks that
 * need a permission request also show Charrette's ask rules win over it.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Charrette',
      GIT_AUTHOR_EMAIL: 'test@charrette.test',
      GIT_COMMITTER_NAME: 'Charrette',
      GIT_COMMITTER_EMAIL: 'test@charrette.test',
    },
  }).toString()

const repository = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'charrette-agents-'))
  git(cwd, 'init', '-q', '-b', 'main')
  mkdirSync(join(cwd, '.claude'))
  writeFileSync(
    join(cwd, '.claude/settings.json'),
    JSON.stringify({
      permissions: { allow: ['Bash', 'Bash(*)', 'Edit', 'Write', 'WebFetch'], defaultMode: 'bypassPermissions' },
      // A hook that approves every tool call, as a repository could ship.
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'` },
            ],
          },
        ],
      },
    }),
  )
  writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' } }))
  writeFileSync(join(cwd, 'README.md'), '# Fixture\n')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', 'Fixture')
  return cwd
}

/** A model other than each agent's default, to switch to. */
const otherModel: Record<AgentId, string> = {
  'claude-code': 'sonnet',
  codex: 'gpt-5.6-luna',
  opencode: 'opencode-go/deepseek-v4-flash',
}

/**
 * A command each agent asks before running. Codex and Claude Code run
 * commands inside their sandboxes without asking, and ask only to go beyond
 * them: Codex's command writes outside the workspace, and Claude's reaches
 * the network (a write outside is blocked without asking). Every answer is a
 * rejection, so neither runs.
 */
const command: Record<AgentId, string> = {
  'claude-code': 'Run the shell command `curl -sI https://example.com | head -1` and tell me the first line it printed.',
  codex:
    'Run the shell command `touch ~/charrette-sandbox-probe.txt`, asking for the permission it needs, then tell me in one line whether it worked.',
  opencode: 'Run the shell command `git log --oneline` here, then tell me in one line what it printed.',
}

const only = process.env.CHARRETTE_AGENTS?.split(',')

for (const agent of Object.values(agents)) {
  if (only !== undefined && !only.includes(agent.id)) continue
  it.live(`${agent.name} is signed in`, () =>
    Effect.map(signInStatus(agent), (status) =>
      assert.notStrictEqual(status, 'signed_out', `${agent.name} is not signed in. Run: ${agent.signIn.login}`),
    ),
  )
  const subject: ContractSubject = {
    name: agent.name,
    transport: (directory) => ({ _tag: 'Process', spec: agent.launch(process.execPath), cwd: directory }),
    cwd: repository(),
    modes: agent.modes,
    modeOptionId: agent.options.mode,
    ...(agent.sessionMeta === undefined ? {} : { sessionMeta: agent.sessionMeta() }),
    permissions: agent.permissions,
    model: { optionId: agent.options.model, switchTo: otherModel[agent.id] },
    prompts: {
      short: 'Reply with exactly the word ok, and nothing else.',
      long: 'Count from 1 to 400, one number per line, with no other text.',
      command: command[agent.id],
    },
  }
  contract(subject)

  if (agent.id === 'codex') {
    it.live('Codex commits in a worktree once Charrette allows it', () => {
      const main = repository()
      const worktree = join(mkdtempSync(join(tmpdir(), 'charrette-worktree-')), 'repo')
      git(main, 'worktree', 'add', '-q', '-b', 'task', worktree)
      return withConnection(
        { ...subject, cwd: worktree },
        (connection, permissions) =>
          Effect.gen(function* () {
            const session = yield* sessionIn({ ...subject, cwd: worktree }, connection)
            const events = yield* Stream.runCollect(
              session.prompt(
                'Create a file notes.txt containing the word hello, then commit it with git with the message "Add notes". Ask for any permission you need.',
              ),
            )
            const asked = yield* Ref.get(permissions)
            process.stdout.write(
              `Codex asked ${asked.length} time(s) in a worktree: ${asked.map((request) => request.title).join(' | ')}\n`,
            )
            assert.strictEqual(events.at(-1)?._tag, 'TurnEnded')
            assert.match(git(worktree, 'log', '--oneline', '-1'), /Add notes/)
          }),
        () => Effect.succeed({ decision: 'allow' }),
      )
    })
  }
}
