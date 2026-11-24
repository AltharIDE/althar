import { RepositoryTrustKept, SettingGroup } from '@althar/ui'

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
        {model.repositories.map((repository) => (
          <RepositoryTrustKept
            key={repository.repositoryId}
            repository={repository.name}
            files={repository.files.map(trustFileOf)}
            decided={decidedOf(repository)}
            onTrust={() => void model.decide(repository, true)}
            onWithout={() => void model.decide(repository, false)}
            headingLevel={4}
            {...(model.failed?.repositoryId === repository.repositoryId ? { error: model.failed.said } : {})}
          />
        ))}
      </div>
    </SettingGroup>
  )
}
