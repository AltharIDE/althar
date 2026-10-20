import { AltharLine, Issue, Markdown, Reviewer, Verdict } from '@althar/ui'

import { productBrand, productName } from '../../shared/products'
import type { StepResult } from '../../shared/thread'
import { text as threadText } from '../../shared/ThreadBlocks'

/*
 * What a review and Althar's own publishing reported, as a task's thread
 * draws them and its Graph face opens them: the reviewer's verdict and
 * findings, then its summary; Althar's words and the pull request under them.
 */

export const reportText = {
  /** A pull request the task opened, or a branch it pushed, where Althar's report doesn't say. */
  opened: (name: string) => `Opened ${name}.`,
  pushed: 'Pushed the branch.',
}

/** A review's report: its verdict and findings, each where it points, then what the reviewer said. */
export function ReviewReport({ id, result }: { id: string; result: StepResult }) {
  return (
    <>
      <Reviewer
        verdict={result.verdict === 'pass' ? Verdict.Pass : Verdict.Changes}
        findings={result.findings.map((finding, index) => ({
          id: `${id}-${index}`,
          weight: finding.severity,
          ...(finding.file === null ? {} : { at: finding.line === null ? finding.file : `${finding.file}:${finding.line}` }),
          claim: finding.claim,
        }))}
      />
      {result.summary !== '' && <Markdown source={result.summary} />}
    </>
  )
}

/** Althar's own words for what it published, and the pull request under them. */
export function PublishedReport({ result }: { result: StepResult }) {
  const change = result.change
  const said = result.summary.trim()
  return (
    <>
      <AltharLine>
        {said !== '' ? said : change === null ? reportText.pushed : reportText.opened(`${change.short} ${change.prefix}${change.number}`)}
      </AltharLine>
      {change !== null && (
        <Issue
          mark={productBrand(change.product)}
          source={productName(change.product)}
          id={`${change.short} ${change.prefix}${change.number}`}
          title={change.title}
          href={change.url}
          meta={[change.repository, change.draft ? threadText.change.draft : threadText.change[change.state]].join(' · ')}
        />
      )}
    </>
  )
}
