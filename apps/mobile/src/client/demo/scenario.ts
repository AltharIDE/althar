import type { DiffLine, FileDiff, HomeCall, HomeEvent, HomeTask, ProjectSummary, ThreadSnapshot } from '@althar/contracts'

import { ago, ahead, attentionOf, call, checks, file, project, pullRequest, say, session, task, thread } from './builders'

/*
 * The demo's afternoon: three projects, eight tasks, and what waits on the
 * person across them, one of each kind of call. Times are relative to
 * `now`, so the screens read the same whenever they're opened.
 */

export type Scenario = {
  projects: Array<ProjectSummary>
  tasks: Array<HomeTask>
  calls: Array<HomeCall>
  events: Array<HomeEvent>
  threads: Map<string, ThreadSnapshot>
  diffs: Map<string, FileDiff>
  /** When the person last left the home. */
  looked: string
}

const OPUS = 'claude-opus-5'
const GPT = 'gpt-5.5-codex'

export const scenario = (now: number): Scenario => {
  const meridian = project({ id: 'proj_meridian', name: 'meridian', ink: 'clay', lastWorkAt: ago(now, 2) })
  const billing = project({ id: 'proj_billing', name: 'billing-api', ink: 'moss', lastWorkAt: ago(now, 9) })
  const site = project({ id: 'proj_site', name: 'althar-site', ink: 'teal', lastWorkAt: ago(now, 31) })

  const implementThenReview = (lead: string, leadModel: string, reviewer: string, reviewerModel: string) => ({
    id: `plan_${lead}_${reviewer}`,
    steps: [
      { key: 'implement' as const, agentId: lead, model: leadModel, skipped: false },
      { key: 'review' as const, agentId: reviewer, model: reviewerModel, skipped: false },
    ],
    startsAt: null,
    reason: null,
    end: 'draft' as const,
  })

  /* ---- At work ---- */
  const backfill = task({
    taskId: 'task_backfill',
    projectId: meridian.id,
    title: 'Backfill invoice totals for 2024',
    phase: 'running',
    step: 'implement',
    lead: 'claude-code',
    leadModel: OPUS,
    startedAt: ago(now, 12),
    createdAt: ago(now, 14),
    plan: implementThenReview('claude-code', OPUS, 'codex', GPT),
    summary: 'Writing the batch job: 3 of 5 months backfilled in the dry run',
    changed: { files: 6, add: 214, del: 18 },
  })
  const darkDocs = task({
    taskId: 'task_dark_docs',
    projectId: site.id,
    title: 'Dark mode for the docs pages',
    phase: 'running',
    step: 'review',
    lead: 'claude-code',
    leadModel: OPUS,
    startedAt: ago(now, 41),
    createdAt: ago(now, 45),
    plan: implementThenReview('claude-code', OPUS, 'codex', GPT),
    summary: 'Codex is reviewing round 2: contrast of code blocks',
    changed: { files: 11, add: 386, del: 92 },
  })
  const queuedTask = task({
    taskId: 'task_rate_limits',
    projectId: billing.id,
    title: 'Per-customer rate limits on /charges',
    phase: 'planned',
    createdAt: ago(now, 3),
    inLine: true,
    place: 1,
    queued: { busy: 4, atOnce: 4 },
    plan: { ...implementThenReview('codex', GPT, 'claude-code', OPUS), startsAt: ahead(now, 1) },
  })

  /* ---- Waiting on calls ---- */
  const webhooks = task({
    taskId: 'task_webhooks',
    projectId: meridian.id,
    title: 'Retry webhook deliveries with backoff',
    phase: 'waiting',
    step: 'implement',
    lead: 'codex',
    leadModel: GPT,
    startedAt: ago(now, 26),
    createdAt: ago(now, 30),
    plan: implementThenReview('codex', GPT, 'claude-code', OPUS),
    summary: 'Wants to run the migration against staging',
  })
  const shifts = task({
    taskId: 'task_shifts',
    projectId: site.id,
    title: 'Fix the shifts table on narrow screens',
    phase: 'waiting',
    step: 'implement',
    lead: 'claude-code',
    leadModel: OPUS,
    startedAt: ago(now, 8),
    createdAt: ago(now, 9),
    plan: implementThenReview('claude-code', OPUS, 'codex', GPT),
  })
  const cron = task({
    taskId: 'task_cron',
    projectId: meridian.id,
    title: 'Move cron jobs onto the queue',
    phase: 'waiting',
    step: 'review',
    lead: 'claude-code',
    leadModel: OPUS,
    startedAt: ago(now, 96),
    createdAt: ago(now, 100),
    plan: implementThenReview('claude-code', OPUS, 'codex', GPT),
    summary: 'Review ran out of rounds with 2 findings open',
  })

  /* ---- Ready for the person ---- */
  const stripe = task({
    taskId: 'task_stripe',
    projectId: billing.id,
    title: 'Upgrade the Stripe SDK to v19',
    phase: 'ready',
    lead: 'codex',
    leadModel: GPT,
    startedAt: ago(now, 64),
    createdAt: ago(now, 70),
    plan: implementThenReview('codex', GPT, 'claude-code', OPUS),
    summary: 'Moved to the v19 client, typed every webhook event, and dropped the deprecated idempotency helper.',
    change: pullRequest({
      number: 482,
      title: 'Upgrade the Stripe SDK to v19',
      repository: 'acme/billing-api',
      additions: 312,
      deletions: 198,
      changedFiles: 23,
      checks: checks(14, 0, 0),
    }),
  })
  const flaky = task({
    taskId: 'task_flaky',
    projectId: meridian.id,
    title: 'Why does the checkout test flake?',
    kind: 'plain',
    phase: 'ready',
    lead: 'claude-code',
    leadModel: OPUS,
    startedAt: ago(now, 52),
    createdAt: ago(now, 53),
    branch: null,
    summary: 'A race between the cart cache warming and the first price lookup; it fails 1 run in 40.',
    handed: { pictures: [], files: [{ path: 'notes/checkout-flake.md', add: 64 }] },
  })
  const review = task({
    taskId: 'task_review_477',
    projectId: billing.id,
    title: 'Review #477: idempotency keys on refunds',
    kind: 'review',
    phase: 'ready',
    lead: 'codex',
    leadModel: GPT,
    startedAt: ago(now, 19),
    createdAt: ago(now, 20),
    branch: null,
    summary: 'Drafted a review: one blocking finding about key reuse across currencies.',
    reviewing: {
      product: 'github',
      repository: 'acme/billing-api',
      number: 477,
      url: 'https://github.com/acme/billing-api/pull/477',
      title: 'Idempotency keys on refunds',
      author: 'dana',
      outside: false,
      additions: 141,
      deletions: 22,
      findings: 3,
      blocking: 1,
      verdict: 'changes',
      posted: null,
      waiting: true,
    },
  })

  const tasks = [backfill, darkDocs, webhooks, shifts, cron, stripe, flaky, review, queuedTask]

  /* ---- Calls ---- */
  const migrate = call({
    id: 'att_migrate',
    kind: 'permission',
    projectId: meridian.id,
    taskId: webhooks.taskId,
    threadId: webhooks.threadId,
    taskTitle: webhooks.title,
    taskSlug: webhooks.slug,
    title: 'Run the database migration on staging',
    reason: 'Commands that reach staging always ask, in meridian’s rules',
    command: 'bun run db:migrate --env staging',
    always: {
      command: 'bun run db:migrate --env staging',
      prefix: 'bun run db:migrate',
      kind: null,
      allow: ['exact', 'prefix'],
      deny: ['exact', 'prefix'],
    },
    createdAt: ago(now, 2),
  })
  const breakpoint = call({
    id: 'att_breakpoint',
    kind: 'question',
    projectId: site.id,
    taskId: shifts.taskId,
    threadId: shifts.threadId,
    taskTitle: shifts.title,
    taskSlug: shifts.slug,
    title: 'Where should the table fold into cards?',
    reason: 'Opus 5 asks',
    question: {
      message: 'The shifts table has 7 columns. Below some width it can’t fit; where should it change?',
      why: 'I can fold it into one card per row, or keep the table and let it scroll sideways.',
      askedBy: { agentId: 'claude-code', model: OPUS },
      fields: [
        {
          id: 'breakpoint',
          question: 'Where should the table fold into cards?',
          header: 'Breakpoint',
          type: 'choice',
          multiple: false,
          required: true,
          options: [
            { value: '640', label: 'Below 640px', note: 'Phones only; small tablets keep the table' },
            { value: '768', label: 'Below 768px', note: 'Phones and small tablets' },
            { value: 'scroll', label: 'Never: scroll sideways', note: 'Keeps the table, with the first column pinned' },
          ],
        },
      ],
    },
    createdAt: ago(now, 6),
  })
  const rounds = call({
    id: 'att_rounds',
    kind: 'stuck',
    projectId: meridian.id,
    taskId: cron.taskId,
    threadId: cron.threadId,
    taskTitle: cron.title,
    taskSlug: cron.slug,
    title: 'Review ran out of rounds',
    reason: 'Three rounds of review, and two findings are still open',
    stuck: {
      step: 'review',
      why: 'round_limit',
      detail: 'The queue worker still swallows errors from the nightly export, and retries aren’t capped.',
      agentId: 'codex',
      round: 2,
      open: 2,
      tried: ['carried_on'],
    },
    createdAt: ago(now, 17),
  })

  const calls = [migrate, breakpoint, rounds]

  /* ---- What the loop did ---- */
  const events: Array<HomeEvent> = [
    {
      kind: 'step',
      id: 'ev_stripe_review',
      at: ago(now, 11),
      projectId: billing.id,
      task: { id: stripe.taskId, threadId: stripe.threadId, slug: stripe.slug, title: stripe.title },
      result: {
        step: 'review',
        round: 1,
        summary: 'Passed on round 2: the webhook types are exhaustive now.',
        change: null,
        verdict: 'pass',
        findings: [],
        built: null,
        evidence: [],
        unverified: null,
        agentId: 'claude-code',
      },
    },
    {
      kind: 'dealt',
      id: 'ev_limit',
      at: ago(now, 23),
      projectId: site.id,
      task: { id: darkDocs.taskId, threadId: darkDocs.threadId, slug: darkDocs.slug, title: darkDocs.title },
      about: 'limit',
      title: 'Claude Code (work) ran out of usage',
      description: 'Moved the review to Codex; Claude Code is back at 18:00.',
    },
    { kind: 'answered', id: 'ev_rules', by: 'rules', at: ago(now, 58), count: 37 },
  ]

  /* ---- Threads ---- */
  const threads = new Map<string, ThreadSnapshot>()
  threads.set(
    backfill.threadId,
    thread(
      backfill,
      meridian.name,
      [
        say.person(
          'Backfill invoice totals for every 2024 invoice: the totals column was added in March and older rows are null.',
          ago(now, 14),
        ),
        say.notice('Installed dependencies in meridian', ago(now, 13)),
        say.agent(
          'claude-code',
          'I’ll read the invoices schema and the existing totals calculation first, then write an idempotent batch job.',
          ago(now, 12),
        ),
        say.tool('claude-code', ago(now, 12), 'Read src/billing/totals.ts', 'read', { path: 'src/billing/totals.ts' }),
        say.tool('claude-code', ago(now, 11), 'Search for invoice_total', 'search'),
        say.tool('claude-code', ago(now, 10), 'Edit jobs/backfill-totals.ts', 'edit', { path: 'jobs/backfill-totals.ts' }),
        say.tool('claude-code', ago(now, 7), 'Run the job dry', 'execute', {
          command: 'bun jobs/backfill-totals.ts --dry-run --month 2024-01',
        }),
        say.agent(
          'claude-code',
          'The dry run for January matches the ledger to the cent on 4,112 invoices. Batching by month keeps each transaction under a second; doing February to May next.',
          ago(now, 4),
        ),
        say.tool('claude-code', ago(now, 1), 'Run the job dry', 'execute', {
          command: 'bun jobs/backfill-totals.ts --dry-run --month 2024-03',
          status: 'in_progress',
        }),
      ],
      {
        request: 'Backfill invoice totals for every 2024 invoice: the totals column was added in March and older rows are null.',
        files: [file('jobs/backfill-totals.ts', 148, 0), file('src/billing/totals.ts', 22, 9), file('src/billing/totals.test.ts', 44, 9)],
        commits: 2,
        session: session({
          id: 'ses_backfill',
          agentId: 'claude-code',
          agentName: 'Claude Code',
          model: OPUS,
          turnRunning: true,
          turnStartedAt: ago(now, 4),
          context: { used: 92_000, size: 200_000 },
        }),
      },
    ),
  )
  threads.set(
    stripe.threadId,
    thread(
      stripe,
      billing.name,
      [
        say.person('Upgrade the Stripe SDK to v19. Keep the webhook handlers’ behaviour identical.', ago(now, 70)),
        say.result('codex', ago(now, 40), {
          step: 'implement',
          summary: 'Moved to the v19 client, typed every webhook event, and dropped the deprecated idempotency helper.',
          checked: [
            { caption: 'Unit tests', command: 'bun test', exit: 0 },
            { caption: 'Webhook fixtures replayed against both versions', command: 'bun scripts/replay-webhooks.ts', exit: 0 },
          ],
          unverified: ['Live mode keys: only test mode was reachable'],
        }),
        say.result('claude-code', ago(now, 25), {
          step: 'review',
          round: 0,
          verdict: 'changes_requested',
          summary: 'Two webhook events fall through to the default branch silently.',
          findings: [
            {
              severity: 'major',
              file: 'src/webhooks/handle.ts',
              line: 88,
              claim: '`charge.dispute.funds_reinstated` isn’t handled and is now dropped without a log.',
            },
            { severity: 'minor', file: 'src/stripe.ts', line: 12, claim: 'The API version is pinned in two places.' },
          ],
        }),
        say.result('claude-code', ago(now, 11), {
          step: 'review',
          round: 1,
          verdict: 'pass',
          summary: 'Passed on round 2: the webhook types are exhaustive now.',
        }),
        say.notice('Opened draft pull request #482', ago(now, 9)),
      ],
      {
        files: [
          file('src/stripe.ts', 18, 31),
          file('src/webhooks/handle.ts', 96, 54),
          file('src/webhooks/events.ts', 140, 0),
          file('src/refunds/idempotency.ts', 0, 61, { status: 'deleted' }),
          file('package.json', 1, 1),
        ],
        commits: 5,
      },
    ),
  )
  threads.set(
    webhooks.threadId,
    thread(
      webhooks,
      meridian.name,
      [
        say.person('Webhook deliveries that fail are dropped. Retry them with exponential backoff, at most 8 tries.', ago(now, 30)),
        say.agent(
          'codex',
          'Adding a `delivery_attempts` table and a retry worker. The migration needs to run on staging before the integration tests can.',
          ago(now, 5),
        ),
        say.tool('codex', ago(now, 4), 'Edit migrations/0042_delivery_attempts.sql', 'edit', {
          path: 'migrations/0042_delivery_attempts.sql',
        }),
      ],
      {
        attention: [attentionOf(migrate)],
        files: [file('migrations/0042_delivery_attempts.sql', 31, 0), file('src/webhooks/retry.ts', 88, 4)],
      },
    ),
  )
  threads.set(
    shifts.threadId,
    thread(
      shifts,
      site.name,
      [
        say.person('The shifts table overflows on phones. Fix it.', ago(now, 9)),
        say.agent(
          'claude-code',
          'The table has 7 columns and needs about 820px. I can fold it into cards or keep it scrolling sideways.',
          ago(now, 6),
        ),
      ],
      { attention: [attentionOf(breakpoint)] },
    ),
  )
  threads.set(
    cron.threadId,
    thread(cron, meridian.name, [say.person('Move every cron job onto the queue, with retries.', ago(now, 100))], {
      attention: [attentionOf(rounds)],
    }),
  )
  threads.set(
    darkDocs.threadId,
    thread(darkDocs, site.name, [say.person('Add dark mode to the docs pages, following the app’s dark palette.', ago(now, 45))]),
  )
  threads.set(
    flaky.threadId,
    thread(flaky, meridian.name, [
      say.person('Why does the checkout test flake? Don’t fix it yet, just find out.', ago(now, 53)),
      say.agent(
        'claude-code',
        'It’s a race: the cart cache warms in a `setImmediate`, and the first price lookup can run before it. It fails about 1 run in 40 locally. I wrote up the trace and two ways to fix it in notes/checkout-flake.md.',
        ago(now, 21),
      ),
    ]),
  )
  threads.set(review.threadId, thread(review, billing.name, [say.person('Review #477.', ago(now, 20))]))
  threads.set(queuedTask.threadId, thread(queuedTask, billing.name, [say.person('Add per-customer rate limits to /charges.', ago(now, 3))]))

  /* ---- Diffs ---- */
  const diffs = new Map<string, FileDiff>()
  const handleLines: Array<DiffLine> = [
    { kind: 'hunk', text: '@@ -80,14 +80,22 @@ export async function handle(event: Stripe.Event)' },
    { kind: 'context', old: 80, new: 80, text: '  switch (event.type) {' },
    { kind: 'context', old: 81, new: 81, text: "    case 'charge.refunded':" },
    { kind: 'removed', old: 82, text: '      return refunds.record(event.data.object as any)', changed: ['event.data.object as any'] },
    { kind: 'added', new: 82, text: '      return refunds.record(event.data.object)', changed: ['event.data.object'] },
    { kind: 'context', old: 83, new: 83, text: "    case 'charge.dispute.created':" },
    { kind: 'context', old: 84, new: 84, text: '      return disputes.open(event.data.object)' },
    { kind: 'added', new: 85, text: "    case 'charge.dispute.funds_reinstated':" },
    { kind: 'added', new: 86, text: '      return disputes.reinstate(event.data.object)' },
    { kind: 'context', old: 85, new: 87, text: '    default:' },
    { kind: 'removed', old: 86, text: '      return' },
    { kind: 'added', new: 88, text: "      log.warn('stripe: unhandled event', { type: event.type })" },
    { kind: 'added', new: 89, text: '      return assertNever(event)' },
    { kind: 'context', old: 87, new: 90, text: '  }' },
    { kind: 'context', old: 88, new: 91, text: '}' },
  ]
  diffs.set(`${stripe.taskId}:src/webhooks/handle.ts`, {
    file: file('src/webhooks/handle.ts', 96, 54),
    lines: handleLines,
    truncated: false,
  })
  diffs.set(`${stripe.taskId}:src/stripe.ts`, {
    file: file('src/stripe.ts', 18, 31),
    lines: [
      { kind: 'hunk', text: '@@ -1,12 +1,9 @@' },
      { kind: 'removed', old: 1, text: "import Stripe from 'stripe'", changed: ["import Stripe from 'stripe'"] },
      { kind: 'added', new: 1, text: "import { Stripe } from 'stripe'", changed: ["import { Stripe } from 'stripe'"] },
      { kind: 'context', old: 2, new: 2, text: '' },
      { kind: 'removed', old: 3, text: "const API_VERSION = '2023-10-16'", changed: ["'2023-10-16'"] },
      { kind: 'added', new: 3, text: "export const API_VERSION = '2026-09-30.acacia'", changed: ['export ', "'2026-09-30.acacia'"] },
      { kind: 'context', old: 4, new: 4, text: '' },
      { kind: 'context', old: 5, new: 5, text: 'export const stripe = new Stripe(env.STRIPE_KEY, {' },
      { kind: 'context', old: 6, new: 6, text: '  apiVersion: API_VERSION,' },
      { kind: 'removed', old: 7, text: '  maxNetworkRetries: 2,' },
      { kind: 'removed', old: 8, text: '  timeout: 20_000,' },
      { kind: 'added', new: 7, text: '  maxNetworkRetries: 3,' },
      { kind: 'context', old: 9, new: 8, text: '})' },
    ],
    truncated: false,
  })

  return {
    projects: [meridian, billing, site],
    tasks,
    calls,
    events,
    threads,
    diffs,
    looked: ago(now, 75),
  }
}
