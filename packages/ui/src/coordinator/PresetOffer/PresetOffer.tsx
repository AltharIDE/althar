import { useId, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import s from './PresetOffer.module.css'

export interface PresetOfferText {
  keep: string
  nearly: (preset: string) => string
  /** What the form is, for assistive technology. */
  label: string
  name: string
  /** Under the name: what keeping it does. */
  what: string
  /** Where the parts are a built-in preset but for one thing: what they are. */
  near: (preset: string, differs: string) => string
  save: string
  gotIt: string
  decline: string
  kept: (name: string) => string
  undo: string
  /** Behind the info mark: what parts and presets are. */
  aboutLabel: string
  parts: string
  presets: string
}

export const presetOfferText: PresetOfferText = {
  keep: 'Keep as a preset',
  nearly: (preset) => `Nearly ${preset}`,
  label: 'Keep as a preset',
  name: 'Preset name',
  what: 'New tasks can start from these parts: where it works, who checks it, how it ends, and who leads it.',
  near: (preset, differs) => `These are ${preset}, ${differs}.`,
  save: 'Keep',
  gotIt: 'Got it',
  decline: 'Don’t offer again',
  kept: (name) => `Kept as ${name}`,
  undo: 'Undo',
  aboutLabel: 'What are parts and presets?',
  parts: 'are how a task runs: where it works, who checks it, how it ends, and who leads it. This card shows them.',
  presets:
    'is a named set of parts a new task starts from, like Change or Prototype. Changing a task’s parts later never changes its preset. Yours are in Settings › Presets.',
}

export interface PresetOfferProps {
  /** The name it offers, in plain words, the person's to change before keeping it. */
  name: string
  /** A built-in preset the parts are but for one thing, said instead of a new one. */
  near?: { readonly preset: string; readonly differs: string }
  /** The name it was kept as: said, with Undo. */
  kept?: string
  onKeep: (name: string) => void
  /** Not to be offered again. */
  onDecline: () => void
  onUndo?: () => void
  text?: Partial<PresetOfferText>
}

/**
 * The offer to keep a task's parts as a preset, on the task's card: a quiet
 * link with an info mark, below the card's own actions, that opens a small
 * form for the name. Where the parts are a built-in preset but for one thing,
 * it says so instead. Kept, it says so, with Undo.
 */
export function PresetOffer({ name, near, kept, onKeep, onDecline, onUndo, text }: PresetOfferProps) {
  const t = { ...presetOfferText, ...text }
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(name)
  const field = useId()
  if (kept !== undefined)
    return (
      <span className={s.offer}>
        <Icon name="check" size={10} />
        <span className={s.words}>{t.kept(kept)}</span>
        {onUndo && <LinkButton onClick={onUndo}>{t.undo}</LinkButton>}
      </span>
    )
  return (
    <span className={s.offer}>
      <Popover
        label={t.label}
        placement="above"
        align="start"
        width={300}
        padded={false}
        open={open}
        onOpenChange={(next) => {
          if (next) setTyped(name)
          setOpen(next)
        }}
        trigger={<LinkButton>{near === undefined ? t.keep : t.nearly(near.preset)}</LinkButton>}
      >
        <form
          className={s.form}
          onSubmit={(event) => {
            event.preventDefault()
            setOpen(false)
            if (near === undefined) onKeep(typed.trim())
            else onDecline()
          }}
        >
          {near === undefined ? (
            <>
              <label className={s.label} htmlFor={field}>
                {t.name}
              </label>
              <Field id={field} value={typed} maxLength={40} onChange={(event) => setTyped(event.target.value)} />
              <span className={s.text}>{t.what}</span>
            </>
          ) : (
            <span className={s.text}>{t.near(near.preset, near.differs)}</span>
          )}
          <span className={s.foot}>
            {near === undefined && (
              <LinkButton
                onClick={() => {
                  setOpen(false)
                  onDecline()
                }}
              >
                {t.decline}
              </LinkButton>
            )}
            <span className={s.grow} />
            <Button size="small" type="submit" disabled={near === undefined && typed.trim() === ''}>
              {near === undefined ? t.save : t.gotIt}
            </Button>
          </span>
        </form>
      </Popover>
      <HoverCard
        width={300}
        placement="above"
        card={
          <span className={s.about}>
            <span>
              <b>Parts</b> {t.parts}
            </span>
            <span>
              <b>A preset</b> {t.presets}
            </span>
          </span>
        }
      >
        <button type="button" className={s.info} aria-label={t.aboutLabel}>
          <Icon name="info" size={12} />
        </button>
      </HoverCard>
    </span>
  )
}
