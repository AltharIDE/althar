import type { ProjectInk as Inks } from '@althar/contracts'
import { ProjectIdentity, type ProjectInk } from '@althar/ui'

import { contractInk, kitInk } from '../../shared/inks'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * What a project is: its name and the ink its mark is drawn in, changed in
 * place. How its tasks start, go and end is its Tasks.
 */

export function GeneralSection({ model, seed }: { model: ProjectSettingsModel; seed: string }) {
  const name = model.name ?? ''
  // Another project's ink says whose it is, and can still be chosen.
  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const [ink, project] of Object.entries(model.taken) as ReadonlyArray<[Inks, string | undefined]>)
    if (project !== undefined) taken[kitInk(ink)] = project
  return (
    <ProjectIdentity
      name={name}
      seed={seed}
      ink={kitInk(model.ink ?? 'clay')}
      taken={taken}
      onRename={model.rename}
      onInk={(next) => model.setInk(contractInk(next))}
      {...(model.failed === null ? {} : { error: model.failed })}
    />
  )
}
