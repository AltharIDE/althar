import { Dialog } from 'radix-ui'

import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import type { ImageRef } from '../Shell/Shell'
import s from './Lightbox.module.css'

export interface LightboxText {
  open: string
  close: string
  closeKey: string
}

export const lightboxText: LightboxText = { open: 'Open in Preview', close: 'Close', closeKey: 'esc' }

export interface LightboxProps {
  image: ImageRef
  onClose: () => void
  /** Open the image in the system's viewer. Without it, there is no such button. */
  onOpen?: () => void
  text?: Partial<LightboxText>
}

/** An image at full size, over everything. A modal dialog: Escape or a click outside closes it. */
export function Lightbox({ image, onClose, onOpen, text }: LightboxProps) {
  const t = { ...lightboxText, ...text }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={cx('ch-root', s.dialog)} aria-describedby={undefined}>
          <figure className={s.figure}>
            <div className={s.image}>{image.view ?? <span className={s.none}>{image.name}</span>}</div>
            <figcaption className={s.caption}>
              <Dialog.Title className={s.name}>{image.name}</Dialog.Title>
              {image.meta && <span className={s.meta}>{image.meta}</span>}
              <span className={s.actions}>
                {onOpen && (
                  <ActionButton tone="onDark" icon="external" onClick={onOpen}>
                    {t.open}
                  </ActionButton>
                )}
                <Dialog.Close asChild>
                  <ActionButton tone="onDark" icon="close" kbd={t.closeKey} autoFocus>
                    {t.close}
                  </ActionButton>
                </Dialog.Close>
              </span>
            </figcaption>
          </figure>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
