import type { ThreadItem } from '@althar/contracts'

import { items } from '../../tests/fixtures'

/*
 * A long, messy task thread, as a lead and its reviewer leave one: a lead
 * that thinks at length, reads and runs a great deal and narrates on the
 * way; three rounds of review, two of them with findings it settles; checks;
 * a pull request. Its times are counted back from when the page opened.
 */

export const LEAD = 'claude-code'
export const LEAD_MODEL = 'opus'
export const REVIEWER = 'codex'
export const REVIEWER_MODEL = 'gpt-5.2'
export const WORKTREE = '/Users/ada/code/meridian'

const opened = Date.now()
/** A moment of the task, in minutes (and seconds) after it started, two hours before the page opened. */
export const at = (minutes: number, seconds = 0) => new Date(opened - 2 * 3_600_000 + minutes * 60_000 + seconds * 1000).toISOString()

let sequence = 1_000
const placed = (item: ThreadItem, iso: string): ThreadItem => {
  sequence += 1
  return { ...item, id: `lab${sequence}`, sequence, createdAt: iso }
}

const lead = { model: LEAD_MODEL }
const thinks = (text: string, when: string) => placed({ ...items.thinks(text, LEAD), ...lead }, when)
const says = (text: string, when: string) => placed({ ...items.says(text, LEAD), ...lead }, when)
const read = (path: string, when: string) =>
  placed({ ...items.tool({ title: `Read ${path}`, toolKind: 'read', locations: [{ path: `${WORKTREE}/${path}` }] }, LEAD), ...lead }, when)
const search = (what: string, when: string) =>
  placed({ ...items.tool({ title: `grep -rn "${what}" packages`, toolKind: 'search' }, LEAD), ...lead }, when)
const edit = (path: string, when: string) =>
  placed({ ...items.tool({ title: `Edit ${path}`, toolKind: 'edit', locations: [{ path: `${WORKTREE}/${path}` }] }, LEAD), ...lead }, when)
const run = (command: string, when: string, exit = 0) =>
  placed(
    {
      ...items.tool(
        { title: command, toolKind: 'execute', command, exit, status: exit === 0 ? 'completed' : 'failed', output: null },
        LEAD,
      ),
      ...lead,
    },
    when,
  )
const step = (content: Parameters<typeof items.step>[0], when: string) => placed(items.step(content), when)

export const REQUEST =
  'The merge line hammers GitHub when it’s rate-limited: every task polls every 15 seconds whatever GitHub says. Make it back off when GitHub says to, and say so on the card instead of showing it stuck.'

const FIRST_THOUGHT = `The person wants the merge line to back off when GitHub rate-limits it. First I need to find where the poll is scheduled. I remember MergeLine.ts owns the queue, but the polling itself might be in Follow.ts, which watches a pull request's checks. GitHub's REST API answers a rate-limited call with 403 or 429, and the headers say when to come back: x-ratelimit-reset as epoch seconds, and sometimes retry-after in seconds for secondary limits. So the fix is probably: read those headers in the connector, surface a "come back at" time, and have the poll wait until then instead of its fixed interval. I should check whether the connector already parses these headers somewhere, maybe for the plan usage code, before writing anything new.`

const SECOND_THOUGHT = `Follow.ts schedules the next poll with a fixed POLL_EVERY of 15 seconds, and on any failure it just logs and polls again at the same interval. That's the hammering. The connector in packages/connectors/src/github.ts throws a HostRefused with the status but drops the headers. If I keep the headers on the error (resetAt from x-ratelimit-reset, or now + retry-after), Follow can sleep until resetAt plus a little jitter, capped so a wrong clock can't park it for hours. The card needs to know too: the task standing has a "waiting on GitHub" state already for when the host is offline; a rate limit is the same shape with an until. I'll reuse that rather than inventing a new state.`

const THIRD_THOUGHT = `The test failed because the fake host answers 429 without a reset header, and my code read that as "reset at 0", which is in the past, so it polled at once in a loop. When neither header is there, fall back to doubling the interval up to five minutes. That's what GitHub's own docs suggest for secondary limits without retry-after.`

const SETTLE_THOUGHT = `The reviewer's first finding is right: the jitter is added after the cap, so the wait can exceed five minutes. The second, about the clock, is also right: I compare GitHub's reset time to Date.now(), and a skewed clock would make us wait too long or not at all. Using the Date header from the response as "now" fixes that. The third finding says the card copy should name the time; the person's rules say copy shouldn't narrate, but saying when it resumes is a fact they need, so I'll keep "Waiting on GitHub until 14:32".`

export const RESULT = `The merge line now backs off when GitHub rate-limits it, and the task's card says it's waiting on GitHub, with when it will try again.

- **Back-off.** \`Follow.ts\` waits until GitHub's reset time (\`x-ratelimit-reset\`, or \`retry-after\` for secondary limits), with a little jitter, instead of polling every 15 seconds. Without either header it doubles its wait up to five minutes.
- **The card.** A rate-limited task reads *Waiting on GitHub until 14:32*, in the same place an offline host already shows.
- **The connector.** \`github.ts\` keeps the rate-limit headers on the error it raises, so any caller can wait the right time.

To look at: start a task that opens a pull request, then run \`bun run fake:ratelimit\` to have the fake host refuse. The card changes within a poll.

Not done: GitLab's limits; its headers differ, and the brief only named GitHub.`

const REVIEW_ONE = `The back-off is in the right place and the connector change is small. Three things before this goes in:

1. The jitter is added *after* the five-minute cap, so the wait can run past it.
2. The reset time is compared with this computer's clock. A clock a few minutes off makes the poll wait far too long, or not at all.
3. The card says *Waiting on GitHub*, but not until when; the time is what the person can act on.

The tests cover the 429 path but not a 403 with \`x-ratelimit-remaining: 0\`, which is what the primary limit actually sends.`

const SETTLE_ONE = `Settled the review: fixed two findings, and set one aside.

- **Jitter past the cap:** fixed. The jitter now comes first and the cap after, so the wait never passes five minutes.
- **The clock:** fixed. The wait is measured from the \`Date\` header of GitHub's own answer, not this computer's clock.
- **The card's time:** set aside. The card already says *until 14:32*; the reviewer read an older screenshot.

Added a test for a 403 with no requests left.`

const REVIEW_TWO = `The cap and the clock are right now. One small thing: \`backoffFor\` is exported from \`Follow.ts\` only for its test; it reads better in \`rateLimit.ts\` beside the header parsing.`

const SETTLE_TWO = `Moved \`backoffFor\` into \`rateLimit.ts\` beside the header parsing, and pointed its test there. Nothing else changed; the checks pass.`

/** The task's thread, oldest first, with three review rounds and the pull request it opened. */
export const longTask = (): ReadonlyArray<ThreadItem> => [
  thinks(FIRST_THOUGHT, at(0, 4)),
  says('I’ll find where the merge line polls GitHub, make it wait when GitHub says to, and say so on the card.', at(0, 31)),
  search('POLL_EVERY', at(0, 38)),
  read('packages/runtime/src/MergeLine.ts', at(0, 44)),
  read('packages/runtime/src/Follow.ts', at(0, 52)),
  read('packages/connectors/src/github.ts', at(1, 3)),
  read('packages/runtime/src/standing.ts', at(1, 12)),
  thinks(SECOND_THOUGHT, at(1, 20)),
  says('The poll interval is fixed in `Follow.ts`, and the connector drops the headers that say when to come back. Fixing both.', at(2, 2)),
  edit('packages/connectors/src/github.ts', at(2, 40)),
  edit('packages/runtime/src/Follow.ts', at(3, 31)),
  edit('packages/runtime/src/standing.ts', at(4, 2)),
  placed(
    {
      ...items.tool(
        {
          title: 'Write rateLimit.test.ts',
          toolKind: 'edit',
          locations: [{ path: `${WORKTREE}/packages/runtime/tests/rateLimit.test.ts` }],
        },
        LEAD,
      ),
      ...lead,
    },
    at(4, 40),
  ),
  run('cd packages/runtime && bunx vitest run --maxWorkers=1 tests/rateLimit.test.ts', at(5, 2), 1),
  thinks(THIRD_THOUGHT, at(5, 40)),
  edit('packages/runtime/src/Follow.ts', at(6, 1)),
  run('cd packages/runtime && bunx vitest run --maxWorkers=1 tests/rateLimit.test.ts tests/follow.test.ts', at(6, 20)),
  run('cd packages/runtime && ../../node_modules/.bin/vp check', at(7, 10)),
  placed(items.notice({ source: 'runtime', title: 'The task is a change now, on a branch of its own.', role: 'aside' }, null), at(7, 40)),
  run('git add -A && git commit -qm "Merge line: back off when GitHub rate-limits"', at(7, 52)),
  step(
    {
      step: 'implement',
      summary: 'The merge line waits until GitHub’s reset time when rate-limited, and the card says so.',
      built: RESULT,
      evidence: [
        {
          kind: 'test_run',
          caption: 'The rate-limit tests pass',
          picture: null,
          command: 'bunx vitest run tests/rateLimit.test.ts tests/follow.test.ts',
          exit: 0,
          text: ' ✓ tests/rateLimit.test.ts (6 tests)\n ✓ tests/follow.test.ts (14 tests)\n\n Test Files  2 passed (2)\n      Tests  20 passed (20)',
          dropped: 0,
        },
      ],
      model: LEAD_MODEL,
    },
    at(8, 30),
  ),
  says(RESULT, at(8, 41)),
  // The first review: three findings.
  step(
    {
      step: 'review',
      round: 0,
      verdict: 'changes_requested',
      agentId: REVIEWER,
      model: REVIEWER_MODEL,
      summary: REVIEW_ONE,
      findings: [
        {
          severity: 'major',
          file: 'packages/runtime/src/Follow.ts',
          line: 118,
          title: 'Jitter is added after the cap',
          claim: 'The wait can run past five minutes, since the jitter is added once the cap is applied.',
        },
        {
          severity: 'major',
          file: 'packages/runtime/src/Follow.ts',
          line: 96,
          title: 'The reset time is read against this computer’s clock',
          claim: 'Use the `Date` header of GitHub’s answer as now; a skewed clock waits far too long or not at all.',
        },
        {
          severity: 'minor',
          file: 'packages/ui/src/board/TaskCard/TaskCard.tsx',
          line: 210,
          title: 'The card doesn’t say until when',
          claim: 'Say the time it will try again; that is what the person can act on.',
        },
      ],
    },
    at(14, 5),
  ),
  // The lead settles it.
  thinks(SETTLE_THOUGHT, at(14, 20)),
  read('packages/runtime/src/Follow.ts', at(14, 52)),
  edit('packages/runtime/src/Follow.ts', at(15, 30)),
  edit('packages/runtime/tests/rateLimit.test.ts', at(16, 2)),
  run('cd packages/runtime && bunx vitest run --maxWorkers=1 tests/rateLimit.test.ts', at(16, 40)),
  run('git commit -qam "Follow: cap after jitter; read the reset time against GitHub’s clock"', at(17, 5)),
  step({ step: 'settle', round: 0, summary: SETTLE_ONE, built: RESULT, model: LEAD_MODEL }, at(17, 30)),
  says(SETTLE_ONE, at(17, 38)),
  // The second review: one small finding.
  step(
    {
      step: 'review',
      round: 1,
      verdict: 'changes_requested',
      agentId: REVIEWER,
      model: REVIEWER_MODEL,
      summary: REVIEW_TWO,
      findings: [
        {
          severity: 'nit',
          file: 'packages/runtime/src/Follow.ts',
          line: 40,
          title: '`backoffFor` belongs beside the header parsing',
          claim: 'Exported from `Follow.ts` only for its test; move it to `rateLimit.ts`.',
        },
      ],
    },
    at(21, 10),
  ),
  read('packages/runtime/src/rateLimit.ts', at(21, 30)),
  edit('packages/runtime/src/rateLimit.ts', at(21, 58)),
  edit('packages/runtime/src/Follow.ts', at(22, 12)),
  run('cd packages/runtime && bunx vitest run --maxWorkers=1 tests/rateLimit.test.ts tests/follow.test.ts', at(22, 50)),
  step({ step: 'settle', round: 1, summary: SETTLE_TWO, built: RESULT, model: LEAD_MODEL }, at(23, 20)),
  says(SETTLE_TWO, at(23, 26)),
  // The third passes.
  step(
    {
      step: 'review',
      round: 2,
      verdict: 'pass',
      agentId: REVIEWER,
      model: REVIEWER_MODEL,
      summary: 'Looks right. The back-off, the clock and the card all hold, and the tests cover both limits.',
      findings: [],
    },
    at(26, 40),
  ),
  step(
    {
      step: 'publish',
      summary: '',
      change: {
        product: 'github',
        url: 'https://github.com/meridian/meridian/pull/412',
        number: 412,
        title: 'Merge line: back off when GitHub rate-limits',
        repository: 'meridian/meridian',
        state: 'open',
        draft: true,
        short: 'PR',
        prefix: '#',
        noun: 'pull request',
      } as never,
    },
    at(27, 2),
  ),
  placed(items.arrival({ kind: 'checks', from: null, where: 'PR #412', text: '', passed: 9, failed: 0 }), at(39, 0)),
]

/* What an agent says live, played as the runtime streams it (play.ts). */

export const LIVE_THOUGHT = `The person asked whether the back-off survives a restart. Right now the wait lives in memory in Follow.ts, so a restart forgets it and the first poll after it goes straight back to GitHub, which is fine if the limit has reset but not if it hasn't. The reset time could be kept on the task's change in the store, the way the last-seen checks are kept, and read back when the merge line starts. That needs a column, so a migration. Before that, check whether MergeLine already restores anything per change at start: if it reads the last poll time, the reset time can ride along in the same row without a new table.`

export const CODEX_THOUGHT = `**Checking how the merge line starts**

I'm looking at MergeLine.ts to see what it reads back from the store when Althar starts, since the wait has to survive a restart.

**Tracing the poll's state to the store**

The last poll time is kept per change in \`change_polls\`, so the reset time can go in the same row with a migration of one column.`

export const LIVE_ANSWER = `It doesn't yet: the wait lives in memory, so a restart forgets it, and the first poll after goes straight to GitHub. I'll keep the reset time beside the last poll in the store, and read it back when the merge line starts.

The change, in short:

1. A column \`reset_at\` on \`change_polls\`, in migration \`0142\`.
2. \`Follow.ts\` writes it when GitHub refuses, and clears it after the next answer that isn't refused.
3. \`MergeLine.ts\` reads it back as it starts, so the first poll waits too.

\`\`\`ts
const resume = (poll: ChangePoll, now: number) =>
  poll.resetAt === null || poll.resetAt <= now ? 0 : Math.min(poll.resetAt - now, MAX_WAIT)
\`\`\`

| Case | First poll after a restart |
| --- | --- |
| Not limited | at once |
| Limited, reset passed | at once |
| Limited, reset ahead | at the reset time |

I'll write the migration first, then the test that restarts the merge line mid-wait.`

export const COORDINATOR_ANSWER = `Three tasks are running, and one needs you.

- **Merge line back-off** is in its second review round; the reviewer asked for one small move, and the lead is on it.
- **Plan usage on OpenCode Zen** finished and waits for you to accept it: the card shows what's left on each plan, and its checks pass.
- **A command's card reads cleanly** is stuck: its end-to-end run fails on Windows only, and the lead can't run Windows here. It asks whether to skip that spec on Windows or hand it to CI.

The one to look at first is the stuck one, since nothing moves on it until you answer. I'd hand it to CI: the spec covers the terminal's colours, which Windows draws differently, and the fix is likely a snapshot of its own there.`

/** A long answer, for timing frames: the coordinator's, then the lead's plan, three times over, with its lists, code and tables. */
export const LONG_ANSWER = [1, 2, 3].map((part) => `## Part ${part}\n\n${COORDINATOR_ANSWER}\n\n${LIVE_ANSWER}`).join('\n\n')
