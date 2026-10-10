import { Dialog } from 'radix-ui'
import { useCallback, useState, type KeyboardEvent } from 'react'

import { cx } from '../../lib/cx'
import { useControlled } from '../../lib/controlled'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import type { ImageRef } from '../Shell/Shell'
import s from './Lightbox.module.css'

export interface ImageViewText {
  /** Said in the picture's place when it couldn't be shown. */
  failed: string
}

export const imageViewText: ImageViewText = { failed: 'Couldn’t show this image' }

export interface ImageViewProps {
  image: ImageRef
  className?: string
  fit?: 'contain' | 'cover'
  /** `thumb` draws the smaller copy where there is one, as Shots does. */
  size?: 'full' | 'thumb'
  text?: Partial<ImageViewText>
}

/**
 * An image as a reference draws it: the picture at its src, with its words
 * as alt text, or the stand-in it carries. The browser decodes it off the
 * main thread, and only once it nears the screen; its box keeps its shape
 * until then, so nothing below it moves when it arrives.
 */
export function ImageView({ image, className, fit = 'contain', size = 'full', text }: ImageViewProps) {
  const src = size === 'thumb' ? (image.thumb ?? image.src) : image.src
  /* keyed by the picture, so another one starts loading afresh */
  if (image.status === 'loading') return <span className={cx(s.waiting, className)} data-state="loading" aria-hidden="true" />
  if (src && image.status !== 'failed') return <Picture key={src} src={src} image={image} fit={fit} className={className} text={text} />
  if (image.view && image.status !== 'failed') return <span className={className}>{image.view}</span>
  return <Unshown image={image} className={className} text={text} />
}

function Picture({
  src,
  image,
  fit,
  className,
  text,
}: {
  src: string
  image: ImageRef
  fit: 'contain' | 'cover'
  className: string | undefined
  text: Partial<ImageViewText> | undefined
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  /* a picture the browser already has may be complete before React hears its load */
  const seen = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete === true && img.naturalWidth > 0) setState('loaded')
  }, [])
  if (state === 'failed') return <Unshown image={image} className={className} text={text} />
  return (
    <img
      ref={seen}
      className={cx(s.img, fit === 'cover' && s.cover, className)}
      src={src}
      alt={image.alt ?? image.name}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      data-state={state}
      onLoad={() => setState('loaded')}
      onError={() => setState('failed')}
    />
  )
}

function Unshown({ image, className, text }: { image: ImageRef; className: string | undefined; text: Partial<ImageViewText> | undefined }) {
  const t = { ...imageViewText, ...text }
  const failed = image.status === 'failed' || image.src !== undefined
  return (
    <span className={cx(s.none, className)} data-state={failed ? 'failed' : undefined}>
      <span>{image.alt ?? image.name}</span>
      {failed && <span className={s.why}>{t.failed}</span>}
    </span>
  )
}

export interface LightboxText {
  open: string
  close: string
  closeKey: string
  previous: string
  next: string
  /** Where this one is among the set: 2 of 5. */
  position: (n: number, of: number) => string
  /** Announced as another one shows. */
  moved: (name: string, n: number, of: number) => string
  image: Partial<ImageViewText>
}

export const lightboxText: LightboxText = {
  open: 'Open in Preview',
  close: 'Close',
  closeKey: 'esc',
  previous: 'Previous image',
  next: 'Next image',
  position: (n, of) => `${n} of ${of}`,
  moved: (name, n, of) => `${name}, ${n} of ${of}`,
  image: {},
}

export interface LightboxProps {
  /** The images it can show: one, or the set it was opened from, such as a turn's screenshots. */
  images: readonly ImageRef[]
  /** Which one shows. With `onIndexChange`, the parent drives it. */
  index?: number
  /** Which one shows first, when the Lightbox keeps it. */
  defaultIndex?: number
  onIndexChange?: (index: number) => void
  onClose: () => void
  /** Open the image in the system's viewer. Without it, there is no such button. */
  onOpen?: (image: ImageRef) => void
  text?: Partial<LightboxText>
}

/**
 * Images at full size, over everything. A modal dialog: focus stays inside
 * it while it is open, Escape or a click outside closes it, and focus goes
 * back to what opened it. With a set, the arrow keys and the buttons beside
 * the name move between them, and the position is announced. Mount it to
 * open it.
 */
export function Lightbox({ images, index, defaultIndex = 0, onIndexChange, onClose, onOpen, text }: LightboxProps) {
  const t = { ...lightboxText, ...text }
  const [at, setAt] = useControlled(index, defaultIndex, onIndexChange)
  /* what had focus when it opened, which gets it back when it closes */
  const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const count = images.length
  const shown = Math.min(Math.max(at, 0), Math.max(count - 1, 0))
  const image = images[shown]
  const several = count > 1
  const move = (by: number) => {
    if (several) setAt((shown + by + count) % count)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!several || e.defaultPrevented) return
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'Home') setAt(0)
    else if (e.key === 'End') setAt(count - 1)
    else return
    e.preventDefault()
  }
  if (image === undefined) return null
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          className={cx('ch-root', s.dialog)}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => {
            /* Radix sends focus to a trigger; this opens without one, so it goes back to what had it */
            e.preventDefault()
            back?.focus()
          }}
        >
          <figure className={s.figure}>
            <div className={s.image}>
              <ImageView image={image} text={t.image} />
            </div>
            <figcaption className={s.caption}>
              <Dialog.Title className={s.name}>{image.label ?? image.name}</Dialog.Title>
              {image.meta && <span className={s.meta}>{image.meta}</span>}
              {several && <span className={s.position}>{t.position(shown + 1, count)}</span>}
              <span className={s.actions}>
                {several && (
                  <>
                    <ActionButton tone="onDark" icon="chevronL" aria-label={t.previous} onClick={() => move(-1)} />
                    <ActionButton tone="onDark" icon="chevron" aria-label={t.next} onClick={() => move(1)} />
                  </>
                )}
                {onOpen && (
                  <ActionButton tone="onDark" icon="external" onClick={() => onOpen(image)}>
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
          {/* another one showing is said, by name and place */}
          {several && (
            <VisuallyHidden>
              <output>{t.moved(image.label ?? image.name, shown + 1, count)}</output>
            </VisuallyHidden>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
