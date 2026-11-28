import type { MergeLineRow, MergingRow } from '@althar/ui'

/* What each moment's merge line holds, in the coordinator's thread and a task's. */

export type Where = 'coordinator' | 'task'
export type Moment = 'one' | 'several' | 'back' | 'merged'

const gh = (n: number) => `https://github.com/charrette/althar/pull/${n}`

const FLAKIES = { key: '1232', label: '#1232', title: 'Fix runtime flakies: changesMergeNeeds and backToWork', url: gh(1232) }
const CASCADE = { key: '1168', label: '#1168', title: 'Release branches with a cascade into main', url: gh(1168) }
const SITE = { key: '1270', label: '#1270', title: 'Site shows 0.10.0 and 0.6.1 as released', url: gh(1270) }
const WORKERS = { key: 'workers', label: 'Workers readiness', title: '', url: null }
const MOBILE = {
  key: 'm41',
  label: 'mobile #41',
  title: 'Merge into main sits below Ship on the phone too',
  url: 'https://github.com/charrette/althar-mobile/pull/41',
}

const REASON = 'Checks fail: e2e on Windows, worktree cleanup. Its lead is fixing it.'

export const rowsOf = (where: Where, moment: Moment): MergingRow[] => {
  if (where === 'task') {
    switch (moment) {
      case 'one':
        return [{ ...FLAKIES, state: 'merging' }]
      case 'several':
        return [
          { ...FLAKIES, state: 'merged' },
          { ...MOBILE, state: 'checks' },
        ]
      case 'back':
        return [
          { ...FLAKIES, state: 'merged' },
          { ...MOBILE, state: 'sent_back', reason: 'Checks fail: the iOS build, a missing pod. Fixing it here.' },
        ]
      case 'merged':
        return [
          { ...FLAKIES, state: 'merged' },
          { ...MOBILE, state: 'merged' },
        ]
    }
  }
  switch (moment) {
    case 'one':
      return [{ ...FLAKIES, state: 'merging' }]
    case 'several':
      return [
        { ...FLAKIES, state: 'merged' },
        { ...CASCADE, state: 'merging' },
        { ...SITE, state: 'queued' },
        { ...WORKERS, state: 'waiting', once: 'once its checks pass' },
      ]
    case 'back':
      return [
        { ...FLAKIES, state: 'merged' },
        { ...CASCADE, state: 'sent_back', reason: REASON },
        { ...SITE, state: 'merging' },
      ]
    case 'merged':
      return [
        { ...FLAKIES, state: 'merged' },
        { ...CASCADE, state: 'merged' },
        { ...SITE, state: 'merged' },
      ]
  }
}

/** The folded line the thread keeps where the merge was asked, once all are in. */
export const foldedOf = (where: Where): MergeLineRow[] =>
  rowsOf(where, 'merged').flatMap((row) =>
    row.url === null ? [] : [{ number: Number(row.label.replace(/\D/g, '')), title: row.title, url: row.url, state: 'merged' as const }],
  )
