import { RepositoryTrustKept, repositoryTrustText, SettingGroup } from '@althar/ui'

import { HEADING } from '../projectSettings/sections'
import s from './RepositoryTrust.module.css'
import { decidedOf, trustFileOf, useAgentSettings } from './useAgentSettings'

/*
 * What a project's repositories' own agent settings run, in its Rules, and
 * what the person decided of each (DEV-280): trusted, with Take back; or
 * not, or changed since, with Trust. A repository with none isn't listed,
 * and a project with none has no part here.
 */

export const text = {
  title: 'Repositories’ agent settings',
  note: 'Hooks, helpers and plugins a repository brings for its agents. A lead starts without them until you trust them as they are.',
}

export function AgentSettingsPart({ projectId }: { projectId: string }) {
  const model = useAgentSettings(projectId)
  if (model.repositories === null || model.repositories.length === 0) return null
  return (
    <SettingGroup title={text.title} note={text.note} headingLevel={HEADING.part}>
      <div className={s.kept}>
        {model.repositories.flatMap((repository) => {
          const error = model.failed?.repositoryId === repository.repositoryId ? { error: model.failed.said } : {}
          const elsewhere = repository.elsewhere ?? []
          return [
            ...(repository.files.length === 0
              ? []
              : [
                  <RepositoryTrustKept
                    key={repository.repositoryId}
                    repository={repository.name}
                    files={repository.files.map(trustFileOf)}
                    decided={decidedOf(repository.files)}
                    onTrust={() => void model.decide(repository, true)}
                    onWithout={() => void model.decide(repository, false)}
                    headingLevel={4}
                    {...error}
                  />,
                ]),
            // What was decided of versions its checkout here doesn't have, such as a task branch's from its line: to take back too.
            ...(elsewhere.length === 0
              ? []
              : [
                  <RepositoryTrustKept
                    key={`${repository.repositoryId}:elsewhere`}
                    repository={repositoryTrustText.elsewhere(repository.name)}
                    files={elsewhere.map(trustFileOf)}
                    decided={decidedOf(elsewhere)}
                    onTrust={() => void model.decide(repository, true, elsewhere)}
                    onWithout={() => void model.decide(repository, false, elsewhere)}
                    headingLevel={4}
                    {...(repository.files.length === 0 ? error : {})}
                  />,
                ]),
          ]
        })}
      </div>
    </SettingGroup>
  )
}
