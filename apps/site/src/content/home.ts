import { Agent } from './agents'

/*
 * What the developer page says. The page is for people who code with agents
 * today: one app for the agents they already pay for, a coordinator that
 * hands out the work, and tasks that review and fix themselves. It doesn't
 * pitch project knowledge or talk like an enterprise; the earlier page that
 * did is kept at /enterprise.
 */

export const BRAND = 'Althar'

export const HERO = {
  kicker: 'Open source · desktop app',
  /** "You pay for Claude and Codex. Use them both at once." The names are drawn with their marks. Gemini joins them when Althar runs it. */
  pay: 'You pay for',
  names: [
    { agent: Agent.Claude, word: 'Claude' },
    { agent: Agent.Codex, word: 'Codex' },
  ],
  use: 'Use them both at once.',
  lead: 'Althar runs Claude Code, Codex and OpenCode side by side, on the plans you already have. One hits its limit, the next takes over. One gets it wrong, another catches it.',
  fine: 'Free and open source. No account, and no API key of its own.',
} as const

export const PLANS = {
  no: '01',
  label: 'No new bill',
  title: ['No new account.', 'No new bill.'],
  lead: 'Althar uses the sign-ins already on your machine: your Claude plan, your ChatGPT plan, your keys. No token reselling, no proxy, nothing of ours between you and the model.',
  note: 'Agents join through the Agent Client Protocol, so a new one takes an adapter, not a rewrite.',
} as const

export const WHY = {
  no: '02',
  label: 'Why more than one',
  ask: ['The best coding agent', 'right now is'],
  /** The answer keeps changing. */
  answers: [
    { agent: Agent.Claude, word: 'Claude Code.' },
    { agent: Agent.Codex, word: 'Codex.' },
    { agent: Agent.Gemini, word: 'Gemini.' },
    { agent: 'open', word: 'an open model.' },
    { agent: 'new', word: 'something new.' },
  ],
  lead: 'Ask again next month. New models ship most weeks, the best one for code keeps changing, open models keep closing the gap, and prices and limits move with all of it. The safe bet is not to bet on one.',
  reasons: [
    {
      key: 'A',
      title: 'Switch agents mid‑task.',
      body: 'Claude runs out halfway? Codex picks up the same thread, the same plan and the same branch.',
    },
    { key: 'B', title: 'Every plan, all at once.', body: 'Work goes to whichever agent has room left today. No more waiting for a reset.' },
    {
      key: 'C',
      title: 'Open source.',
      body: 'Nothing to get locked into. Read every line, fork it, run it. If we disappear, your setup doesn’t.',
    },
  ],
  close: ['Subscriptions come and go.', 'Your projects stay.'],
  shifts: 'Every shift since August',
} as const

export const COORDINATOR = {
  no: '03',
  label: 'The coordinator',
  title: ['Tell it what.', 'It picks the team.'],
  lead: 'One chat for all your projects. Say what you want done; it turns that into tasks and proposes who does each step. Leave it alone and it starts.',
  points: [
    { title: 'Knows your projects.', body: 'It reads the repos and your rules before it plans. You don’t explain twice.' },
    { title: 'Runs several at once.', body: 'Ask for three things, get three tasks going side by side.' },
    { title: 'Builds the team.', body: 'A lead to implement, other models to review and audit. Swap anyone before it starts.' },
  ],
  ask: 'Rate-limit refunds like charges, and fix the refunds docs while you’re there.',
  reply:
    'Two tasks. Refunds write to money records, so your security review applies, and Codex reviews Claude’s work. Change anyone before they start.',
} as const

export const LOOP = {
  no: '04',
  label: 'Every task',
  title: ['Implement. Review.', 'Fix. Review again.'],
  lead: 'Tasks don’t stop at a first draft. Other models review the lead’s work, the lead fixes what they find, and it goes round until the review is clean. Your rules add steps, like a security review when money is touched. You only step in to merge.',
} as const

export const CLOSE = {
  no: '05',
  label: 'Get Althar',
  title: ['Bring the agents', 'you already pay for.'],
} as const
