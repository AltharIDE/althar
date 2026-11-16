import { useState } from 'react'

import { Brand, Icon, ProjectInk, RuntimeState } from '@althar/ui'
import { NewProject, Welcome } from '@althar/ui/screens'

import { ByKind, ByPlace, type Picks, usePicks } from './Found'
import { opening, useLab } from './state'
import { world } from './world'
import s from './arrival.module.css'

/*
 * Arriving: the project being added, on the kit's own screens, with what
 * other tools left in its folders. A and B give the welcome a step of its
 * own after the project is made, and the New project tab a list beside its
 * folder: A by kind, B by place. C changes neither: what was found waits on
 * the board.
 */

const RUNTIMES = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, version: '2.4.1', state: RuntimeState.Ready, account: 'Max' },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, version: '0.61.0', state: RuntimeState.Ready, account: 'Pro' },
  { id: 'cursor', name: 'Cursor', brand: Brand.Cursor, state: RuntimeState.Missing },
] as const

const REPOSITORIES = [
  { id: 'althar', name: 'althar', where: '~/Code/althar', facts: 'main · today' },
  { id: 'meridian', name: 'meridian', where: '~/Code/meridian', facts: 'main · last week' },
  { id: 'site', name: 'site', where: '~/Code/site', facts: 'main · in September' },
]

const bring = (picks: Picks) =>
  world.bring({ worktrees: [...picks.worktrees], conversations: [...picks.conversations], setup: picks.setup })

const Picker = ({ picks }: { picks: Picks }) => {
  const { d } = useLab()
  return d === 'b' ? <ByPlace picks={picks} /> : <ByKind picks={picks} />
}

/** The first run's welcome, on the project's step. */
export function WelcomeArrival({ onOpen }: { onOpen: () => void }) {
  const { d } = useLab()
  const picks = usePicks('arriving')
  const [picked, setPicked] = useState<readonly string[]>(['althar'])
  const [name, setName] = useState('althar')
  // The address can open it on its step after the project's made, for a screenshot.
  const [made, setMade] = useState(() => opening.get('step') === 'bring')
  const go = picks.go()
  return (
    <div className={s.bare}>
      <Welcome
        toured
        defaultStep={made ? 'bring' : 'project'}
        runtimes={RUNTIMES as never}
        repositories={REPOSITORIES}
        picked={picked}
        onPick={(id) => setPicked((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]))}
        onAdd={() => undefined}
        name={name}
        onNameChange={setName}
        onCreate={() => setMade(true)}
        made={made}
        {...(d === 'c'
          ? {}
          : {
              bring: {
                content: <Picker picks={picks} />,
                go,
                onGo: () => bring(picks),
              },
            })}
        onOpen={onOpen}
      />
    </div>
  )
}

/** A New project tab, its folder read. */
export function NewProjectArrival({ onCreated }: { onCreated: () => void }) {
  const { d } = useLab()
  const picks = usePicks('arriving')
  const [name, setName] = useState('althar')
  const [ink, setInk] = useState<ProjectInk>(ProjectInk.Clay)
  const go = picks.go()
  const folder = {
    id: 'f_althar',
    name: 'althar',
    where: '~/Code/althar',
    host: { name: 'GitHub', brand: Brand.GitHub },
    remote: 'AltharIDE/althar',
  }
  return (
    <div className={s.page}>
      <NewProject
        seed="p_althar"
        name={name}
        onNameChange={setName}
        ink={ink}
        onInkChange={setInk}
        folders={[folder]}
        onRemove={() => undefined}
        onChoose={() => undefined}
        found={null}
        onAdd={() => undefined}
        findings={[
          { id: 'gh', kind: 'connected', host: { name: 'GitHub', brand: Brand.GitHub }, owners: ['AltharIDE'], account: 'balazs' },
        ]}
        {...(d === 'c'
          ? { footNote: 'What other tools left in its folders waits on its board.' }
          : {
              side: (
                <div className={s.side}>
                  <div className={s.folder}>
                    <Icon name="folder" size={16} />
                    <span className={s.folderName}>althar</span>
                    <code className={s.mono}>~/Code/althar</code>
                    <span className={s.grow} />
                    <span className={s.remote}>AltharIDE/althar</span>
                  </div>
                  <div className={s.sideHead}>
                    <h2 className={s.sideTitle}>Already under way</h2>
                    <p className={s.sideLine}>What other tools left in its folders. Nothing there changes.</p>
                  </div>
                  <Picker picks={picks} />
                </div>
              ),
              ...(go === null ? {} : { footNote: `Then ${go[0]?.toLowerCase()}${go.slice(1)}.` }),
            })}
        onCreate={() => {
          if (d !== 'c') bring(picks)
          onCreated()
        }}
        onCancel={() => undefined}
      />
    </div>
  )
}
