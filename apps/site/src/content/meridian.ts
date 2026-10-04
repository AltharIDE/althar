import { Brand } from '@althar/ui'

/*
 * The made-up project the site shows: Meridian, a payments service, and
 * one task in it, 418, followed from the ticket to the note it leaves. The
 * same project the app's welcome and the brief use, so the story is one
 * story wherever it's told.
 */

export interface StoryStep {
  id: string
  name: string
  /** Who runs it, in words. */
  who: string
  mark?: Brand
  /** Why it's there, when a rule or a result added it. */
  added?: string
  what: string
  you?: boolean
}

/** Task 418, step by step, as the coordinator and the lead run it. */
export const STORY: readonly StoryStep[] = [
  {
    id: 'triage',
    name: 'Triage',
    who: 'Coordinator',
    what: 'Starts from the project’s notes, not a blank prompt. Reproduces the bug, writes three acceptance criteria and attaches the six notes that apply.',
  },
  {
    id: 'implement',
    name: 'Implement',
    who: 'Claude Code · Opus 5',
    mark: Brand.Anthropic,
    what: 'The lead. It rotates the session token when a role changes, and gets the failing test, not a summary of it.',
  },
  {
    id: 'security',
    name: 'Security review',
    who: 'Qwen3 Coder · on your own GPU',
    mark: Brand.Alibaba,
    added: 'Added by rule: the change touched token rotation',
    what: 'Runs on your own hardware, so this code stays on your network. One finding it can’t settle alone: if rotation fails, the request now fails too.',
  },
  {
    id: 'decide',
    name: 'Your call',
    who: 'You',
    you: true,
    added: 'A change users will see, with no recorded decision',
    what: 'Fail the request, or retry the rotation once? The review doesn’t wait for your answer.',
  },
  {
    id: 'review',
    name: 'Review',
    who: 'Codex · GPT-5.2',
    mark: Brand.OpenAI,
    what: 'The project’s rules ask for a second lab on session code. It finds the same stale read at three more call sites, then reviews the repair and passes it.',
  },
  {
    id: 'repair',
    name: 'Repair',
    who: 'Claude Code · Opus 5',
    mark: Brand.Anthropic,
    added: 'Review found three more call sites',
    what: 'Gets the three findings and your answer, with the original criteria, so it can’t fix one problem by bringing back another.',
  },
  {
    id: 'verify',
    name: 'Verify',
    who: 'Gemini CLI · Gemini 3 Pro',
    mark: Brand.Google,
    what: 'A fresh agent that never saw the code tests it by hand, as a tester would: it runs Meridian, changes a user’s role and checks what they can still reach. All three criteria pass.',
  },
]

/** Notes Meridian already holds. */
export const NOTES: readonly { id: string; title: string; meta: string }[] = [
  { id: 'n1', title: 'All money values are integer minor units', meta: 'Convention · 24 tasks' },
  { id: 'n2', title: 'Webhook deliveries must stay idempotent', meta: 'Decision · 9 tasks' },
  { id: 'n3', title: 'Session code gets a review from a second lab', meta: 'Rule · 14 tasks' },
  { id: 'n4', title: 'The refresh window is 5 minutes in production', meta: 'Seen in task 402' },
  { id: 'n5', title: 'No cascade deletes on ledger tables', meta: 'Decision · 6 tasks' },
]
