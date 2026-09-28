import type { ProjectSummary } from '../chrome/ProjectSwitcher/ProjectSwitcher'
import { TrackStep } from '../foundations/vocabulary'
import type { PeekStep } from '../dock/WorkPeek/WorkPeek'
import type { ListEntry } from '../dock/ListPeek/ListPeek'

/* The projects on this Mac, as the switcher lists them. */
export const PROJECTS: ProjectSummary[] = [
  {
    id: 'meridian',
    name: 'Meridian',
    about: 'Billing and payments surface',
    where: 'meridian-api · meridian-web',
    yours: 4,
    running: 4,
    touched: 'now',
  },
  { id: 'halyard', name: 'Halyard', about: 'Internal API gateway', where: 'halyard-api', yours: 0, running: 1, touched: '2h ago' },
  { id: 'tessera', name: 'Tessera', about: 'Design system', where: 'tessera-ds', yours: 1, running: 0, touched: 'yesterday' },
  { id: 'ferrous', name: 'Ferrous', about: 'Event ingestion', where: 'ferrous-ingest', yours: 0, running: 0, touched: '11 days ago' },
]
export const [MERIDIAN] = PROJECTS as [ProjectSummary]

/* Task 418's steps, as the dock lists them. */
export const STEPS_418: PeekStep[] = [
  { label: 'Requirements', state: TrackStep.Done, meta: 'refined by the coordinator' },
  { label: 'Implement', state: TrackStep.Done, meta: '7 files · Opus 5' },
  { label: 'Review', state: TrackStep.Done, meta: '3 findings · Sonnet 5 and Gemini 3 Pro' },
  { label: 'Repair', state: TrackStep.Done, meta: '3 of 3 fixed' },
  { label: 'Security review', state: TrackStep.Now, meta: 'added after the auth files changed', added: true },
  { label: 'Verify', state: TrackStep.Next, meta: 'unit and integration' },
]

export const NOTES_KEPT: ListEntry[] = [
  { id: 'k1', title: 'Webhook deliveries must stay idempotent', meta: 'Decision · 4 Mar · task 407 · used by 9 tasks' },
  { id: 'k2', title: 'All money values are integer minor units', meta: 'Convention · 12 Jan · used by 24 tasks' },
  { id: 'k3', title: 'Session tokens rotate on privilege change', meta: 'Architecture · 14 Jan · used by 6 tasks', flagged: true },
]

export const NOTES_SEEN: ListEntry[] = [
  { id: 'e1', title: 'Checkout timeouts follow cold Lambda starts', meta: 'task 420 · 6 findings · 41m ago' },
  { id: 'e3', title: 'The token refresh window is 5 minutes in production', meta: 'task 418 · disagrees with k3', flagged: true },
]

export const ARTIFACTS: ListEntry[] = [
  { id: 'r1', title: 'Release readiness: 2.14', meta: 'Assessment · task 415 · 4 days ago' },
  { id: 'r2', title: 'Billing webhook v2 migration plan', meta: 'Plan · task 419 · in use' },
  { id: 'r4', title: 'Token refresh: review findings', meta: 'Review · task 418 · 3 findings' },
]
