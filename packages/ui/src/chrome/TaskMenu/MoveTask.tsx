import type { ReactNode } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './MoveTask.module.css'

/*
 * Moving a task where its lead's model isn't offered (ADR-103), from its menu's Runs on: it says so, and the person picks
 * one of the lead's agent's models that is, in the picker the consumer gives (the window's model picker, kept to what the
 * place offers). The task moves once they say Move; Cancel leaves it where it runs.
 */

export interface MoveTaskText {
  title: (place: string) => string
  says: (place: string, model: string) => string
  cancel: string
  move: string
}

export const moveTaskText: MoveTaskText = {
  title: (place) => `Move to ${place}`,
  says: (place, model) => `${place} doesn’t offer ${model}. Its lead carries on there on:`,
  cancel: 'Cancel',
  move: 'Move',
}

export interface MoveTaskDialogProps {
  /** Where it moves, and the lead's model it can't run there, each by name. */
  place: string
  model: string
  /** The model picker, kept to what the place offers. */
  picker: ReactNode
  /** A model it offers is picked. */
  canMove: boolean
  onMove: () => void
  onClose: () => void
  text?: Partial<MoveTaskText> | undefined
}

export function MoveTaskDialog({ place, model, picker, canMove, onMove, onClose, text }: MoveTaskDialogProps) {
  const t = { ...moveTaskText, ...text }
  return (
    <Dialog
      title={t.title(place)}
      onClose={onClose}
      width={420}
      actions={
        <>
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button variant="signal" disabled={!canMove} onClick={onMove}>
            {t.move}
          </Button>
        </>
      }
    >
      <div className={s.pick}>
        <p className={s.says}>{t.says(place, model)}</p>
        {picker}
      </div>
    </Dialog>
  )
}
