import type { ViewedComment } from '../outputs/LineComments/LineComments'

/* The person's comments on the refunds router's diff (ROUTER_DIFF), in each state a comment has. */

export const ON_BUCKET: ViewedComment = {
  id: 'comment-bucket',
  path: 'src/refunds/router.ts',
  side: 'new',
  start: 22,
  end: 23,
  code: [
    { kind: 'added', text: "  bucket: 'partner'," },
    { kind: 'added', text: "  retryAfter: 'seconds'," },
  ],
  note: 'Read the bucket from the partner’s config rather than naming it here, so charges and refunds can’t drift apart.',
  state: 'draft',
  n: 1,
  line: 23,
}

export const ON_OUTERMOST: ViewedComment = {
  id: 'comment-outermost',
  path: 'src/refunds/router.ts',
  side: 'old',
  start: 20,
  end: 20,
  under: 20,
  code: [{ kind: 'removed', text: "refunds.post('/', idempotent(createRefund))" }],
  note: 'Keep idempotent outermost, so a retried refund isn’t counted against the limit twice.',
  state: 'draft',
  n: 2,
  line: 20,
}

export const GATHERED: readonly ViewedComment[] = [ON_BUCKET, ON_OUTERMOST]

export const SENT: readonly ViewedComment[] = GATHERED.map(({ n: _n, ...one }) => ({ ...one, state: 'sent', sentAt: '2m' }))

export const ADDRESSED: readonly ViewedComment[] = [{ ...(SENT[0] as ViewedComment), state: 'addressed' }, SENT[1] as ViewedComment]
