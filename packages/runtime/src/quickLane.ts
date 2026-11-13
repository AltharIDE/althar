/*
 * Which tasks are planned small, for the quick lane (ADR-032's follow-up of
 * 6 November). A one-line fix waited nine minutes for one of four places,
 * all taken by long tasks, and then worked for one: of the small tasks
 * measured in docs/research/small-task-timeline.md, four in eleven waited,
 * 14 minutes in the middle. A task planned small may take one place beyond
 * the number, so it never waits behind the long ones.
 *
 * A light lead qualifies when the plan explicitly marks a small change,
 * independently of its review timing. Older plans with no active review
 * retain their existing qualification. Reviewers take ordinary places; a
 * harder lead effort leaves the lane. Read from the run's own parameters.
 */

/** The efforts that count as light, across agents: Codex's `minimal`, and `low` everywhere. */
const LIGHT = new Set(['minimal', 'low'])

/** How many places beyond the number tasks planned small may take: one, so one small task never waits behind long ones. */
export const QUICK_LANE = 1

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null

/**
 * Whether a run's parameters, as the store keeps them (JSON), plan a small
 * task: a lead at a light effort, plus a size marker or no active review. Anything
 * it can't read is not small: it waits as every task does.
 */
export const plannedSmall = (parameters: string | null | undefined): boolean => {
  if (parameters == null) return false
  let read: unknown
  try {
    read = JSON.parse(parameters)
  } catch {
    return false
  }
  const steps = isRecord(read) ? read.steps : undefined
  if (!Array.isArray(steps)) return false
  const of = (key: string) => steps.filter((step): step is Readonly<Record<string, unknown>> => isRecord(step) && step.key === key)
  const lead = of('implement')
  if (lead.length !== 1 || lead[0]?.skipped === true) return false
  const effort = lead[0]?.effort
  if (typeof effort !== 'string' || !LIGHT.has(effort)) return false
  return (isRecord(read) && read.smallChange === true) || of('review').every((review) => review.skipped === true)
}
