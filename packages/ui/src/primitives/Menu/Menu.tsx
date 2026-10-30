import { DropdownMenu as M } from 'radix-ui'
import { createContext, type ReactElement, type ReactNode, useContext, useId, useRef, useState } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { radixSide, type OverlayAlign, type OverlayPlacement } from '../../lib/overlay'
import { Kbd } from '../Kbd/Kbd'
import seg from '../Segmented/Segmented.module.css'
import sw from '../Switch/Switch.module.css'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Menu.module.css'

/*
 * A menu a button opens: a short list of commands or of choices, one of
 * which may be current. Built on Radix's dropdown menu, which gives the menu
 * button pattern (arrows, Home and End, typeahead, Escape back to the button)
 * and keeps the menu on screen.
 *
 * What an item does, its description, shows under its label, or, in a menu
 * of short rows, at the menu's foot while the item is highlighted: either way
 * it is the item's accessible description. A setting can sit in a menu too,
 * changed in place: a few choices side by side (MenuSegments), or a switch
 * (MenuSwitchItem). Choosing either keeps the menu open, to see it change.
 */

export interface MenuProps {
  /** The button that opens it. It must accept a ref and spread its props onto a button. */
  trigger: ReactElement
  /** What the menu is for; read when it opens. */
  label: string
  children: ReactNode
  /**
   * A quiet line of explanation at the foot. It is not an item, so arrows
   * pass over it; it is the menu's description, so it is read when the menu
   * opens.
   */
  note?: ReactNode
  /**
   * Where items' descriptions show: under each label (`under`), or at the
   * menu's foot, for the item highlighted (`foot`), so every row is one line.
   */
  descriptions?: 'under' | 'foot'
  placement?: OverlayPlacement
  align?: OverlayAlign
  width?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Whether closing gives focus back to the trigger: not where what was chosen took it on, such as a field to type in. */
  returnFocus?: () => boolean
  className?: string
}

/** Where the items of the menu they are in say what they do, and, at its foot, the one highlighted. */
interface Describing {
  readonly foot: boolean
  readonly show: (description: ReactNode) => void
  readonly hide: () => void
}

const Describe = createContext<Describing>({ foot: false, show: () => {}, hide: () => {} })

export function Menu({
  trigger,
  label,
  children,
  note,
  descriptions = 'under',
  placement = 'below',
  align = 'start',
  width,
  open,
  defaultOpen,
  onOpenChange,
  returnFocus,
  className,
}: MenuProps) {
  const noteId = useId()
  const [said, setSaid] = useState<ReactNode>(null)
  const [shown, setShown] = useState(defaultOpen ?? false)
  const button = useRef<HTMLButtonElement>(null)
  const describing: Describing = { foot: descriptions === 'foot', show: setSaid, hide: () => setSaid(null) }
  return (
    <M.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => {
        // Opened again, it says nothing until an item is highlighted.
        setSaid(null)
        setShown(next)
        onOpenChange?.(next)
      }}
      modal={false}
    >
      <M.Trigger asChild ref={button}>
        {trigger}
      </M.Trigger>
      <M.Portal>
        <M.Content
          /* Radix names the menu after its trigger, which would override the label: Effort, not Effort: High */
          aria-labelledby={undefined}
          aria-label={label}
          aria-describedby={note ? noteId : undefined}
          side={radixSide(placement)}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          loop
          onCloseAutoFocus={(event) => {
            if (returnFocus !== undefined && !returnFocus()) event.preventDefault()
          }}
          /*
           * Going, it is inert: the pointer leaving an item as it stops taking
           * the pointer would focus the menu, taking focus from where the
           * chosen item put it, such as a field to type in.
           */
          inert={!(open ?? shown)}
          /* Its button opens and closes it: pressed as the menu goes, it opens it again, which a dismissal would undo at once. */
          onInteractOutside={(event) => {
            if (event.target instanceof Node && button.current?.contains(event.target)) event.preventDefault()
          }}
          className={cx('ch-root', s.menu, className)}
          style={width ? { width } : undefined}
        >
          <Describe.Provider value={describing}>{children}</Describe.Provider>
          {/* Each item's description is its own, read with it; the foot only shows the highlighted one's. */}
          {describing.foot && said !== null && (
            <div className={cx(s.note, s.said)} aria-hidden="true">
              {said}
            </div>
          )}
          {note && (
            <div id={noteId} className={s.note}>
              {note}
            </div>
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

interface ItemBase {
  children: ReactNode
  /** Quieter text after the label: a count, a short note. */
  hint?: ReactNode
  /** A second line under the label, for why you would pick it: or at the menu's foot, where it says. Read as the item's description, not its name. */
  description?: ReactNode
  kbd?: string
  disabled?: boolean
  /** Picking it leaves the menu open, for choices you may change twice. */
  keepOpen?: boolean
}

/* The label names the item; the hint and description describe it, so a screen reader hears the name first and alone. */
function Parts({ children, hint, kbd, description, ids, foot }: Omit<ItemBase, 'disabled' | 'keepOpen'> & { ids: ItemIds; foot: boolean }) {
  return (
    <>
      {description && !foot ? (
        <span className={s.text}>
          <span className={s.label} id={ids.label}>
            {children}
          </span>
          <span className={s.description} id={ids.description}>
            {description}
          </span>
        </span>
      ) : (
        <span className={s.label} id={ids.label}>
          {children}
        </span>
      )}
      {description && foot && <VisuallyHidden id={ids.description}>{description}</VisuallyHidden>}
      {hint != null && (
        <span className={s.hint} id={ids.hint}>
          {hint}
        </span>
      )}
      {kbd && <Kbd>{kbd}</Kbd>}
    </>
  )
}

interface ItemIds {
  label: string
  description: string
  hint: string
}

function useItemIds(hint: ReactNode, description: ReactNode) {
  const base = useId()
  const ids: ItemIds = { label: `${base}-label`, description: `${base}-description`, hint: `${base}-hint` }
  const described = [description != null && ids.description, hint != null && ids.hint].filter(Boolean).join(' ')
  return { ids, aria: { 'aria-labelledby': ids.label, 'aria-describedby': described || undefined } }
}

/** How an item takes part in saying what it does: drawn under it, or, at the foot, while it is highlighted (Radix focuses the item the pointer or the arrows are on). */
function useDescribed(description: ReactNode) {
  const describing = useContext(Describe)
  const handlers =
    describing.foot && description != null ? { onFocus: () => describing.show(description), onBlur: () => describing.hide() } : {}
  return { foot: describing.foot, tall: description != null && !describing.foot, handlers }
}

export interface MenuItemProps extends ItemBase {
  icon?: IconName
  /** Something before the label in place of an icon, like a project's mark. */
  lead?: ReactNode
  /** danger: the item ends or throws away something, like abandoning a task. */
  tone?: 'default' | 'danger'
  /** With danger: grey like the items round it until it is highlighted, then red, for a menu where it shouldn't call out. */
  quiet?: boolean
  onSelect: () => void
}

export function MenuItem({
  icon,
  lead,
  tone = 'default',
  quiet = false,
  children,
  hint,
  description,
  kbd,
  disabled,
  keepOpen,
  onSelect,
}: MenuItemProps) {
  const { ids, aria } = useItemIds(hint, description)
  const described = useDescribed(description)
  return (
    <M.Item
      className={cx(s.item, described.tall && s.tall, tone === 'danger' && (quiet ? s.quietDanger : s.danger))}
      disabled={disabled}
      {...aria}
      {...described.handlers}
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
        onSelect()
      }}
    >
      {(lead != null || icon) && <span className={s.lead}>{lead ?? (icon && <Icon name={icon} size={13} />)}</span>}
      <Parts hint={hint} description={description} kbd={kbd} ids={ids} foot={described.foot}>
        {children}
      </Parts>
    </M.Item>
  )
}

export interface MenuRadioGroupProps {
  /** A small heading over the choices; also the group's name. */
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}

/** A set of choices where one is current. */
export function MenuRadioGroup({ label, value, onChange, children }: MenuRadioGroupProps) {
  return (
    <M.RadioGroup value={value} onValueChange={onChange} aria-label={label} className={s.group}>
      <M.Label className={s.heading} aria-hidden="true">
        {label}
      </M.Label>
      {children}
    </M.RadioGroup>
  )
}

export interface MenuRadioItemProps extends ItemBase {
  value: string
  /** Something before the label, like a lab mark. */
  lead?: ReactNode
}

/** One choice in a MenuRadioGroup. The current one carries a check. */
export function MenuRadioItem({ value, lead, children, hint, description, kbd, disabled, keepOpen }: MenuRadioItemProps) {
  const { ids, aria } = useItemIds(hint, description)
  const described = useDescribed(description)
  return (
    <M.RadioItem
      value={value}
      className={cx(s.item, described.tall && s.tall)}
      disabled={disabled}
      {...aria}
      {...described.handlers}
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
      }}
    >
      {lead && <span className={s.lead}>{lead}</span>}
      <Parts hint={hint} description={description} kbd={kbd} ids={ids} foot={described.foot}>
        {children}
      </Parts>
      <span className={s.check}>
        <M.ItemIndicator>
          <Icon name="check" size={12} />
        </M.ItemIndicator>
      </span>
    </M.RadioItem>
  )
}

export interface MenuCheckboxItemProps extends ItemBase {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A choice that is on or off by itself, among others that may be on too. It carries a check while on. */
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  hint,
  description,
  kbd,
  disabled,
  keepOpen,
}: MenuCheckboxItemProps) {
  const { ids, aria } = useItemIds(hint, description)
  const described = useDescribed(description)
  return (
    <M.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cx(s.item, described.tall && s.tall)}
      disabled={disabled}
      {...aria}
      {...described.handlers}
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
      }}
    >
      <Parts hint={hint} description={description} kbd={kbd} ids={ids} foot={described.foot}>
        {children}
      </Parts>
      <span className={s.check}>
        <M.ItemIndicator>
          <Icon name="check" size={12} />
        </M.ItemIndicator>
      </span>
    </M.CheckboxItem>
  )
}

export interface MenuSegment {
  value: string
  label: string
  /** What choosing it means: said as the menu says its items' descriptions. */
  description?: ReactNode
}

export interface MenuSegmentsProps {
  /** The setting's name, over its choices; also the group's name. */
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly MenuSegment[]
}

/**
 * A setting's few choices side by side, as Segmented draws them, changed in
 * place. Each is a menu item, so the arrows reach them as they do any other;
 * choosing one keeps the menu open, to see it change.
 */
export function MenuSegments({ label, value, onChange, options }: MenuSegmentsProps) {
  return (
    <div className={s.setting}>
      <span className={s.settingLabel} aria-hidden="true">
        {label}
      </span>
      <M.RadioGroup value={value} onValueChange={onChange} aria-label={label} className={cx(seg.group, s.segments)}>
        {options.map((option) => (
          <Segment key={option.value} option={option} />
        ))}
      </M.RadioGroup>
    </div>
  )
}

function Segment({ option }: { option: MenuSegment }) {
  const { ids, aria } = useItemIds(undefined, option.description)
  const described = useDescribed(option.description)
  return (
    <M.RadioItem
      value={option.value}
      className={cx(seg.option, s.segment)}
      {...aria}
      {...described.handlers}
      onSelect={(e) => e.preventDefault()}
    >
      <span id={ids.label}>{option.label}</span>
      {option.description != null && <VisuallyHidden id={ids.description}>{option.description}</VisuallyHidden>}
    </M.RadioItem>
  )
}

export interface MenuSwitchItemProps extends Omit<ItemBase, 'keepOpen' | 'kbd' | 'hint'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** A line under the label that always shows, such as what holds it on. */
  note?: ReactNode
  /** Held on by something above it, as a project's rule holds a task's. */
  held?: boolean
  /** Where it is held, what holds it opens instead, and the menu closes: otherwise it is only shown, disabled. */
  onHeld?: () => void
}

/**
 * A setting that is on or off, taking effect at once, drawn as the Switch
 * at the row's end. A checkbox item, that leaves the menu open to see it
 * change; held on from above, an item that opens what holds it.
 */
export function MenuSwitchItem({
  checked,
  onCheckedChange,
  children,
  note,
  held = false,
  onHeld,
  description,
  disabled,
}: MenuSwitchItemProps) {
  const { ids, aria } = useItemIds(note, description)
  const described = useDescribed(description)
  const on = checked || held
  const inside = (
    <>
      <span className={s.switchText}>
        <span className={s.label} id={ids.label}>
          {children}
        </span>
        {note != null && (
          <span className={s.switchNote} id={ids.hint}>
            {note}
          </span>
        )}
        {description != null &&
          (described.foot ? (
            <VisuallyHidden id={ids.description}>{description}</VisuallyHidden>
          ) : (
            <span className={s.description} id={ids.description}>
              {description}
            </span>
          ))}
      </span>
      <span className={cx(sw.switch, s.switch, held && s.held)} aria-hidden="true" aria-checked={on}>
        <span className={sw.knob} />
      </span>
    </>
  )
  const className = cx(s.item, s.switchRow, (note != null || described.tall) && s.tall)
  if (held && onHeld !== undefined)
    return (
      <M.Item className={className} disabled={disabled} {...aria} {...described.handlers} onSelect={onHeld}>
        {inside}
      </M.Item>
    )
  return (
    <M.CheckboxItem
      checked={on}
      onCheckedChange={onCheckedChange}
      className={className}
      disabled={disabled || held}
      {...aria}
      {...described.handlers}
      onSelect={(e) => e.preventDefault()}
    >
      {inside}
    </M.CheckboxItem>
  )
}

/** Items that belong together, under a small heading. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <M.Group aria-label={label} className={s.group}>
      <M.Label className={s.heading} aria-hidden="true">
        {label}
      </M.Label>
      {children}
    </M.Group>
  )
}

export function MenuSeparator() {
  return <M.Separator className={s.separator} />
}
