/*
 * The wall of terminals the about page opens on: a dozen panes, each an
 * agent or a shell at work, their lines as each tool prints them. A line
 * that asks something is `ask`; a limit or a failure is `stop`; `ok` passed
 * and `dim` is the tool talking to itself. Illustration: the repositories,
 * tasks and numbers are made up.
 */

export type Tone = 'ask' | 'stop' | 'ok' | 'dim' | undefined
export interface TermLine {
  text: string
  tone?: Tone
}
export interface Pane {
  title: string
  lines: readonly TermLine[]
  /** Ends on a question and waits there, the cursor blinking. */
  waits?: boolean
}

const l = (text: string, tone?: Tone): TermLine => ({ text, tone })

const CLAUDE = (file: string, tests: string): TermLine[] => [
  l(`⏺ Read(src/billing/${file})`),
  l('  ⎿  Read 214 lines', 'dim'),
  l('✻ Thinking…', 'dim'),
  l(`⏺ Update(src/billing/${file})`),
  l('  ⎿  Updated with 12 additions and 4 removals', 'dim'),
  l(`⏺ Bash(bun test ${tests})`),
  l('  ⎿  213 pass · 1 fail', 'stop'),
  l('⏺ The failing case is the zero-amount refund.', undefined),
  l(`⏺ Update(src/billing/${file})`),
  l('  ⎿  Updated with 3 additions', 'dim'),
]

export const PANES: readonly Pane[] = [
  {
    title: 'claude — refunds',
    waits: true,
    lines: [
      ...CLAUDE('refunds.ts', 'billing'),
      l(' Do you want to make this edit to refunds.ts?', 'ask'),
      l(' ❯ 1. Yes'),
      l('   2. Yes, and don’t ask again this session'),
      l('   3. No, tell Claude what to do differently'),
    ],
  },
  {
    title: 'codex — queue',
    lines: [
      l('• Explored'),
      l('  └ Read webhook.ts, queue.ts, retry.ts', 'dim'),
      l('• Ran pnpm test --filter api'),
      l('  └ ✓ 88 passed', 'ok'),
      l('• Edited src/queue.ts (+18 −6)'),
      l('• Working (14s • esc to interrupt)', 'dim'),
      l('• Ran pnpm lint'),
      l('  └ 2 problems (1 error)', 'stop'),
      l('• Edited src/retry.ts (+2 −2)'),
      l('• Working (31s • esc to interrupt)', 'dim'),
    ],
  },
  {
    title: 'opencode — rate-limit',
    waits: true,
    lines: [
      l('│ Read   src/api/rate.ts'),
      l('│ Grep   "tokensPerMinute"', 'dim'),
      l('│ Edit   src/api/rate.ts'),
      l('│ Bash   bun run lint', 'dim'),
      l('  0 problems', 'ok'),
      l('│ Edit   src/api/limits.test.ts'),
      l('  build · 41% context', 'dim'),
      l('Permission required: bash  rm -rf .cache/limits', 'ask'),
      l('  (a)llow  (A)llow always  (r)eject', 'ask'),
    ],
  },
  {
    title: 'zsh — althar',
    lines: [
      l('$ git status'),
      l('On branch feat/refunds-limit', 'dim'),
      l('Changes not staged for commit:', 'dim'),
      l('  modified:   src/billing/refunds.ts', 'stop'),
      l('  modified:   src/billing/refunds.test.ts', 'stop'),
      l('$ git stash list'),
      l('stash@{0}: WIP on feat/queue', 'dim'),
      l('stash@{1}: WIP on main', 'dim'),
      l('$ git worktree list'),
      l('~/code/althar          05da639 [main]', 'dim'),
      l('~/code/althar-refunds  8a3230a [feat/refunds-limit]', 'dim'),
    ],
  },
  {
    title: 'claude — docs',
    lines: [
      l('⏺ Read(docs/webhooks.md)'),
      l('  ⎿  Read 96 lines', 'dim'),
      l('⏺ Write(docs/refunds.md)'),
      l('  ⎿  Wrote 48 lines', 'dim'),
      l('✻ Thinking…', 'dim'),
      l('⚠ Approaching usage limit · resets 2pm', 'stop'),
      l('⏺ Update(docs/README.md)'),
      l('  ⎿  Updated with 2 additions', 'dim'),
      l('Claude usage limit reached. Your limit will reset at 2pm.', 'stop'),
    ],
  },
  {
    title: 'codex — review 431',
    waits: true,
    lines: [
      l('• Reviewing diff against main'),
      l('  └ 6 files, +212 −48', 'dim'),
      l('• Finding: refunds can exceed the original charge', 'stop'),
      l('• Finding: retry has no upper bound', 'stop'),
      l('• Ran git push origin review/431', 'dim'),
      l('› Allow command?  gh pr comment 431 --body-file review.md', 'ask'),
      l('  [y/N]', 'ask'),
    ],
  },
  {
    title: 'tail -f dev.log',
    lines: [
      l('12:41:07 GET /api/refunds 200 18ms', 'dim'),
      l('12:41:08 POST /api/refunds 201 42ms', 'dim'),
      l('12:41:08 POST /webhooks/stripe 200 9ms', 'dim'),
      l('12:41:09 WARN rate limit 61/60 for acct_8h2', 'stop'),
      l('12:41:09 POST /api/refunds 429 2ms', 'stop'),
      l('12:41:11 GET /api/health 200 1ms', 'dim'),
      l('12:41:12 POST /api/refunds 201 39ms', 'dim'),
      l('12:41:13 GET /api/refunds?page=2 200 22ms', 'dim'),
    ],
  },
  {
    title: 'gh run watch',
    lines: [
      l('✓ lint            38s', 'ok'),
      l('✓ typecheck       1m02s', 'ok'),
      l('* unit (ubuntu)   running', 'dim'),
      l('* e2e (ubuntu)    running', 'dim'),
      l('✓ unit (ubuntu)   2m48s', 'ok'),
      l('X e2e (ubuntu)    4m12s', 'stop'),
      l('  refunds › partial refund shows in the list', 'stop'),
      l('Run failed: 1 of 5 jobs', 'stop'),
    ],
  },
  {
    title: 'opencode — onboarding',
    lines: [
      l('│ Read   src/app/welcome.tsx'),
      l('│ Edit   src/app/welcome.tsx'),
      l('│ Bash   bun run test welcome', 'dim'),
      l('  12 passed', 'ok'),
      l('  build · 63% context', 'dim'),
      l('│ Edit   src/app/steps.tsx'),
      l('│ Bash   bun run typecheck', 'dim'),
      l('  src/app/steps.tsx:41 Type error', 'stop'),
      l('│ Edit   src/app/steps.tsx'),
    ],
  },
  {
    title: 'codex — migrations',
    lines: [
      l('• Explored'),
      l('  └ Read db/schema.ts, db/migrations/', 'dim'),
      l('• Edited db/migrations/0042_refund_limit.sql (+14)'),
      l('• Ran bun run db:migrate'),
      l('  └ applied 0042_refund_limit', 'ok'),
      l('• Working (52s • esc to interrupt)', 'dim'),
      l('■ You’ve hit your usage limit. Try again in 3 days.', 'stop'),
    ],
  },
  {
    title: 'claude — tests',
    waits: true,
    lines: [
      l('⏺ Bash(bun test --watch)'),
      l('  ⎿  Running…', 'dim'),
      l('⏺ 4 tests are flaky under --watch.', undefined),
      l('⏺ Update(tests/setup.ts)'),
      l('  ⎿  Updated with 6 additions', 'dim'),
      l(' Do you want to run this command?', 'ask'),
      l('   bun test --rerun-each 20', 'ask'),
      l(' ❯ 1. Yes'),
      l('   2. No'),
    ],
  },
  {
    title: 'ssh — staging',
    lines: [
      l('$ kubectl get pods -n api'),
      l('api-7c9f8d-2kq   1/1   Running   0   3h', 'dim'),
      l('api-7c9f8d-x8w   1/1   Running   0   3h', 'dim'),
      l('worker-55b-p9z   0/1   CrashLoopBackOff   7', 'stop'),
      l('$ kubectl logs worker-55b-p9z'),
      l('Error: REFUND_LIMIT is not set', 'stop'),
    ],
  },
]
