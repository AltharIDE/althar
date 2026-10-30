import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Ids } from '@althar/domain'
import { codexLikeMeanings } from '@althar/provider-adapters/testing'
import type { PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Permissions, type RequestContext } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { guard } from '../src/pushGuard'
import { decide, decideInside, decideReader, type Hold, runsInside, type RuleContext, tallyKindOf } from '../src/rules'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { tallyOf } from '../src/tally'
import { runtime, task, turns, until } from './support'

/*
 * The sandbox is the boundary (ADR-071): where a session's sandbox holds
 * its shell commands, what it holds runs without the rules reading it,
 * short of what the project said itself; what crosses it meets the rules,
 * and what can't be undone still asks. Every ask and refusal is counted by
 * its kind.
 */

const command = (line: string, input: Readonly<Record<string, unknown>> = {}): PermissionRequest => ({
  sessionId: 'provider-session',
  toolCallId: 'call-1',
  title: line,
  kind: 'execute',
  paths: [],
  rawInput: { command: line, ...input },
  options: [
    { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
  ],
})

/** A lead's sandbox, with what runs outside it from the start, as Claude Code's is held. */
const lead: Hold = { outside: ['bunx playwright', 'ps', 'env -i'], unsandboxed: true }
/** The coordinator's, which runs nothing outside it. */
const coordinator: Hold = { outside: [], unsandboxed: false }

/** What leads and the coordinator ran today, and had asked about or refused (the 14 days in ADR-071). */
const TODAY = {
  heredoc: [
    "python3 - <<'EOF'",
    'import pathlib',
    "p = pathlib.Path('src/app.ts'); s = p.read_text(); assert s.count('old') == 1; p.write_text(s.replace('old', 'new'))",
    'EOF',
  ].join('\n'),
  copy: 'cp $TMPDIR/shots/a.png docs/shots/ && rm -rf $TMPDIR/shots',
  patch: [
    "python3 - <<'EOF'",
    "p = 'docs/push.md'; s = open(p).read()",
    'open(p, "w").write(s.replace("`git push`", "`git push origin HEAD`"))',
    'EOF',
  ].join('\n'),
  loop: 'for f in packages/runtime/src/*.ts; do n=$(git log --oneline -- "$f" | wc -l); echo "$n $f"; done | sort -rn | head',
  arithmetic: 'n=$(git grep -n "const resolving" -- src/Queries.ts | cut -d: -f2); sed -n "$n,$((n+8))p" src/Queries.ts',
  substitution: 'f=$(git grep -ln "<TaskCard" -- apps | head -1); git log -3 --format=%s -- "$f"',
  variable: 'd=$TMPDIR/scratch && mkdir -p $d && git worktree list > $d/list.txt && rm -rf $d',
}

const worktree = '/work/meridian/tasks/retry/meridian'
const context = (mode: 'rules' | 'coordinator' | 'ask' | 'allow', more: Partial<RuleContext['project']> = {}): RuleContext => ({
  worktree,
  defaultBranch: 'main',
  taskBranch: 'althar/retry',
  currentBranch: 'althar/retry',
  project: { mode, ask: ['default-branch', 'force-push', 'deploy'], never: [], allow: [], commands: [], ...more },
})

describe('a command its sandbox holds', () => {
  it('is one that doesn’t ask to leave it, and of whose commands none runs outside from the start', () => {
    assert.isTrue(runsInside(command(TODAY.heredoc), lead))
    assert.isTrue(runsInside(command('npm test', { dangerouslyDisableSandbox: false }), lead))
    // Asking to run outside it, or starting as a command that runs outside from the start, it crosses.
    assert.isFalse(runsInside(command('git push origin main', { dangerouslyDisableSandbox: true }), lead))
    assert.isFalse(runsInside(command('bunx playwright test e2e/smoke.spec.ts'), lead))
    assert.isFalse(runsInside(command('cd e2e && bunx playwright test'), lead))
    assert.isFalse(runsInside(command('ps'), lead))
    // `bunx playwrightish` is not `bunx playwright`.
    assert.isTrue(runsInside(command('bunx playwrightish'), lead))
    // The coordinator's never leaves it, whatever it asks.
    assert.isTrue(runsInside(command(TODAY.loop, { dangerouslyDisableSandbox: true }), coordinator))
    // Only a shell command: an edit, a read or a fetch is the rules' as before.
    assert.isFalse(runsInside({ ...command('x'), kind: 'edit', rawInput: { file_path: '/elsewhere/a.ts' } }, lead))
    assert.isFalse(runsInside({ ...command(''), rawInput: {} }, lead))
  })

  it('runs unread for a lead in every mode: a python heredoc that edits its worktree, a loop, $(…), arithmetic, variables', () => {
    for (const mode of ['rules', 'coordinator', 'ask', 'allow'] as const)
      for (const [name, line] of Object.entries(TODAY))
        assert.deepStrictEqual(decideInside(command(line), context(mode)), { verdict: 'allow' }, `${mode}: ${name}`)
    // As they were before, read: asked about, everything allowed or not.
    assert.strictEqual(decide(command(TODAY.patch), context('allow')).verdict, 'ask')
    assert.strictEqual(decide(command(TODAY.variable), context('allow')).verdict, 'ask')
  })

  it('runs unread for the coordinator: the loops and substitutions its reader rules refused', () => {
    for (const line of [TODAY.loop, TODAY.arithmetic, TODAY.substitution])
      assert.deepStrictEqual(decideInside(command(line)), { verdict: 'allow' }, line)
    // Outside a sandbox Althar holds, its reader rules still refuse them, with why.
    assert.include(
      (decideReader(command(TODAY.arithmetic), { trusted: true, cwd: '/work/meridian/.coordinator' }) as { reason: string }).reason,
      'only reads',
    )
  })

  it('still meets what the project said itself: a command or kind it never allows, a command it asks about', () => {
    const never = context('allow', { never: ['deploy'], commands: [{ pattern: 'rm -rf', decision: 'never' }] })
    assert.deepStrictEqual(decideInside(command('npm publish'), never), {
      verdict: 'deny',
      reason: "The project's rules never allow deploying and publishing.",
    })
    assert.strictEqual(decideInside(command('rm -rf build'), never).verdict, 'deny')
    // What it can't read runs, though Never lists something: the sandbox holds it.
    assert.strictEqual(decideInside(command(TODAY.loop), never).verdict, 'allow')
    const asks = context('allow', { commands: [{ pattern: 'terraform', decision: 'ask' }] })
    assert.deepStrictEqual(decideInside(command('terraform plan'), asks), {
      verdict: 'ask',
      reason: "The project's rules ask before `terraform`.",
      held: true,
    })
  })

  it('never reads the keychain or git’s stored passwords, which a Mac’s sandbox still reaches', () => {
    for (const line of ['security find-generic-password -s github.com -w', 'printf "host=github.com\\n" | git credential fill'])
      assert.include((decideInside(command(line), context('allow')) as { reason: string }).reason, 'credentials', line)
    assert.strictEqual(decideInside(command('security find-generic-password -w')).verdict, 'deny')
  })
})

describe('what crosses a lead’s sandbox', () => {
  it('meets the rules: a push to main or a force push asks, even with everything allowed', () => {
    for (const line of ['git push origin main', 'git push --force origin althar/retry', 'git push origin +althar/retry'])
      assert.strictEqual(decide(command(line, { dangerouslyDisableSandbox: true }), context('allow')).verdict, 'ask', line)
    // What the words of a script hide the rules can't see: git's guard stops it where it happens (pushGuard.test.ts).
    const hidden = "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['git', 'push', 'origin', 'HEAD:main'])\nEOF"
    assert.strictEqual(decide(command(hidden, { dangerouslyDisableSandbox: true }), context('allow')).verdict, 'allow')
    // What else crosses goes ahead with everything allowed.
    assert.strictEqual(decide(command('bunx playwright test'), context('allow')).verdict, 'allow')
    assert.strictEqual(
      decide(command('git push origin althar/retry', { dangerouslyDisableSandbox: true }), context('allow')).verdict,
      'allow',
    )
  })

  it('is counted by the kind that kept it', () => {
    const at = context('ask')
    assert.strictEqual(tallyKindOf(command('git push origin main'), at), 'default-branch')
    assert.strictEqual(tallyKindOf(command('git push -f origin althar/retry'), at), 'force-push')
    assert.strictEqual(tallyKindOf(command('rm -rf /work/meridian/main/src'), at), 'outside')
    assert.strictEqual(tallyKindOf(command(TODAY.variable), at), 'unclear')
    assert.strictEqual(tallyKindOf(command('gh pr merge 12'), at), 'code-host')
    assert.strictEqual(tallyKindOf(command('cat ~/.ssh/id_ed25519'), at), 'credentials')
    assert.strictEqual(tallyKindOf(command('npm test'), at), 'other')
  })
})

/** A task whose lead's sandbox Althar holds, in a project that allows everything, and how its requests are made. */
const held = (sandbox: Hold = lead) =>
  Effect.gen(function* () {
    const { project, task: created } = yield* task('Retry checkout')
    const policies = yield* Policies
    const instance = yield* Instance
    const sessions = yield* Sessions
    const sql = yield* SqlClient.SqlClient
    yield* policies.set(project.projectId, { allowEverything: true, never: ['deploy'] }, instance.personId)
    const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
    yield* until(turns(created.threadId), (rows) => rows.length > 0 && rows.every((row) => row.state === 'completed'))
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
    const requestContext: RequestContext = {
      projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
      threadId: created.threadId,
      taskId: created.taskId,
      sessionId,
      meanings: codexLikeMeanings,
      rules: { role: 'task', context: { worktree: workspace?.path ?? '', defaultBranch: 'main', taskBranch: created.branch ?? '' } },
      sandbox,
    }
    return { requestContext, project, sql, sessionId }
  })

describe('a lead whose sandbox Althar holds', () => {
  it.live(
    'runs today’s commands without a card, asks before a push to main that crosses, and counts each ask and refusal',
    () =>
      Effect.gen(function* () {
        const { requestContext, project, sql, sessionId } = yield* held()
        const permissions = yield* Permissions
        for (const line of Object.values(TODAY))
          assert.strictEqual((yield* permissions.decide(requestContext, command(line))).decision, 'allow', line)
        // What the project never allows is refused inside too, and counted by its kind.
        const published = yield* permissions.decide(requestContext, command('npm publish'))
        assert.deepStrictEqual(published, {
          decision: 'reject',
          reason: "The project's rules never allow deploying and publishing.",
          decidedBy: 'rules',
        })
        // A push to main asked to run outside the sandbox: a card, which the person allows.
        const asking = yield* Effect.forkChild(
          permissions.decide(requestContext, command('git push origin HEAD:main', { dangerouslyDisableSandbox: true })),
        )
        const [card] = yield* until(
          sql<{ id: string; counted: string | null; reason: string }>`
          SELECT id, json_extract(payload, '$.counted') AS counted, json_extract(payload, '$.reason') AS reason
          FROM attention_requests WHERE project_id = ${project.projectId} AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.strictEqual(card?.counted, 'default-branch')
        assert.include(card?.reason ?? '', 'even with everything allowed')
        const attentionId = card?.id ?? ''
        yield* permissions.answer({
          envelope: yield* Runtime.envelope('attention.answer', { attentionId, decision: 'allow' }),
          attentionId,
          decision: 'allow',
        })
        assert.strictEqual((yield* Fiber.join(asking)).decision, 'allow')
        // The lead's git lets that push through for a while: its guard has the session's pass.
        assert.isTrue(existsSync(join(guard().passes, sessionId)))
        // Only the ask and the refusal were counted: what ran inside the sandbox wasn't.
        const kinds = yield* sql<{ kind: string | null; outcome: string }>`
        SELECT kind, outcome FROM decisions WHERE project_id = ${project.projectId} ORDER BY decided_at`
        assert.deepStrictEqual(
          kinds.filter((row) => row.kind !== null),
          [
            { kind: 'deploy', outcome: 'reject' },
            { kind: 'default-branch', outcome: 'allow' },
          ],
        )
        const tally = yield* tallyOf(project.projectId)
        assert.deepStrictEqual(
          [...tally].sort((a, b) => a.kind.localeCompare(b.kind)),
          [
            { kind: 'default-branch', asked: 1, allowed: 1, refused: 0, workedAround: 0 },
            { kind: 'deploy', asked: 0, allowed: 0, refused: 1, workedAround: 0 },
          ],
        )
      }).pipe(Effect.provide(runtime())),
    60_000,
  )

  it.live(
    'as the coordinator, runs its loops without a refusal where its sandbox holds it, and refuses them where none does',
    () =>
      Effect.gen(function* () {
        const { requestContext } = yield* held()
        const permissions = yield* Permissions
        const reader: RequestContext = {
          ...requestContext,
          taskId: null,
          rules: { role: 'reader', trusted: true, cwd: '/work/meridian/.coordinator' },
        }
        for (const line of [TODAY.loop, TODAY.arithmetic, TODAY.substitution]) {
          assert.strictEqual((yield* permissions.decide({ ...reader, sandbox: coordinator }, command(line))).decision, 'allow', line)
          const { sandbox: _, ...unheld } = reader
          assert.strictEqual((yield* permissions.decide(unheld, command(line))).decision, 'reject', line)
        }
      }).pipe(Effect.provide(runtime())),
    // Seven seconds alone; more while other tests share the machine.
    60_000,
  )
})
