import { type ComponentProps, useEffect } from 'react'

import { Select, SettingGroup, SettingList, SettingRow, SettingSwitch } from '@althar/ui'

import { CodeSection as Code } from '../../../src/renderer/features/projectSettings/CodeSection'
import { HEADING } from '../../../src/renderer/features/projectSettings/sections'
import { type Home, REPOS } from '../artifacts'
import { KILN_HOME, live, useLive } from '../live'
import { foldersIn } from '../repos'

/*
 * The lab's Code and issues (in place of features/projectSettings'
 * CodeSection, for its settings page): the section as it is, then where the
 * project's artifacts go in git, the setting Save to repo starts from (E5–E7).
 * The first save sets it; here it changes, as any setting does, at once.
 */

export function CodeSection(props: ComponentProps<typeof Code>) {
  return (
    <>
      <Code {...props} />
      <Artifacts />
    </>
  )
}

/** Each repository's folders, two deep: where artifacts could go. */
const FOLDERS = REPOS.flatMap((repo) =>
  foldersIn(repo.name)
    .filter((folder) => folder.split('/').filter(Boolean).length <= 2)
    .map((folder) => ({ value: `${repo.name}:${folder}`, label: `${repo.name}/${folder}` })),
)

const HOWS = [
  { value: 'pr', label: 'A pull request of its own' },
  { value: 'main', label: 'Straight to main' },
] as const

const HERE = 'lab-artifacts'

function Artifacts() {
  const { home } = useLive()
  // The lab opens Settings to show this: it's the last group, below the fold.
  useEffect(() => {
    document.getElementById(HERE)?.scrollIntoView({ block: 'center' })
  }, [])
  const set = (change: Partial<Home>) => live.setHome({ ...(home ?? KILN_HOME), ...change })
  return (
    <SettingGroup
      id={HERE}
      title="Artifacts"
      headingLevel={HEADING.part}
      note="Where Save to repo puts an artifact unless someone picks somewhere else. The first one saved sets it."
    >
      <SettingList>
        <SettingRow title="Saved in">
          {() => (
            <Select
              label="Saved in"
              options={FOLDERS}
              value={home === null ? null : `${home.repo}:${home.folder}`}
              placeholder="Set by the first save"
              searchable
              width={240}
              onChange={(value) => {
                const [repo = 'kiln', folder = ''] = value.split(':')
                set({ repo, folder })
              }}
            />
          )}
        </SettingRow>
        <SettingRow
          title="How they go in"
          note={
            (home?.how ?? 'pr') === 'pr' ? 'Each on a branch of its own, with a pull request' : 'Committed to the repository’s main branch'
          }
        >
          {() => <Select label="How they go in" options={HOWS} value={home?.how ?? 'pr'} width={240} onChange={(how) => set({ how })} />}
        </SettingRow>
        <SettingSwitch
          title="Commit each new version"
          note="Otherwise only the version someone saves"
          checked={home?.follow ?? true}
          onChange={(follow) => set({ follow })}
        />
      </SettingList>
    </SettingGroup>
  )
}
