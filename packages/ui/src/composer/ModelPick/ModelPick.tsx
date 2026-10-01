import { RadioGroup } from 'radix-ui'
import { useEffect, useRef } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { Segmented } from '../../primitives/Segmented/Segmented'
import s from './ModelPick.module.css'

export interface ModelPickText {
  /** The popover's name. */
  label: (owner: string) => string
  /** The button's name: whose pick it is, then what it shows. */
  current: (owner: string, model: string, effort: string | null) => string
  pinned: string
  notPinned: string
  effort: string
  /** The effort in use is the model's default. */
  isDefault: (model: string) => string
  /** The effort in use is not the default, which is this. */
  otherDefault: (level: string) => string
  makeDefault: string
  all: string
  /** The row that takes this model off what it was picked for. */
  remove: string
  /** Going ahead with a pick that asked first, and not. */
  proceed: string
  cancel: string
}

export const modelPickText: ModelPickText = {
  label: (owner) => `${owner} model and effort`,
  current: (owner, model, effort) => `${owner}: ${model}${effort ? ` ${effort}` : ''}`,
  pinned: 'Pinned models',
  notPinned: 'not pinned',
  effort: 'Effort',
  isDefault: (model) => `${model} default`,
  otherDefault: (level) => `default ${level}`,
  makeDefault: 'Make this default',
  all: 'All models',
  remove: 'Remove from this step',
  proceed: 'Switch',
  cancel: 'Cancel',
}

export interface ModelPickProps {
  /** The model in use. */
  model: ModelInfo
  /** Your short list. The model in use shows first when it is not on it. */
  pinned: readonly ModelInfo[]
  /** The effort in use, if the model has any. */
  effort: string | null
  /** The model's default effort, to say when this conversation has moved away from it. */
  defaultEffort: string | null
  onChange: (id: string) => void
  onEffort: (level: string) => void
  /** Make the effort in use the model's default. Without it, there is no link. */
  onMakeDefault?: (level: string) => void
  /** Open every model, in a browser the consumer shows. Without it, there is no such row. */
  onBrowse?: () => void
  /** Take this model off what it was picked for, like one of a step's two reviewers. Without it, there is no such row. */
  onRemove?: () => void
  /** How many models there are in all, on the browse row. */
  count?: number
  /** Whose model this is: Lead, Coordinator, Review. */
  owner: string
  /** quiet: in a composer's toolbar. field: bordered, in a row of a form, like a plan's steps. */
  variant?: 'quiet' | 'field'
  /** Where the list opens: above in a composer, below in a plan. */
  placement?: 'above' | 'below'
  /** A word beside a model in the list, such as that picking it hands the conversation to another agent. */
  note?: (model: ModelInfo) => string | undefined
  /** What picking a model would do that needs a yes first, in a sentence. Picking such a model asks, in the list, before `onChange`. */
  confirm?: (model: ModelInfo) => string | undefined
  /** The model waiting on that yes: one picked here, or elsewhere, like the consumer's browser. */
  asking?: ModelInfo | null
  defaultAsking?: ModelInfo | null
  onAskingChange?: (model: ModelInfo | null) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<ModelPickText>
}

/**
 * Which model sits behind a conversation, and how hard it thinks. The short
 * list is your pins; everything else is one step away, in whatever the
 * consumer opens for `onBrowse`.
 */
export function ModelPick({
  model,
  pinned,
  effort,
  defaultEffort,
  onChange,
  onEffort,
  onMakeDefault,
  onBrowse,
  onRemove,
  count,
  owner,
  variant = 'quiet',
  placement = 'above',
  note,
  confirm,
  asking: askingProp,
  defaultAsking = null,
  onAskingChange,
  open,
  defaultOpen = false,
  onOpenChange,
  text,
}: ModelPickProps) {
  const t = { ...modelPickText, ...text }
  const [isOpen, setOpenState] = useControlled(open, defaultOpen, onOpenChange)
  const [asking, setAsking] = useControlled(askingProp, defaultAsking, onAskingChange)
  const question = asking === null ? undefined : confirm?.(asking)
  const proceed = useRef<HTMLButtonElement>(null)
  /* the question takes focus as it appears, so a keyboard answers it at once */
  useEffect(() => {
    if (isOpen && question !== undefined) proceed.current?.focus()
  }, [isOpen, question])
  /* closing the list puts the question away unanswered */
  const setOpen = (next: boolean) => {
    if (!next && asking !== null) setAsking(null)
    setOpenState(next)
  }
  const pick = (x: ModelInfo) => {
    if (confirm?.(x) === undefined) onChange(x.id)
    else setAsking(x)
  }
  const isPinned = (x: ModelInfo) => pinned.some((p) => p.id === x.id)
  const list = isPinned(model) ? pinned : [model, ...pinned]
  /* A model with no effort levels gets no control, whatever effort says. */
  const level = model.efforts.length > 0 ? effort : null

  return (
    <Popover
      label={t.label(owner)}
      placement={placement}
      width={272}
      padded={false}
      open={isOpen}
      onOpenChange={setOpen}
      className={s.pop}
      trigger={
        <button type="button" className={cx(s.button, s[variant])} aria-label={t.current(owner, model.short, level)}>
          <Model model={model} short />
          {level !== null && <span className={s.effort}>{level}</span>}
          <Icon name="chevronD" size={10} className={s.chev} />
        </button>
      }
    >
      <div className={s.head}>{owner}</div>
      {/* one of them is in use: a radio group, so arrows move between them and a screen reader hears which is checked */}
      <RadioGroup.Root
        className={s.list}
        aria-label={t.pinned}
        value={model.id}
        onValueChange={(id) => {
          const x = list.find((candidate) => candidate.id === id)
          if (x !== undefined && id !== model.id) pick(x)
        }}
        loop
      >
        {list.map((x) => {
          const said = note?.(x)
          return (
            <RadioGroup.Item key={x.id} value={x.id} className={cx(s.option, x.id === model.id && s.current)}>
              <Model model={x} />
              {!isPinned(x) && <span className={s.unpinned}>{t.notPinned}</span>}
              {said !== undefined && <span className={s.note}>{said}</span>}
              <Icon name="check" size={11} className={s.check} />
            </RadioGroup.Item>
          )
        })}
      </RadioGroup.Root>

      {asking !== null && question !== undefined && (
        <div className={s.ask} role="group" aria-label={question}>
          <p className={s.question}>{question}</p>
          <div className={s.answers}>
            <Button
              ref={proceed}
              size="small"
              variant="signal"
              onClick={() => {
                setAsking(null)
                onChange(asking.id)
              }}
            >
              {t.proceed}
            </Button>
            <Button size="small" variant="quiet" onClick={() => setAsking(null)}>
              {t.cancel}
            </Button>
          </div>
        </div>
      )}

      {level !== null && (
        <div className={s.section}>
          <div className={s.sectionTop}>
            <span className={s.sectionKey} aria-hidden="true">
              {t.effort}
            </span>
            {level === defaultEffort ? (
              <span className={s.sectionNote}>{t.isDefault(model.short)}</span>
            ) : (
              <span className={s.sectionNote}>
                {defaultEffort && t.otherDefault(defaultEffort)}
                {onMakeDefault && (
                  <>
                    {defaultEffort && ' · '}
                    <LinkButton onClick={() => onMakeDefault(level)}>{t.makeDefault}</LinkButton>
                  </>
                )}
              </span>
            )}
          </div>
          <Segmented label={t.effort} options={model.efforts.map((l) => ({ value: l, label: l }))} value={level} onChange={onEffort} />
        </div>
      )}

      {onBrowse && (
        <button
          type="button"
          className={s.all}
          onClick={() => {
            setOpen(false)
            onBrowse()
          }}
        >
          {t.all}
          {count !== undefined && <span className={s.count}>{count}</span>}
          <Icon name="chevron" size={10} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          className={cx(s.all, s.remove)}
          onClick={() => {
            setOpen(false)
            onRemove()
          }}
        >
          {t.remove}
        </button>
      )}
    </Popover>
  )
}
