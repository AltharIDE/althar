// Scrappy, surface 6: settings the coordinator or a lead changed with Althar's own tools: in the coordinator's thread, a line each, with Undo; a change that loosens what asks waits on the person; and in Settings, the changed row says who and when.
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../../../src/primitives/Ask/Ask'
import { Button } from '../../../../src/primitives/Button/Button'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { proto, useProto } from '../../state'
import s from './tune.module.css'

/** What an agent changed, by the settings row it shows on. */
export interface Change {
  readonly id: string
  /** The row's title, as Settings has it. */
  readonly row: string
  readonly from: string
  readonly to: string
  readonly by: string
  readonly ago: string
  /** Where it was changed from: a task's thread, or the coordinator's. */
  readonly where: string
}

export const CHANGES: ReadonlyArray<Change> = [
  {
    id: 'worksIn',
    row: 'New tasks start in',
    from: 'Local',
    to: 'Worktree',
    by: 'the coordinator',
    ago: '8 min ago',
    where: '#/projects/p1?room=talk',
  },
  {
    id: 'workToward',
    row: 'Work toward',
    from: 'main',
    to: 'next',
    by: 'the coordinator',
    ago: '8 min ago',
    where: '#/projects/p1?room=talk',
  },
  {
    id: 'resolveConflicts',
    row: 'Resolve merge conflicts automatically',
    from: 'Off',
    to: 'On',
    by: 'the lead of “Codex leads reach the network in their shell”',
    ago: '1 h ago',
    where: '#/threads/th-codex-net',
  },
]

/** In the coordinator's thread, what it changed in that turn. */
const MINE = CHANGES.filter((one) => one.by === 'the coordinator')

export const tuneText = {
  undo: 'Undo',
  redo: 'Redo',
  undone: 'Undone',
  settings: 'Settings',
  changed: (by: string, ago: string) => `Changed by ${by}, ${ago}`,
  loosen: {
    kicker: 'Loosens what asks',
    what: 'Let leads merge their own pull requests once checks pass and the review is clean?',
    now: 'Each merge asks you now.',
    keep: 'Keep asking',
    allow: 'Let them merge',
    allowed: 'Leads merge their own once checks pass and the review is clean.',
    kept: 'Merges keep asking.',
  },
  /** Rules, once it's allowed: the kind's catch it took off. */
  rulesNote: 'A merge with checks passed and a clean review goes ahead.',
}

const undone = (p: ReturnType<typeof useProto>, id: string) => p.off.includes(`undo:${id}`)
const undo = (id: string) => proto.toggle(`undo:${id}`)

const FromTo = ({ change, gone }: { change: Change; gone: boolean }) => (
  <span className={gone ? s.gone : s.what}>
    <strong>{change.row}</strong>
    <span className={s.from}>{change.from}</span>
    <Icon name="arrow" size={11} />
    <span>{change.to}</span>
  </span>
)

/** A line each, in the thread's flow, each with Undo. */
export function SettingsChanges() {
  const p = useProto()
  const rows = MINE.map((change) => {
    const gone = undone(p, change.id)
    return (
      <li key={change.id} className={s.line}>
        <Icon name="gear" size={13} />
        <FromTo change={change} gone={gone} />
        {gone && <span className={s.undoneWord}>{tuneText.undone}</span>}
        <LinkButton className={s.undo} onClick={() => undo(change.id)}>
          {gone ? tuneText.redo : tuneText.undo}
        </LinkButton>
      </li>
    )
  })
  return <ul className={s.lines}>{rows}</ul>
}

/** A change that loosens what asks: the coordinator proposes it, and it waits on the person. */
export function Loosen() {
  const p = useProto()
  const t = tuneText.loosen
  const said = p.answered['loosen-merge']
  if (said !== undefined)
    return (
      <AskAnswered
        denied={said === 'refused'}
        said={said === 'allowed' ? t.allowed : t.kept}
        onUndo={() => proto.set({ answered: Object.fromEntries(Object.entries(p.answered).filter(([id]) => id !== 'loosen-merge')) })}
        className={s.answered}
      >
        <AskNote>{''}</AskNote>
      </AskAnswered>
    )
  return (
    <AskCard icon="lock" kicker={t.kicker} what={t.what} className={s.ask}>
      <p className={s.now}>{t.now}</p>
      <AskFoot>
        <Button variant="quiet" onClick={() => proto.answer('loosen-merge', 'refused')}>
          {t.keep}
        </Button>
        <Button variant="signal" onClick={() => proto.answer('loosen-merge', 'allowed')}>
          {t.allow}
        </Button>
      </AskFoot>
    </AskCard>
  )
}

/** Under a settings row an agent changed: who, when, and Undo; who opens where it was changed. */
export function ChangedNote({ change }: { change: Change }) {
  const p = useProto()
  if (undone(p, change.id)) return null
  return <Changed by={change.by} ago={change.ago} where={change.where} onUndo={() => undo(change.id)} />
}

export function Changed({ by, ago, where, onUndo }: { by: string; ago: string; where: string; onUndo: () => void }) {
  return (
    <span className={s.changed}>
      <a className={s.by} href={where}>
        {tuneText.changed(by, ago)}
      </a>
      <span aria-hidden>·</span>
      <LinkButton className={s.undo} onClick={onUndo}>
        {tuneText.undo}
      </LinkButton>
    </span>
  )
}

/** Rules, once the person let leads merge: the kind's row says what goes ahead now, and who changed it. */
export function RulesChanged() {
  const p = useProto()
  if (p.surface !== 'tune' || p.answered['loosen-merge'] !== 'allowed') return null
  return (
    <span className={s.rulesNote}>
      <span>{tuneText.rulesNote}</span>
      <Changed
        by="the coordinator, on your word"
        ago="just now"
        where="#/projects/p1?room=talk"
        onUndo={() => proto.set({ answered: Object.fromEntries(Object.entries(p.answered).filter(([id]) => id !== 'loosen-merge')) })}
      />
    </span>
  )
}

/** The row an agent changed, by its title, where one did. */
export const changeOf = (row: unknown) => (typeof row === 'string' ? CHANGES.find((one) => one.row === row) : undefined)
