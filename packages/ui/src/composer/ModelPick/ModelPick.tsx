import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import { useControlled } from '../../lib/controlled'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { Segmented } from '../../primitives/Segmented/Segmented'
import s from './ModelPick.module.css'

export interface ModelPickText {
  /** The popover's name and the button's title. */
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
  open,
  defaultOpen = false,
  onOpenChange,
  text,
}: ModelPickProps) {
  const t = { ...modelPickText, ...text }
  const [isOpen, setOpen] = useControlled(open, defaultOpen, onOpenChange)
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
        <button type="button" className={cx(s.button, s[variant])} title={t.label(owner)} aria-label={t.current(owner, model.short, level)}>
          <Model model={model} short />
          {level !== null && <span className={s.effort}>{level}</span>}
          <Icon name="chevronD" size={10} className={s.chev} />
        </button>
      }
    >
      <div className={s.head}>{owner}</div>
      <ul className={s.list} aria-label={t.pinned}>
        {list.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              className={cx(s.option, x.id === model.id && s.current)}
              aria-current={x.id === model.id || undefined}
              onClick={() => {
                if (x.id !== model.id) onChange(x.id)
              }}
            >
              <Model model={x} />
              {!isPinned(x) && <span className={s.unpinned}>{t.notPinned}</span>}
              <Icon name="check" size={11} className={s.check} />
            </button>
          </li>
        ))}
      </ul>

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
