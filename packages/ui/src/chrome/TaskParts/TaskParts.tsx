import { type ReactNode, useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Button } from '../../primitives/Button/Button'
import { MergeButton } from '../../primitives/MergeButton/MergeButton'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import { Popover } from '../../primitives/Popover/Popover'
import s from './TaskParts.module.css'

/*
 * A task's parts (ADR-097, from the 6 November direction): its worktree,
 * its pull requests, its reviews, the issues it came from, what it runs,
 * what it made. Their own marks sit in the bar just before the faces, the
 * first four, then how many more, one that waits on the person in its
 * colour; the faces, Run and the menu never move. The marks open a popover:
 * what waits on the person first, each with its button (Merge and Post it
 * act from the row), then what runs, then the rest as chips. A part opens in
 * place, with a way back: where it stands and what to do with it. Add lists
 * what a task can take on, and a short form for the one picked.
 */

export type PartTone = 'you' | 'bad' | 'live'

export interface PartAction {
  label: string
  onClick: () => void
  onBypassQueue?: () => void
  variant?: 'signal' | 'quiet' | 'danger' | 'default'
  icon?: IconName
  /** It loses something: it says what first, with a way to keep it. */
  confirm?: { says: string; keep: string; go: string }
  /** At the row's end, apart from the others: Remove, Stop. */
  end?: boolean
  /** Its key, said on the button: ⌘D. */
  kbd?: string
}

export interface TaskPartModel {
  id: string
  icon: IconName | Brand
  /** Its name, short: Worktree, #635, DEV-188. */
  name: string
  /** Where it stands, in a few words: Open · checks pass. */
  detail: string
  /** Something about it waits on the person, or failed, or it runs. */
  tone?: PartTone | undefined
  /** What the person does from its row, where something waits: Merge, Post it. Without `onClick`, it opens the part. */
  act?: { label: string; onClick?: () => void } | undefined
  /** Where it stands, as the part says it when open. */
  facts?: ReadonlyArray<readonly [string, ReactNode]>
  /** What else it shows when open: the files it changed, the failing check's last lines, the findings. */
  body?: ReactNode
  actions?: ReadonlyArray<PartAction>
}

/** What a task can take on, and the short form for it. */
export interface PartKind {
  kind: string
  icon: IconName
  name: string
  about: string
  /** The form for it; `done` goes back to the list. Without one, it can't be added here now, and isn't offered. */
  form?: (done: () => void) => ReactNode
}

/** Pictures as a part shows them: thumbnails, four a row. */
export function PartShots({ shots }: { shots: ReadonlyArray<{ id: string; src: string; label: string }> }) {
  return (
    <div className={s.shots}>
      {shots.slice(0, 8).map((shot) => (
        <img key={shot.id} src={shot.src} alt={shot.label} loading="lazy" />
      ))}
    </div>
  )
}

/** A part's lines of text, as a changed file or a failing check's last lines show. */
export function PartLines({ lines, log = false }: { lines: ReadonlyArray<readonly [string, string]>; log?: boolean }) {
  if (log) return <pre className={s.log}>{lines.map(([line]) => line).join('\n')}</pre>
  return (
    <ul className={s.files}>
      {lines.map(([path, delta]) => (
        <li key={path}>
          <span className={delta === '' ? s.plain : s.path}>{path}</span>
          <span className={s.delta}>{delta}</span>
        </li>
      ))}
    </ul>
  )
}

export const taskPartsText = {
  label: 'This task’s parts',
  parts: 'Parts',
  add: 'Add',
  back: 'Back',
  stack: (count: number, waiting: boolean) => `Parts, ${count}${waiting ? ', something waits on you' : ''}`,
}

const isBrand = (icon: TaskPartModel['icon']): icon is Brand => (Object.values(Brand) as string[]).includes(icon)
const glyph = (part: Pick<TaskPartModel, 'icon'>, size = 13) =>
  isBrand(part.icon) ? <BrandMark brand={part.icon} size={size - 1} /> : <Icon name={part.icon} size={size} />
const waits = (part: TaskPartModel) => part.tone === 'you' || part.tone === 'bad'

/** One action of an open part; one that loses something asks first, in place. */
function Act({ action, sure, onSure }: { action: PartAction; sure: boolean; onSure: (on: boolean) => void }) {
  const variant = action.variant ?? 'default'
  if (action.onBypassQueue !== undefined)
    return (
      <MergeButton
        size="small"
        variant={variant === 'danger' ? 'default' : variant}
        onMerge={action.onClick}
        onBypassQueue={action.onBypassQueue}
      >
        {action.label}
      </MergeButton>
    )
  return (
    <Button
      size="small"
      {...(variant === 'default' ? {} : { variant })}
      {...(action.icon === undefined ? {} : { icon: action.icon })}
      {...(action.kbd === undefined ? {} : { kbd: action.kbd })}
      className={action.end === true ? s.end : undefined}
      onClick={() => (action.confirm !== undefined && !sure ? onSure(true) : action.onClick())}
    >
      {action.label}
    </Button>
  )
}

function PartView({ part }: { part: TaskPartModel }) {
  const [sure, setSure] = useState<PartAction | null>(null)
  return (
    <>
      {part.facts !== undefined && part.facts.length > 0 && <KeyValues items={part.facts} keyWidth={74} className={s.facts} />}
      {part.body}
      {sure !== null && sure.confirm !== undefined ? (
        <div className={s.sure}>
          <span>{sure.confirm.says}</span>
          <Button size="small" variant="quiet" onClick={() => setSure(null)}>
            {sure.confirm.keep}
          </Button>
          <Button
            size="small"
            variant="danger"
            onClick={() => {
              setSure(null)
              sure.onClick()
            }}
          >
            {sure.confirm.go}
          </Button>
        </div>
      ) : (
        (part.actions?.length ?? 0) > 0 && (
          <div className={s.acts}>
            {part.actions!.map((action) => (
              <Act key={action.label} action={action} sure={false} onSure={(on) => setSure(on ? action : null)} />
            ))}
          </div>
        )
      )}
    </>
  )
}

type View = { at: 'list' } | { at: 'part'; id: string } | { at: 'add' } | { at: 'form'; kind: string }

/** What the popover holds: what waits on the person, what runs, the rest as chips; each opens in place, and Add opens a form. */
export function PartsDrill({ parts, kinds }: { parts: ReadonlyArray<TaskPartModel>; kinds: ReadonlyArray<PartKind> }) {
  const t = taskPartsText
  const [view, setView] = useState<View>({ at: 'list' })
  const open = (one: TaskPartModel) => setView({ at: 'part', id: one.id })
  const back = (to: View = { at: 'list' }) => (
    <button type="button" className={s.back} aria-label={t.back} onClick={() => setView(to)}>
      <Icon name="chevronL" size={13} />
    </button>
  )
  const addable = kinds.filter((one) => one.form !== undefined)

  if (view.at === 'part') {
    const part = parts.find((one) => one.id === view.id)
    if (part !== undefined)
      return (
        <div className={s.list}>
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
            <PartView part={part} />
          </div>
        </div>
      )
  }

  if (view.at === 'add' || view.at === 'form') {
    const kind = view.at === 'form' ? addable.find((one) => one.kind === view.kind) : undefined
    return (
      <div className={s.list}>
        <div className={s.head}>
          {back(kind === undefined ? { at: 'list' } : { at: 'add' })}
          {kind !== undefined && (
            <span className={s.headGlyph}>
              <Icon name={kind.icon} size={13} />
            </span>
          )}
          <span className={s.headName}>{kind === undefined ? t.add : kind.name}</span>
        </div>
        <div className={s.body}>
          {kind === undefined ? (
            <ul className={s.pick}>
              {addable.map((one) => (
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
            kind.form?.(() => setView({ at: 'list' }))
          )}
        </div>
      </div>
    )
  }

  const now = parts.filter(waits)
  const live = parts.filter((one) => one.tone === 'live')
  const rest = parts.filter((one) => !waits(one) && one.tone !== 'live')
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <span className={s.listTitle}>{t.parts}</span>
        {addable.length > 0 && (
          <button type="button" className={s.add} onClick={() => setView({ at: 'add' })}>
            <Icon name="plus" size={12} />
            {t.add}
          </button>
        )}
      </div>
      {now.length > 0 && (
        <section className={s.waitsOn}>
          {now.map((one) => (
            <div key={one.id} className={s.waitRow} data-tone={one.tone}>
              <span className={s.itemGlyph}>{glyph(one, 14)}</span>
              <button type="button" className={s.waitOpen} onClick={() => open(one)}>
                <span className={s.itemName}>{one.name}</span>
                <span className={s.itemDetail}>{one.detail}</span>
              </button>
              {one.act !== undefined && (
                <Button
                  size="small"
                  {...(one.tone === 'you' ? { variant: 'signal' as const } : {})}
                  onClick={() => (one.act?.onClick ?? (() => open(one)))()}
                >
                  {one.act.label}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {live.length > 0 && (
        <section className={s.group}>
          <ul className={s.items}>
            {live.map((one) => (
              <li key={one.id}>
                <button type="button" className={s.item} data-tone={one.tone} onClick={() => open(one)}>
                  <span className={s.itemGlyph}>{glyph(one)}</span>
                  <span className={s.itemName}>{one.name}</span>
                  <span className={s.itemDetail}>{one.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <ul className={s.chips}>
          {rest.map((one) => (
            <li key={one.id}>
              <button type="button" className={s.chip} title={one.detail} onClick={() => open(one)}>
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

/** The parts' own marks, the first four, then how many more; one that waits on the person in its colour. */
function Stack({ parts, ...rest }: { parts: ReadonlyArray<TaskPartModel> }) {
  const shown = [...parts.filter(waits), ...parts.filter((one) => !waits(one))].slice(0, 4)
  const more = parts.length - shown.length
  return (
    <button type="button" className={s.stack} aria-label={taskPartsText.stack(parts.length, parts.some(waits))} {...rest}>
      {shown.map((one) => (
        <span key={one.id} className={s.stackGlyph} data-tone={one.tone}>
          {glyph(one, 13)}
        </span>
      ))}
      {more > 0 && <span className={s.stackMore}>{`+${more}`}</span>}
    </button>
  )
}

/** The task's parts, in the bar just before the faces. */
export function TaskParts({ parts, kinds = [] }: { parts: ReadonlyArray<TaskPartModel>; kinds?: ReadonlyArray<PartKind> }) {
  if (parts.length === 0 && kinds.every((one) => one.form === undefined)) return null
  return (
    <Popover
      label={taskPartsText.label}
      placement="below"
      align="end"
      width={380}
      padded={false}
      trigger={
        parts.length === 0 ? (
          <button type="button" className={s.stack} aria-label={taskPartsText.label}>
            <Icon name="plus" size={13} />
          </button>
        ) : (
          <Stack parts={parts} />
        )
      }
    >
      <PartsDrill parts={parts} kinds={kinds} />
    </Popover>
  )
}
