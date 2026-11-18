import { type ReactNode, useState } from 'react'

import {
  AskCard,
  AskFoot,
  Button,
  CheckState,
  Dialog,
  FieldArea,
  FileChanges,
  Icon,
  LinkButton,
  Popover,
  Segmented,
  Select,
  SettingGroup,
  SettingList,
  SettingRow,
  Switch,
} from '@althar/ui'

import { firstName, type Person, PEOPLE, personOf } from '../data'
import { lab, useLab } from '../state'
import s from './team.module.css'

/*
 * What the explorations add to the app, built from the kit: a person's
 * face, the team in the project's row (E), Maya's hand-off (B), the evidence
 * Ana approves from, at her desk and on her phone (C), who may do what (D),
 * and the guardrail Maya meets (D). Nothing here is multiplayer: every fact
 * about a teammate is one git or the code host already holds.
 */

/** A person's face: their initial in their ink. The code host's picture of them, in the app. */
export function Face({ who, size = 20, className }: { who: Person['id']; size?: number; className?: string }) {
  const one = personOf(who)
  return (
    <span
      className={[s.face, className].filter(Boolean).join(' ')}
      data-ink={one.ink}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      title={one.name}
      aria-hidden
    >
      {one.name[0]}
    </span>
  )
}

/** Where the change shows, in the running app's pixels: its four empty lanes. */
export const LANES = { x: 0, y: 92, width: 1180, height: 290 }
/** Two of them, for a phone's width. */
export const TWO_LANES = { x: 0, y: 92, width: 590, height: 290 }

/** The app as it runs, drawn small, or a part of it: on main, or with Maya's change in. A picture the lead took, live here. */
export function Shot({
  after,
  width,
  caption,
  crop = { x: 0, y: 0, width: 1180, height: 640 },
}: {
  after: boolean
  width: number
  caption?: ReactNode
  crop?: { x: number; y: number; width: number; height: number }
}) {
  const scale = width / crop.width
  const height = Math.round(crop.height * scale)
  return (
    <figure className={s.shot}>
      <div className={s.shotFrame} style={{ width, height }}>
        <iframe
          title={after ? 'With the change' : 'On main'}
          src={`/?app=1${after ? '&after=1' : ''}`}
          tabIndex={-1}
          style={{ width: 1180, height: 640, transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px) scale(${scale})` }}
        />
      </div>
      {caption !== undefined && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

/** Before and after in one place, flipped between, so what changed is what moves. Both are drawn, the other hidden, so a flip is instant. */
export function Flip({ width, crop, after: initial = true }: { width: number; crop: typeof LANES; after?: boolean }) {
  const [after, setAfter] = useState(initial)
  return (
    <div className={s.flip}>
      <Segmented
        label="Which app"
        value={after ? 'after' : 'before'}
        onChange={(value) => setAfter(value === 'after')}
        options={[
          { value: 'before', label: 'On main' },
          { value: 'after', label: 'With Maya’s change' },
        ]}
      />
      <div className={s.flipShots} style={{ width }}>
        <div hidden={after}>
          <Shot after={false} width={width} crop={crop} />
        </div>
        <div hidden={!after}>
          <Shot after width={width} crop={crop} />
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- E: the team, from git */

/** What each teammate is on, as git and the code host say it. */
const ON: Record<Person['id'], { what: string; where: string; tone?: 'you' | 'live' }> = {
  ana: { what: 'Cut a small change’s overhead, and 2 more', where: 'You' },
  maya: { what: 'Warmer words on an empty board', where: 'Asks you to approve #1031', tone: 'you' },
  lee: { what: 'Regression pass on Ship and Merge', where: 'Running, 18m', tone: 'live' },
  sam: { what: 'File a bug with a screenshot from the app', where: 'An intent, pushed 40m ago' },
}

/** The team, in the project's row: one chip of faces, opening who is on what. */
export function TeamChip() {
  const { d, m } = useLab()
  return (
    <Popover
      label="The team"
      width={340}
      align="end"
      {...(d === 'e' && m === 1 ? { defaultOpen: true } : {})}
      trigger={
        <button type="button" className={s.teamChip} aria-label="The team: Ana, Maya, Sam and Lee">
          {PEOPLE.map((one) => (
            <Face key={one.id} who={one.id} size={20} className={s.teamFace} />
          ))}
        </button>
      }
    >
      <div className={s.team}>
        <p className={s.teamHead}>althar’s team</p>
        <ul className={s.teamList}>
          {PEOPLE.map((one) => (
            <li key={one.id} className={s.teamRow}>
              <Face who={one.id} size={24} />
              <span className={s.teamWho}>
                <span className={s.teamName}>
                  {one.name}
                  <span className={s.teamRole}>{one.role}</span>
                </span>
                <span className={s.teamWhat}>{ON[one.id].what}</span>
                <span className={s.teamWhere} data-tone={ON[one.id].tone}>
                  {ON[one.id].tone === 'live' && <span className={s.dot} />}
                  {ON[one.id].where}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className={s.teamFoot}>
          <Icon name="branch" size={12} /> From althar’s branches and pull requests on GitHub
        </p>
      </div>
    </Popover>
  )
}

/** Whose a teammate's card is, at its foot. */
export function Whose({ who, says }: { who: Person['id']; says: string }) {
  return (
    <span className={s.whose}>
      <Face who={who} size={16} />
      <span>{says}</span>
    </span>
  )
}

/* ---------------------------------------------------------------- B: the hand-off */

const REVIEW = 'GPT-6.1 Sol found nothing to fix'

/** What goes to the approver, in a few facts, the same in the hand-off and in what she reads. */
function GoesWith({ small = false }: { small?: boolean }) {
  return (
    <ul className={s.goes} data-small={small || undefined}>
      <li>
        <Icon name="image" size={13} />
        <span>Before and after, as it runs</span>
      </li>
      <li>
        <Icon name="globe" size={13} />
        <span>Your copy of the app, to open and click through</span>
      </li>
      <li>
        <Icon name="check" size={13} />
        <span>6 checks passed</span>
      </li>
      <li>
        <Icon name="answer" size={13} />
        <span>{REVIEW}</span>
      </li>
    </ul>
  )
}

/** Maya's one way on: send it to the engineer who approves what merges. */
export function SendToAna() {
  const { m } = useLab()
  return (
    <Button size="small" variant="signal" icon="answer" onClick={() => lab.set({ m: 1 })}>
      Send to {m === 2 ? 'Ana again' : 'Ana'}
    </Button>
  )
}

export function HandOff() {
  const [who, setWho] = useState<'ana' | 'any'>('ana')
  const [note, setNote] = useState('For someone’s first day on an empty project. Words only.')
  return (
    <Dialog
      title="Send for approval"
      width={540}
      onClose={() => lab.set({ m: 0 })}
      onSubmit={() => lab.set({ m: 2 })}
      actions={
        <>
          <Button variant="quiet" onClick={() => lab.set({ m: 0 })}>
            Cancel
          </Button>
          <Button variant="signal" type="submit">
            Send to {who === 'ana' ? 'Ana' : 'the engineers'}
          </Button>
        </>
      }
    >
      <div className={s.handOff}>
        <div className={s.approver}>
          <Face who="ana" size={28} />
          <div className={s.approverWho}>
            <Select
              label="Who approves"
              variant="quiet"
              value={who}
              onChange={setWho}
              options={[
                { value: 'ana', label: 'Ana Ferreira' },
                { value: 'any', label: 'Any engineer on althar' },
              ]}
            />
            <span className={s.approverWhy}>
              Approves changes to the app’s screens, from <code>CODEOWNERS</code>
            </span>
          </div>
        </div>
        <div className={s.pair}>
          <Shot after={false} width={232} crop={LANES} caption="On main" />
          <Shot after width={232} crop={LANES} caption="With your change" />
        </div>
        <GoesWith />
        <div className={s.noteLabel}>
          <label htmlFor="hand-off-note">A note for Ana</label>
          <FieldArea id="hand-off-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>
    </Dialog>
  )
}

/** Over Maya's composer once it is sent: where it is, and the way to take it back. */
export function WithAna() {
  return (
    <div className={s.withAna}>
      <Face who="ana" size={22} />
      <span className={s.withAnaWords}>
        <span className={s.withAnaTitle}>With Ana to approve</span>
        <span className={s.withAnaWhen}>Sent 2m ago, as pull request #1031. Anything you change here goes to Ana too.</span>
      </span>
      <LinkButton onClick={() => lab.set({ m: 0 })}>Take it back</LinkButton>
    </div>
  )
}

/* ---------------------------------------------------------------- C: the evidence */

const CHECKS = [
  { id: 'types', name: 'Types and lint', state: CheckState.Passed },
  { id: 'ui', name: 'UI kit tests', state: CheckState.Passed },
  { id: 'desktop', name: 'Desktop tests', state: CheckState.Passed },
  { id: 'e2e', name: 'End-to-end', state: CheckState.Passed },
  { id: 'storybook', name: 'Storybook build', state: CheckState.Passed },
  { id: 'codeql', name: 'CodeQL', state: CheckState.Passed },
]

const FILES = [
  { path: 'packages/ui/src/board/Board/Board.tsx', add: 4, del: 4 },
  { path: 'apps/desktop/src/renderer/features/board/BoardView.tsx', add: 5, del: 5 },
]

/** What Ana approves from: Maya's ask, the app before and after, and the few facts that say it's safe. */
export function Evidence({ narrow = false }: { narrow?: boolean }) {
  const { m } = useLab()
  const merged = m === 2
  const [diff, setDiff] = useState(false)
  const decide = merged ? null : (
    <div className={s.decide}>
      <Button variant="default">{narrow ? 'Ask for changes' : 'Ask Maya for changes'}</Button>
      <Button variant="signal" onClick={() => lab.set({ m: 2 })}>
        Approve and merge
      </Button>
    </div>
  )
  return (
    <div className={s.evidence} data-narrow={narrow || undefined}>
      <header className={s.ask}>
        <Face who="maya" size={narrow ? 28 : 32} />
        <div className={s.askWords}>
          <p className={s.askTitle}>{merged ? 'You approved Maya’s change' : 'Maya asks you to approve'}</p>
          <p className={s.askWhen}>{merged ? 'Merged as #1031, a moment ago' : 'Warmer words on an empty board · 3m ago'}</p>
        </div>
        {!narrow && decide}
      </header>
      {merged ? (
        <p className={s.merged}>
          <Icon name="check" size={13} /> Merged. Maya’s Althar reads it on GitHub and settles the task.
        </p>
      ) : (
        <blockquote className={s.quote}>For someone’s first day on an empty project. Words only.</blockquote>
      )}

      <Flip width={narrow ? 342 : 856} crop={narrow ? TWO_LANES : LANES} />

      <dl className={s.facts}>
        <div>
          <dt>What it changes</dt>
          <dd>
            Words in the board’s four empty lanes. No behaviour, styles or tests.
            {!narrow && (
              <>
                {' '}
                <LinkButton onClick={() => setDiff((now) => !now)}>{diff ? 'Hide the code' : 'See the code'}</LinkButton>
              </>
            )}
            {diff && <FileChanges className={s.files} files={FILES} />}
          </dd>
        </div>
        <div>
          <dt>Maya’s role</dt>
          <dd>A designer changes words and styles without your sign-off on the code. Merging takes yours.</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>
            All 6 passed
            {!narrow && <span className={s.quiet}> · {CHECKS.map((one) => one.name).join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{REVIEW}</dd>
        </div>
        {!narrow && (
          <div>
            <dt>Maya’s copy</dt>
            <dd>
              Running on Maya’s computer. <LinkButton onClick={() => undefined}>Run it here</LinkButton>
            </dd>
          </div>
        )}
      </dl>
      {narrow && decide}
    </div>
  )
}

/* ---------------------------------------------------------------- D: who may do what */

type Kind = 'words' | 'tests' | 'docs' | 'behaviour' | 'deep'
const KINDS: ReadonlyArray<{ key: Kind; title: string; paths: string }> = [
  { key: 'words', title: 'Words and styles on screen', paths: 'copy and CSS in packages/ui, apps/desktop/src/renderer' },
  { key: 'docs', title: 'Docs and intents', paths: 'docs/, *.md, intent files' },
  { key: 'tests', title: 'Tests and their fixtures', paths: 'tests/, e2e/, *.test.ts' },
  { key: 'behaviour', title: 'What the app does', paths: 'everything else in the renderer and the kit' },
  { key: 'deep', title: 'The runtime, data, dependencies and CI', paths: 'packages/runtime, schema.sql, package.json, .github/' },
]
type Role = 'Designer' | 'Product' | 'QA'
const ROLES: ReadonlyArray<Role> = ['Designer', 'Product', 'QA']
const START: Record<Kind, Record<Role, boolean>> = {
  words: { Designer: true, Product: true, QA: false },
  docs: { Designer: true, Product: true, QA: true },
  tests: { Designer: false, Product: false, QA: true },
  behaviour: { Designer: false, Product: false, QA: false },
  deep: { Designer: false, Product: false, QA: false },
}

/** Who is on the team, by their role, and what each role may change before an engineer signs off on the code. */
export function People() {
  const [roles, setRoles] = useState<Record<Person['id'], Person['role']>>(
    Object.fromEntries(PEOPLE.map((one) => [one.id, one.role])) as Record<Person['id'], Person['role']>,
  )
  const [may, setMay] = useState(START)
  return (
    <div className={s.people}>
      <SettingGroup
        title="The team"
        headingLevel={3}
        note={
          <>
            Everyone who commits to althar. Their roles are kept in the repository, in <code>.althar/team.toml</code>, so a change to them
            is a pull request like any other.
          </>
        }
      >
        <SettingList>
          {PEOPLE.map((one) => (
            <SettingRow
              key={one.id}
              title={one.name}
              note={<code className={s.login}>@{one.login}</code>}
              glyph={<Face who={one.id} size={24} />}
            >
              {({ labelledBy }) => (
                <Select
                  label={`${firstName(one.id)}’s role`}
                  id={labelledBy}
                  variant="quiet"
                  width={130}
                  value={roles[one.id]}
                  onChange={(role) => setRoles({ ...roles, [one.id]: role })}
                  options={(['Engineer', 'Designer', 'Product', 'QA'] as const).map((role) => ({ value: role, label: role }))}
                />
              )}
            </SettingRow>
          ))}
        </SettingList>
      </SettingGroup>

      <SettingGroup
        title="What each may change on their own"
        headingLevel={3}
        note="Their agent makes it, they see it running and send it on. Past this, the lead stops and asks an engineer to sign off first."
      >
        <table className={s.matrix}>
          <thead>
            <tr>
              <th scope="col">
                <span className={s.hidden}>Change</span>
              </th>
              {ROLES.map((role) => (
                <th key={role} scope="col">
                  {role}
                </th>
              ))}
              <th scope="col">Engineer</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((kind) => (
              <tr key={kind.key}>
                <th scope="row" className={s.matrixHead}>
                  {kind.title}
                  <span className={s.matrixPaths}>{kind.paths}</span>
                </th>
                {ROLES.map((role) => (
                  <td key={role}>
                    <Switch
                      label={`${role}: ${kind.title}`}
                      checked={may[kind.key][role]}
                      onChange={(on) => setMay({ ...may, [kind.key]: { ...may[kind.key], [role]: on } })}
                    />
                  </td>
                ))}
                <td>
                  <Icon name="check" size={14} className={s.always} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingGroup>

      <SettingGroup title="What always takes an engineer" headingLevel={3}>
        <SettingList>
          <SettingRow
            title="Merging into main"
            note="GitHub holds this one, by main’s branch rule: one approval from CODEOWNERS. Althar only says who to ask."
            glyph={<Icon name="lock" size={14} />}
          >
            {() => <span className={s.held}>On GitHub</span>}
          </SettingRow>
          <SettingRow
            title="Secrets, releases and the project’s settings"
            note="Only engineers see these in Althar."
            glyph={<Icon name="lock" size={14} />}
          >
            {() => <span className={s.held}>Engineers</span>}
          </SettingRow>
        </SettingList>
      </SettingGroup>
    </div>
  )
}

/* ---------------------------------------------------------------- D: the guardrail Maya meets */

/** Over Maya's composer, where what she asked goes past what her role changes on its own. */
export function Guardrail({ composer }: { composer: ReactNode }) {
  const [answered, setAnswered] = useState<null | 'words' | 'ask'>(null)
  if (answered !== null)
    return (
      <>
        <div className={s.withAna}>
          {answered === 'ask' ? <Face who="ana" size={22} /> : <Icon name="check" size={14} />}
          <span className={s.withAnaWords}>
            <span className={s.withAnaTitle}>{answered === 'ask' ? 'Asked Ana to sign off' : 'Kept to the words'}</span>
            <span className={s.withAnaWhen}>
              {answered === 'ask'
                ? 'The lead goes on once Ana says yes. The new words are in meanwhile.'
                : 'The lanes fold as they do now. The new words are in.'}
            </span>
          </span>
          <LinkButton onClick={() => setAnswered(null)}>Undo</LinkButton>
        </div>
        {composer}
      </>
    )
  return (
    <>
      <AskCard
        className={s.guard}
        icon="lock"
        kicker="Past words and styles"
        who={
          <span className={s.guardWho}>
            <Face who="ana" size={16} /> Ana signs off
          </span>
        }
        what="Keeping lanes open in a narrow window changes how the board lays itself out. That’s the app’s behaviour, which an engineer signs off on before your lead changes it."
      >
        <AskFoot>
          <Button size="small" variant="quiet" onClick={() => setAnswered('words')}>
            Keep it to the words
          </Button>
          <Button size="small" variant="signal" onClick={() => setAnswered('ask')}>
            Ask Ana to sign off
          </Button>
        </AskFoot>
      </AskCard>
      {composer}
    </>
  )
}
