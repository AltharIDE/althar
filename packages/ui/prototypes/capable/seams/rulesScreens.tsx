// Scrappy: the kit's screens as the project's Rules see them here: A leads with what asks and keeps today's charter from its sandbox on; B keeps the charter, with what can't be undone as its first sentence and no switch.
import type { ComponentProps } from 'react'

import { ProjectRules as RealProjectRules, projectRulesText } from '../../../src/screens/ProjectRules/ProjectRules'
import { PermissionPolicy, RuleKind, RulePlace } from '../../../src/foundations/vocabulary'
import { WhatAsks } from '../directions/rules/WhatAsks'
import { useProto } from '../state'
import s from '../directions/rules/rules.module.css'

export * from '../../../src/screens/index'

/** B's charter: what can't be undone is the sentence no project changes; the git kinds ask; the rest goes ahead. */
const shorter = {
  fixed:
    'Agents ask you before what can’t be undone: merging, publishing, posting as you, and reading your keys. Your word in the thread is enough.',
  rest: {
    ...projectRulesText.rest,
    mode: {
      ...projectRulesText.rest.mode,
      [PermissionPolicy.Rules]: { ...projectRulesText.rest.mode[PermissionPolicy.Rules], after: 'What Althar can’t read goes ahead too.' },
    },
  },
}

const ASKING = [RuleKind.DefaultBranch, RuleKind.ForcePush, RuleKind.ManyBranches, RuleKind.DeleteBranch, RuleKind.Deploy]

export function ProjectRules(props: ComponentProps<typeof RealProjectRules>) {
  const p = useProto()
  const tune = p.surface === 'tune' && p.direction !== 'Today'
  if (!tune && (p.surface !== 'rules' || p.direction === 'Today')) return <RealProjectRules {...props} />
  if (tune || p.direction === 'A')
    return (
      <>
        <WhatAsks />
        <RealProjectRules {...props} allowAll={false} className={s.trimA} />
      </>
    )
  const kinds = Object.fromEntries(
    Object.values(RuleKind).map((kind) => [
      kind,
      ASKING.includes(kind) ? RulePlace.Ask : kind === RuleKind.Outside ? RulePlace.Allow : RulePlace.Rest,
    ]),
  ) as Record<RuleKind, RulePlace>
  return (
    <RealProjectRules
      {...props}
      allowAll={false}
      mode={PermissionPolicy.Rules}
      kinds={kinds}
      commands={[
        { id: 'never-rm', pattern: 'rm -rf /', match: props.commands[0]?.match ?? ('prefix' as never), place: RulePlace.Never },
        { id: 'ask-fly', pattern: 'fly deploy', match: props.commands[0]?.match ?? ('prefix' as never), place: RulePlace.Ask },
      ]}
      text={shorter}
      className={s.trimB}
    />
  )
}
