/*
 * A plan runs once: two starts that land together, the person's and the
 * countdown's, can't give it two runs and two leads.
 */
export const statements: ReadonlyArray<string> = ['CREATE UNIQUE INDEX runs_by_plan ON runs (plan_id) WHERE plan_id IS NOT NULL']
