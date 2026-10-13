import type { FoundRow } from '../chrome/Finder/Finder'
import { FoundState } from '../foundations/vocabulary'
import { HALYARD, MERIDIAN, TESSERA } from './home'

/* What a search finds in meridian, and across the projects on the home, on a Tuesday afternoon. */

/** Meridian's tasks changed last, as the finder opens with nothing typed. */
export const RECENT: FoundRow[] = [
  { id: 't419', title: 'Retry webhook deliveries with backoff', state: FoundState.Running, pullRequest: '#1206' },
  { id: 't416', title: 'Rate-limit the public charges endpoint', state: FoundState.Yours },
  { id: 't414', title: 'Fix the flaky refund settlement test', state: FoundState.Ready, pullRequest: '#1199' },
  { id: 't421', title: 'Extract rate-limit policy into a shared module', state: FoundState.Planned },
  { id: 't402', title: 'Idempotency keys on refunds', state: FoundState.Merged, pullRequest: '#1184' },
  { id: 't409', title: 'Move the API docs to the new theme', state: FoundState.Stopped },
]

/** "retr" in meridian: the title first, then what was asked, then what a lead built, then a file. */
export const RETRY: FoundRow[] = [
  { id: 't419', title: 'Retry webhook deliveries with backoff', state: FoundState.Running, pullRequest: '#1206' },
  {
    id: 't414',
    title: 'Fix the flaky refund settlement test',
    state: FoundState.Ready,
    pullRequest: '#1199',
    matched: [
      { text: '…it fails one run in five on CI; ', hit: false },
      { text: 'retrying', hit: true },
      { text: ' it passes, so it’s the clock…', hit: false },
    ],
  },
  {
    id: 't398',
    title: 'Charges time out under load',
    state: FoundState.Done,
    matched: [
      { text: 'Bounded ', hit: false },
      { text: 'retries', hit: true },
      { text: ' in the payments client, with jitter…', hit: false },
    ],
  },
  {
    id: 't377',
    title: 'Ledger export for finance',
    state: FoundState.Abandoned,
    matched: [
      { text: 'src/ledger/', hit: false },
      { text: 'retry', hit: true },
      { text: '.ts', hit: false },
    ],
  },
]

/** "1206" across every project: a pull request's number, in two of them. */
export const ACROSS: FoundRow[] = [
  {
    id: 't419',
    title: 'Retry webhook deliveries with backoff',
    state: FoundState.Running,
    project: MERIDIAN,
    pullRequest: '#1206',
  },
  {
    id: 'h212',
    title: 'Publish the gateway’s next release',
    state: FoundState.Yours,
    project: HALYARD,
    matched: [
      { text: 'Ships after meridian ', hit: false },
      { text: '#1206', hit: true },
      { text: ' merges', hit: false },
    ],
  },
  { id: 'x88', title: 'Tokens for the project inks', state: FoundState.Stopped, project: TESSERA, pullRequest: '!1206' },
]

/** Long words, as people and leads write them. */
export const LONG: FoundRow[] = [
  {
    id: 't430',
    title:
      'Move every webhook consumer off the v1 signing scheme and onto rotating keys, keeping the old keys for a week so partners can switch',
    state: FoundState.Planned,
    project: MERIDIAN,
    pullRequest: '#1212',
    matched: [
      {
        text: '…partners told us they need at least a week to switch, and two of them only deploy on Thursdays, so the old keys stay until the ',
        hit: false,
      },
      { text: 'rotation', hit: true },
      { text: ' has been live for seven days and every delivery in that window was signed both ways…', hit: false },
    ],
  },
]
