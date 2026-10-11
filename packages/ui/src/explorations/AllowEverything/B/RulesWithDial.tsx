import { useState } from 'react'

import { PermissionPolicy } from '../../../foundations/vocabulary'
import { projectRulesText } from '../../../screens/ProjectRules/ProjectRules'
import { MODE_WORDS, MODES_BY_ASKING, PROJECT, PROJECT_DEFAULT, TASK } from '../fixtures'
import { RulesSketch } from '../parts/RulesSketch'
import { TasksClause } from '../parts/TasksClause'
import { PostureDial } from './PostureDial'

/*
 * Meridian's rules page as path B has it, kept as it is changed: the dial
 * over the sentences, and task 418 listed while it sets its own. Shared by
 * B's stories and B + C's.
 */

export const rulesWithDialText = {
  off: 'Not in effect while everything is allowed.',
  aside: 'Set on a task',
  says: (mode: PermissionPolicy) => `: ${projectRulesText.rest.mode[mode].word}.`,
  back: `Back to ${PROJECT}’s`,
}

export function RulesWithDial({
  mode: initial = PROJECT_DEFAULT,
  own: initialOwn = null,
}: {
  mode?: PermissionPolicy
  own?: PermissionPolicy | null
}) {
  const t = rulesWithDialText
  const [mode, setMode] = useState(initial)
  const [own, setOwn] = useState(initialOwn)
  const everything = mode === PermissionPolicy.AllowAll
  return (
    <RulesSketch
      project={PROJECT}
      top={<PostureDial order={MODES_BY_ASKING} words={MODE_WORDS} value={mode} onChange={setMode} />}
      restWord={projectRulesText.rest.mode[mode].word}
      restAfter={projectRulesText.rest.mode[mode].after}
      off={everything ? { ask: t.off, allow: t.off } : {}}
      more={
        <TasksClause
          label={t.aside}
          headingLevel={2}
          tasks={
            own === null
              ? []
              : [
                  {
                    id: TASK.key,
                    task: TASK.key,
                    title: TASK.title,
                    says: t.says(own),
                    back: { label: t.back, onBack: () => setOwn(null) },
                  },
                ]
          }
        />
      }
    />
  )
}
