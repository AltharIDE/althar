import { describe, expect, it } from 'vitest'

import { sealUrl as runtimeSealUrl, type ReviewRecord } from '@althar/runtime/pullRequestReview'
import { SEAL_STYLES, sealOf, sealSvg } from '@althar/ui'

/*
 * The review seal's address is written by the runtime, as a pull request
 * opens, and read by the site, which draws it from the kit's drawing: the
 * two keep one format, here.
 */

const RECORD = {
  reviewer: 'GPT-6.1 Sol',
  lead: 'Claude Opus 5.5',
  passes: 3,
  sha: '2f67c42a0b1c2d3e4f5061728394a5b6c7d8e9f0',
  date: '2026-10-31',
  changed: [],
  kept: [],
} satisfies ReviewRecord

describe('the review seal’s address', () => {
  it('is drawn by the site as the runtime wrote it, in each look and ink', () => {
    for (const style of SEAL_STYLES)
      for (const ink of ['light', 'dark'] as const) {
        const asked = sealOf(new URL(runtimeSealUrl(style, RECORD, ink)))
        expect(asked).toEqual({ style, ink, facts: { model: 'GPT-6.1 Sol', sha: '2f67c42', passes: 3, date: '2026-10-31' } })
        expect(sealSvg(style, asked!.facts, ink)).toContain('aria-label="Reviewed by GPT-6.1 Sol in 3 passes, at 2f67c42"')
      }
  })
})
