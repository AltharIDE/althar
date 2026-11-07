// Scrappy, surface 5, C: what the Parts popover does when a part is clicked or one is added. A part opens in place, with a way back: where it stands and what the person can do with it. Add opens what a task can take on, then a short form for the one picked; what's added shows at once, setting up.
import { type ReactNode, useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Field } from '../../../../src/primitives/Field/Field'
import { KeyValues } from '../../../../src/primitives/KeyValues/KeyValues'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { glyph, type Part } from './Parts'
import p from './parts.module.css'
import s from './drill.module.css'

type Kind = 'worktree' | 'pr' | 'review' | 'issue' | 'browser' | 'access'
type View = { at: 'list' } | { at: 'part'; id: string } | { at: 'add' } | { at: 'form'; kind: Kind }

const KINDS: ReadonlyArray<{ kind: Kind; icon: IconName; name: string; about: string }> = [
  { kind: 'worktree', icon: 'folder', name: 'A worktree', about: 'A checkout of its own, to change code in' },
  { kind: 'pr', icon: 'pr', name: 'A pull request', about: 'Opened from its branch, or one that exists' },
  { kind: 'review', icon: 'answer', name: 'A review', about: 'Of any pull request, by another model' },
  { kind: 'issue', icon: 'list', name: 'An issue', about: 'From Linear or GitHub, for its lead to read' },
  { kind: 'browser', icon: 'globe', name: 'A browser', about: 'A page its lead can see and click' },
  { kind: 'access', icon: 'lock', name: 'Access', about: 'Something that asks, given for this task' },
]

const waits = (part: Part) => part.tone === 'you' || part.tone === 'bad'

/** A part's own view: where it stands, and what the person can do with it. */
function PartView({ part, change, drop }: { part: Part; change: (next: Partial<Part>) => void; drop: () => void }) {
  const [sure, setSure] = useState(false)
  const facts = (items: ReadonlyArray<readonly [string, ReactNode]>) => <KeyValues items={items} keyWidth={74} className={s.facts} />
  const acts = (...buttons: ReactNode[]) => <div className={s.acts}>{buttons}</div>
  switch (part.id) {
    case 'wt':
      return (
        <>
          {facts([
            ['Branch', <code key="b">althar/runs-pill</code>],
            ['From', 'main, 2 days ago'],
            ['Where', <code key="w">~/Charrette/althar/runs-pill</code>],
          ])}
          <ul className={s.files}>
            {[
              ['packages/ui/src/chrome/RunPill/RunPill.tsx', '+48 −12'],
              ['packages/ui/src/chrome/RunPill/RunPill.module.css', '+20 −3'],
              ['apps/desktop/src/renderer/features/run/runs.ts', '+31 −9'],
              ['3 more', ''],
            ].map(([path, delta]) => (
              <li key={path}>
                <span className={s.path}>{path}</span>
                <span className={s.delta}>{delta}</span>
              </li>
            ))}
          </ul>
          {sure ? (
            <div className={s.sure}>
              <span>2 files aren’t committed. They’d be lost.</span>
              <Button size="small" variant="quiet" onClick={() => setSure(false)}>
                Keep it
              </Button>
              <Button size="small" variant="danger" onClick={drop}>
                Remove
              </Button>
            </div>
          ) : (
            acts(
              <Button key="see" size="small">
                See the changes
              </Button>,
              <Button key="ed" size="small" variant="quiet" icon="external">
                Open in editor
              </Button>,
              <Button key="rm" size="small" variant="quiet" className={s.end} onClick={() => setSure(true)}>
                Remove
              </Button>,
            )
          )}
        </>
      )
    case 'pr':
      return (
        <>
          {facts([
            ['Title', 'Runs stay in the pill until they end'],
            ['Checks', part.detail.startsWith('Merged') ? 'Passed' : '12 pass'],
            ['Review', 'GPT-6.1 Sol, nothing found'],
            ['Into', <code key="i">main</code>],
          ])}
          {part.detail.startsWith('Merged') ? (
            <p className={s.done}>
              <Icon name="check" size={12} /> Merged into main at 14:20. The branch is deleted.
            </p>
          ) : (
            acts(
              <Button key="m" size="small" variant="signal" onClick={() => change({ detail: 'Merged', tone: undefined, act: undefined })}>
                Merge
              </Button>,
              <Button key="gh" size="small" variant="quiet" icon="external">
                On GitHub
              </Button>,
            )
          )}
        </>
      )
    case 'pr2':
      return (
        <>
          {facts([
            ['Title', 'Show a run’s address in the pill'],
            ['Checks', '11 pass, 1 fails'],
          ])}
          <div className={s.check}>
            <span className={s.checkName}>
              <Icon name="close" size={11} /> e2e · macOS
            </span>
            <pre className={s.log}>
              {`✗ run-pill.spec.ts:41 shows the address
  Expected "localhost:5367"
  Received "Running"`}
            </pre>
          </div>
          {part.tone === 'live' ? (
            <p className={s.done}>The lead is on it.</p>
          ) : (
            acts(
              <Button
                key="f"
                size="small"
                onClick={() => change({ detail: 'Draft · the lead is fixing a check', tone: 'live', act: undefined })}
              >
                Ask the lead to fix it
              </Button>,
              <Button key="r" size="small" variant="quiet">
                Run it again
              </Button>,
            )
          )}
        </>
      )
    case 'draft':
      return (
        <>
          <ol className={s.findings}>
            <li>The pill hides its address under 900 px wide.</li>
            <li>A run that ends leaves its dot for a second.</li>
            <li>Stop doesn’t ask, but a run with unsaved output loses it.</li>
          </ol>
          {part.tone === 'you' ? (
            acts(
              <Button
                key="p"
                size="small"
                variant="signal"
                onClick={() => change({ detail: 'Posted on #641', tone: undefined, act: undefined })}
              >
                Post it on #641
              </Button>,
              <Button key="e" size="small" variant="quiet">
                Change it first
              </Button>,
            )
          ) : (
            <p className={s.done}>
              <Icon name="check" size={12} /> Posted on #641 as you, at 14:22.
            </p>
          )}
        </>
      )
    case 'rv':
      return (
        <>
          {facts([
            ['By', 'GPT-6.1 Sol, medium'],
            ['Read', '#635 at 9c1e2f0, the latest'],
            ['Found', 'Nothing'],
          ])}
          {acts(
            <Button key="r" size="small">
              Read it
            </Button>,
            <Button key="a" size="small" variant="quiet">
              Review again
            </Button>,
          )}
        </>
      )
    case 'web':
    case 'sb':
    case 'new-web':
      return (
        <>
          {facts([
            ['Address', <code key="a">{part.id === 'sb' ? 'localhost:6126' : part.name}</code>],
            ['Started', part.id === 'new-web' ? 'Just now' : 'By the lead, 40 min ago'],
          ])}
          {acts(
            <Button key="o" size="small" icon="external">
              Open
            </Button>,
            <Button key="s" size="small" variant="quiet" className={s.end} onClick={drop}>
              Stop
            </Button>,
          )}
        </>
      )
    case 'shots':
      return (
        <>
          <div className={s.thumbs}>
            {['Light', 'Dark', 'Light, narrow', 'Dark, narrow'].map((one) => (
              <span key={one} className={s.thumb} data-dark={one.startsWith('Dark') || undefined}>
                <span className={s.thumbPill} />
                <span className={s.thumbName}>{one}</span>
              </span>
            ))}
          </div>
          {acts(
            <Button key="o" size="small">
              See them in Outputs
            </Button>,
          )}
        </>
      )
    case 'net':
      return (
        <>
          {facts([
            ['Given', 'By you, 5 Nov'],
            ['For', 'This task only'],
          ])}
          {acts(
            <Button key="t" size="small" variant="quiet" onClick={drop}>
              Take it back
            </Button>,
          )}
        </>
      )
    default:
      if (part.group === 'issues')
        return (
          <>
            {facts([
              ['Title', part.detail],
              ['Status', 'In Progress'],
              ['Linked', 'To #635, which closes it'],
            ])}
            {acts(
              <Button key="o" size="small" variant="quiet" icon="external">
                In Linear
              </Button>,
              <Button key="d" size="small" variant="quiet" className={s.end} onClick={drop}>
                Take off this task
              </Button>,
            )}
          </>
        )
      return facts([['Now', part.detail]])
  }
}

/** The short form for what's added. Each adds its part at once, setting up. */
function AddForm({ kind, add }: { kind: Kind; add: (part: Part) => void }) {
  const [branch, setBranch] = useState('althar/runs-pill-narrow')
  const [from, setFrom] = useState<'main' | 'task'>('task')
  const [prWay, setPrWay] = useState<'open' | 'attach'>('open')
  const [reviewer, setReviewer] = useState<'sol' | 'terra' | 'flash'>('sol')
  const [which, setWhich] = useState('#639')
  const [address, setAddress] = useState('localhost:5367/settings')
  const go = (label: string, part: Part) => (
    <div className={s.acts}>
      <Button size="small" variant="signal" onClick={() => add(part)}>
        {label}
      </Button>
    </div>
  )
  switch (kind) {
    case 'worktree':
      return (
        <div className={s.form}>
          <div className={s.row}>
            <span className={s.key}>Branch</span>
            <Field aria-label="Branch" value={branch} onChange={(event) => setBranch(event.target.value)} />
          </div>
          <div className={s.row}>
            <span className={s.key}>From</span>
            <Segmented<'main' | 'task'>
              label="From"
              value={from}
              onChange={setFrom}
              options={[
                { value: 'task', label: 'althar/runs-pill' },
                { value: 'main', label: 'main' },
              ]}
            />
          </div>
          {go('Add', { id: 'new-wt', group: 'code', icon: 'folder', name: 'Worktree 2', detail: `Setting up ${branch}`, tone: 'live' })}
        </div>
      )
    case 'pr':
      return (
        <div className={s.form}>
          <Segmented<'open' | 'attach'>
            label="How"
            value={prWay}
            onChange={setPrWay}
            options={[
              { value: 'open', label: 'Open one' },
              { value: 'attach', label: 'One that exists' },
            ]}
          />
          {prWay === 'open' ? (
            <p className={s.note}>
              From <code>althar/runs-pill</code> into <code>main</code>, as a draft. The lead writes its description.
            </p>
          ) : (
            <Field aria-label="Pull request" placeholder="#642, or its link" />
          )}
          {go(prWay === 'open' ? 'Open it' : 'Add', {
            id: 'new-pr',
            group: 'code',
            icon: 'pr',
            name: prWay === 'open' ? 'New pull request' : '#642',
            detail: prWay === 'open' ? 'Opening, as a draft' : 'Open · checks running',
            tone: 'live',
          })}
        </div>
      )
    case 'review':
      return (
        <div className={s.form}>
          <span className={s.key}>Of</span>
          <ul className={s.pick}>
            {[
              ['#639', 'Show a run’s address in the pill', 'This task’s'],
              ['#635', 'Runs stay in the pill until they end', 'This task’s'],
              ['#641', 'Pill: keyboard focus ring', 'ninemate’s'],
            ].map(([num, title, whose]) => (
              <li key={num}>
                <button type="button" className={s.pickRow} aria-pressed={which === num} onClick={() => setWhich(num!)}>
                  <Icon name="pr" size={12} />
                  <span className={s.pickName}>{num}</span>
                  <span className={s.pickAbout}>{title}</span>
                  <span className={s.pickWhose}>{whose}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className={s.row}>
            <span className={s.key}>By</span>
            <Segmented<'sol' | 'terra' | 'flash'>
              label="Reviewer"
              value={reviewer}
              onChange={setReviewer}
              options={[
                { value: 'sol', label: 'GPT-6.1 Sol' },
                { value: 'terra', label: 'Terra' },
                { value: 'flash', label: 'DeepSeek Flash' },
              ]}
            />
          </div>
          {which === '#641' && <p className={s.note}>ninemate isn’t a member, so it reads the code without running it.</p>}
          {go('Start', {
            id: 'new-rv',
            group: 'review',
            icon: 'answer',
            name: `Review of ${which}`,
            detail: `${reviewer === 'sol' ? 'GPT-6.1 Sol' : reviewer === 'terra' ? 'GPT-6.1 Terra' : 'DeepSeek V4.1 Flash'} · reading`,
            tone: 'live',
          })}
        </div>
      )
    case 'issue':
      return (
        <div className={s.form}>
          <Field aria-label="Find an issue" placeholder="Find an issue" />
          <ul className={s.pick}>
            {[
              ['DEV-197', 'Pill flickers when two runs end together'],
              ['DEV-203', 'Run list loses its scroll on refresh'],
              ['DEV-211', 'Stop a run from the keyboard'],
            ].map(([id, title]) => (
              <li key={id}>
                <button
                  type="button"
                  className={s.pickRow}
                  onClick={() => add({ id: `new-${id}`, group: 'issues', icon: Brand.Linear, name: id!, detail: title! })}
                >
                  <BrandMark brand={Brand.Linear} size={11} />
                  <span className={s.pickName}>{id}</span>
                  <span className={s.pickAbout}>{title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'browser':
      return (
        <div className={s.form}>
          <Field value={address} onChange={(event) => setAddress(event.target.value)} />
          <p className={s.note}>The lead sees it and can click in it. You see it in the task’s browser.</p>
          {go('Open', { id: 'new-web', group: 'running', icon: 'globe', name: address, detail: 'In the browser', tone: 'live' })}
        </div>
      )
    case 'access':
      return (
        <div className={s.form}>
          <p className={s.note}>What asks, given to this task’s lead so it doesn’t.</p>
          <ul className={s.pick}>
            {[
              ['Merging', 'Its pull requests, once checks pass'],
              ['Posting', 'On GitHub and Linear, as you'],
              ['History', 'Force-pushing its own branch'],
              ['Secrets', 'Reading .env.local'],
            ].map(([name, about]) => (
              <li key={name}>
                <button
                  type="button"
                  className={s.pickRow}
                  onClick={() => add({ id: `new-${name}`, group: 'access', icon: 'lock', name: name!, detail: 'Given for this task' })}
                >
                  <Icon name="lock" size={12} />
                  <span className={s.pickName}>{name}</span>
                  <span className={s.pickAbout}>{about}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )
  }
}

/** C's popover: what waits on you, what runs, the rest as chips; each opens in place, and Add opens a form. */
export function PartsDrill({ parts: first }: { parts: ReadonlyArray<Part> }) {
  const [parts, setParts] = useState(first)
  const [view, setView] = useState<View>({ at: 'list' })
  const open = (one: Part) => setView({ at: 'part', id: one.id })
  /** What waits, done from its row: Merge and Post it at once; a failed check opens. */
  const act = (one: Part) => {
    const done: Readonly<Record<string, Partial<Part>>> = { pr: { detail: 'Merged' }, draft: { detail: 'Posted on #641' } }
    const next = done[one.id]
    if (next === undefined) return open(one)
    setParts((now) => now.map((it) => (it.id === one.id ? { ...it, ...next, tone: undefined, act: undefined } : it)))
  }
  const back = (to: View = { at: 'list' }) => (
    <button type="button" className={s.back} aria-label="Back" onClick={() => setView(to)}>
      <Icon name="chevronL" size={13} />
    </button>
  )

  if (view.at === 'part') {
    const part = parts.find((one) => one.id === view.id)
    if (part === undefined) return null
    return (
      <div className={p.list}>
        <div className={s.head}>
          {back()}
          <span className={s.headGlyph} data-tone={part.tone}>
            {glyph(part, 14)}
          </span>
          <span className={s.headName}>{part.name}</span>
          <span className={s.headDetail} data-tone={part.tone}>
            {part.detail}
          </span>
        </div>
        <div className={s.body}>
          <PartView
            part={part}
            change={(next) => setParts((now) => now.map((one) => (one.id === part.id ? { ...one, ...next } : one)))}
            drop={() => {
              setParts((now) => now.filter((one) => one.id !== part.id))
              setView({ at: 'list' })
            }}
          />
        </div>
      </div>
    )
  }

  if (view.at === 'add' || view.at === 'form') {
    const kind = view.at === 'form' ? KINDS.find((one) => one.kind === view.kind)! : null
    return (
      <div className={p.list}>
        <div className={s.head}>
          {back(kind === null ? { at: 'list' } : { at: 'add' })}
          {kind !== null && (
            <span className={s.headGlyph}>
              <Icon name={kind.icon} size={13} />
            </span>
          )}
          <span className={s.headName}>{kind === null ? 'Add' : kind.name}</span>
        </div>
        <div className={s.body}>
          {kind === null ? (
            <ul className={s.pick}>
              {KINDS.map((one) => (
                <li key={one.kind}>
                  <button type="button" className={s.pickRow} onClick={() => setView({ at: 'form', kind: one.kind })}>
                    <Icon name={one.icon} size={13} />
                    <span className={s.pickName}>{one.name}</span>
                    <span className={s.pickAbout}>{one.about}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <AddForm
              kind={kind.kind}
              add={(part) => {
                setParts((now) => [...now.filter((one) => one.id !== part.id), part])
                setView({ at: 'list' })
              }}
            />
          )}
        </div>
      </div>
    )
  }

  const now = parts.filter(waits)
  const live = parts.filter((one) => one.tone === 'live')
  const rest = parts.filter((one) => !waits(one) && one.tone !== 'live')
  return (
    <div className={p.list}>
      <div className={p.listHead}>
        <span className={p.listTitle}>Parts</span>
        <button type="button" className={p.add} onClick={() => setView({ at: 'add' })}>
          <Icon name="plus" size={12} />
          Add
        </button>
      </div>
      {now.length > 0 && (
        <section className={p.waitsOn}>
          {now.map((one) => (
            <div key={one.id} className={p.waitRow} data-tone={one.tone}>
              <span className={p.itemGlyph}>{glyph(one, 14)}</span>
              <button type="button" className={s.waitOpen} onClick={() => open(one)}>
                <span className={p.itemName}>{one.name}</span>
                <span className={p.itemDetail}>{one.detail}</span>
              </button>
              {one.act !== undefined && (
                <Button size="small" variant={one.tone === 'you' ? 'signal' : 'default'} onClick={() => act(one)}>
                  {one.act}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {live.length > 0 && (
        <section className={p.group}>
          <ul className={p.items}>
            {live.map((one) => (
              <li key={one.id}>
                <button type="button" className={p.item} data-tone={one.tone} onClick={() => open(one)}>
                  <span className={p.itemGlyph}>{glyph(one)}</span>
                  <span className={p.itemName}>{one.name}</span>
                  <span className={p.itemDetail}>{one.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <ul className={p.chips}>
          {rest.map((one) => (
            <li key={one.id}>
              <button type="button" className={p.chip} title={one.detail} onClick={() => open(one)}>
                {glyph(one, 12)}
                <span>{one.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
