import { DropdownMenu as M } from 'radix-ui'
import { useId, type ReactElement, type ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { radixSide, type OverlayAlign, type OverlayPlacement } from '../../lib/overlay'
import { Kbd } from '../Kbd/Kbd'
import s from './Menu.module.css'

/*
 * A menu a button opens: a short list of commands or of choices, one of
 * which may be current. Built on Radix's dropdown menu, which gives the menu
 * button pattern (arrows, Home and End, typeahead, Escape back to the button)
 * and keeps the menu on screen.
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
  placement?: OverlayPlacement
  align?: OverlayAlign
  width?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

export function Menu({
  trigger,
  label,
  children,
  note,
  placement = 'below',
  align = 'start',
  width,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: MenuProps) {
  const noteId = useId()
  return (
    <M.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
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
          className={cx('ch-root', s.menu, className)}
          style={width ? { width } : undefined}
        >
          {children}
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
  /** A second line under the label, for why you would pick it. Read as the item's description, not its name. */
  description?: ReactNode
  kbd?: string
  disabled?: boolean
  /** Picking it leaves the menu open, for choices you may change twice. */
  keepOpen?: boolean
}

/* The label names the item; the hint and description describe it, so a screen reader hears the name first and alone. */
function Parts({ children, hint, kbd, description, ids }: Omit<ItemBase, 'disabled' | 'keepOpen'> & { ids: ItemIds }) {
  return (
    <>
      {description ? (
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

export interface MenuItemProps extends ItemBase {
  icon?: IconName
  /** Something before the label in place of an icon, like a project's mark. */
  lead?: ReactNode
  /** danger: the item ends or throws away something, like abandoning a task. */
  tone?: 'default' | 'danger'
  onSelect: () => void
}

export function MenuItem({ icon, lead, tone = 'default', children, hint, description, kbd, disabled, keepOpen, onSelect }: MenuItemProps) {
  const { ids, aria } = useItemIds(hint, description)
  return (
    <M.Item
      className={cx(s.item, description != null && s.tall, tone === 'danger' && s.danger)}
      disabled={disabled}
      {...aria}
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
        onSelect()
      }}
    >
      {(lead != null || icon) && <span className={s.lead}>{lead ?? (icon && <Icon name={icon} size={13} />)}</span>}
      <Parts hint={hint} description={description} kbd={kbd} ids={ids}>
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
  return (
    <M.RadioItem
      value={value}
      className={cx(s.item, description != null && s.tall)}
      disabled={disabled}
      {...aria}
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
      }}
    >
      {lead && <span className={s.lead}>{lead}</span>}
      <Parts hint={hint} description={description} kbd={kbd} ids={ids}>
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
