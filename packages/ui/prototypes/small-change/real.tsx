import { Model, SmallChange, type SmallChangeReview, type SmallChangeReviewWhen } from '@althar/ui'
import { useContext, useEffect, useState } from 'react'

import { type Direction, ReviewMode } from './calm'
import { type SmallState, SOL, SONNET } from './states'

/*
 * The chosen direction, Route, as the kit's own SmallChange: each state of
 * the page as the app would give it. Its review stop can be pressed: the
 * choice is kept here, starting from the project's setting (R).
 */

const iso = (time: string | undefined) => (time === undefined ? null : `2026-11-11T${time}:00`)
const noop = () => {}

function Real({ state: s }: { state: SmallState }) {
  const mode = useContext(ReviewMode)
  const project: SmallChangeReviewWhen = s.key === 'full' ? 'before' : mode === 'off' ? 'none' : 'after'
  const [when, setWhen] = useState<SmallChangeReviewWhen>(project)
  useEffect(() => setWhen(project), [project])
  const merged = s.merged !== undefined
  const passed = s.checks?.filter((c) => c.state === 'passed').length ?? 0
  const checks =
    s.key === 'started' || s.key === 'changing'
      ? ({ state: 'waiting', passed: 0, total: 0, failing: null, at: null } as const)
      : s.key === 'checks' || s.key === 'full'
        ? ({ state: 'running', passed, total: s.checks?.length ?? 0, failing: null, at: null } as const)
        : s.key === 'failed'
          ? ({ state: 'failed', passed, total: 5, failing: 'types', at: null } as const)
          : ({ state: 'passed', passed: 5, total: 5, failing: null, at: iso(s.checked) } as const)
  const review: SmallChangeReview = {
    when,
    state:
      when === 'none' || !merged
        ? 'waiting'
        : s.key === 'reviewing'
          ? 'running'
          : s.key === 'findings'
            ? 'found'
            : mode === 'major'
              ? 'clear'
              : 'clear',
    findings: s.findings ?? 0,
    at: iso(s.reviewed),
  }
  const explain =
    when === 'before' ? (
      <>
        Made a full task: <Model model={SOL} short /> reads it before it merges.
      </>
    ) : when === 'none' ? (
      <>
        Starts at once on <Model model={SONNET} short />, with no plan, and no review after it merges.
      </>
    ) : (
      <>
        Starts at once on <Model model={SONNET} short />, with no plan. You merge it; <Model model={SOL} short /> then reads what merged,
        and {mode === 'all' ? 'what it finds comes back here' : 'only something major comes back here'}.
      </>
    )
  const open = !merged && s.key !== 'full'
  return (
    <SmallChange
      title={s.title}
      started={iso(s.started) ?? ''}
      changed={{
        at: s.key === 'started' || s.key === 'changing' ? null : iso(s.changed),
        words: s.files === undefined ? null : `${s.files} files`,
      }}
      checks={checks}
      merge={{
        state: merged
          ? 'merged'
          : s.key === 'ready'
            ? 'ready'
            : s.key === 'merging'
              ? 'merging'
              : s.key === 'queued'
                ? 'queued'
                : 'waiting',
        at: iso(s.merged),
      }}
      review={review}
      explain={explain}
      onMerge={noop}
      {...(open ? { onReview: setWhen } : {})}
      onFindings={noop}
      {...(s.key === 'full' ? { onOpenReview: noop } : {})}
    />
  )
}

export const REAL: Direction = {
  key: 'route',
  letter: 'A',
  name: 'Route',
  idea: 'The kit’s SmallChange as built: its stops in a row; press Review to move it before the merge or take it off.',
  Card: Real,
}
