import { newProjectDefaultsText, NewProjectDefaults, PlansAndReviews, SettingGroup, DiffersLine, Problem } from '@althar/ui'
import type { NewProjectDefaultsValue } from '@althar/ui'

import { type DefaultKey, useDifferingProjects } from './useDifferingProjects'
import { useNewProjectDefaults } from './useNewProjectDefaults'
import { usePlansAndReviews } from './usePlansAndReviews'
import s from './Settings.module.css'
import { text } from './text'

/*
 * How every task goes and what a new project starts with, each setting beside what it makes: a proposed plan
 * as the thread shows it, its countdown a ring; the rounds of review as the seals they leave. Then what the rules
 * of a project made from now on start with (ADR-097: Allow everything is the default, so no permission is asked
 * about here). Changing one of those leaves the projects there already as they are; where a project's own value
 * differs, its row says so, and brings every project in line in one press.
 */

/** A project's value for a row, in the words the row's choices use. */
const worded = (key: DefaultKey, value: unknown): string => {
  if (typeof value === 'boolean') return value ? text.on : text.off
  if (key === 'end') return newProjectDefaultsText.end.options[value as NewProjectDefaultsValue['end']].label
  if (key === 'afterMergeReview')
    return newProjectDefaultsText.afterMergeReview.options[value as NewProjectDefaultsValue['afterMergeReview']].label
  if (key === 'usageLimit') return newProjectDefaultsText.usageLimit.options[value as NewProjectDefaultsValue['usageLimit']].label
  return String(value)
}

export function TasksSection() {
  const plans = usePlansAndReviews()
  const defaults = useNewProjectDefaults()
  const { differing, inEveryProject, busy, failed } = useDifferingProjects(defaults?.value ?? null)
  return (
    <>
      {plans !== null && (
        <SettingGroup title={text.everyTask} headingLevel={2}>
          <PlansAndReviews value={plans.value} onChange={plans.set} />
        </SettingGroup>
      )}
      {defaults !== null && (
        <SettingGroup title={text.newProjects} note={text.newProjectsNote} headingLevel={2}>
          <NewProjectDefaults
            value={defaults.value}
            onChange={defaults.set}
            differs={Object.fromEntries(
              Object.entries(differing).map(([key, projects]) => [
                key,
                <DiffersLine
                  key={key}
                  projects={projects.map((one) => ({ id: one.id, name: one.name, value: worded(key as DefaultKey, one.value) }))}
                  onUseEverywhere={() => inEveryProject(key as DefaultKey)}
                  busy={busy === key}
                  {...(failed === null || busy !== null ? {} : { error: failed })}
                />,
              ]),
            )}
          />
        </SettingGroup>
      )}
      {(plans?.failed === true || defaults?.failed === true) && <Problem className={s.failed}>{text.failed}</Problem>}
    </>
  )
}
