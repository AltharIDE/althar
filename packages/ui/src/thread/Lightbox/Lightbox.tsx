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

/** An image as a reference draws it: the picture at its src, with its words as alt text, or the stand-in it carries. */
export function ImageView({ image, className, fit = 'contain' }: { image: ImageRef; className?: string; fit?: 'contain' | 'cover' }) {
  if (image.src) return <img className={cx(s.img, fit === 'cover' && s.cover, className)} src={image.src} alt={image.alt ?? image.name} />
  if (image.view) return <span className={className}>{image.view}</span>
  return <span className={cx(s.none, className)}>{image.alt ?? image.name}</span>
}

export interface LightboxProps {
  image: ImageRef
  onClose: () => void
  /** Open the image in the system's viewer. Without it, there is no such button. */
  onOpen?: () => void
  text?: Partial<LightboxText>
}

/** An image at full size, over everything. A modal dialog: Escape or a click outside closes it. Mount it to open it. */
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
            <div className={s.image}>
              <ImageView image={image} />
            </div>
            <figcaption className={s.caption}>
              <Dialog.Title className={s.name}>{image.label ?? image.name}</Dialog.Title>
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
