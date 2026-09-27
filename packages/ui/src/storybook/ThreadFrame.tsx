import { useMemo, useState, type ReactNode } from 'react'

import { DocPanel } from '../thread/DocPanel/DocPanel'
import { Lightbox } from '../thread/Lightbox/Lightbox'
import { Shell, type DocRef, type ImageRef, type Steer, type StepRef, type ThreadShell } from '../thread/Shell/Shell'
import s from './ThreadFrame.module.css'

/*
 * A thread's column for stories: the reading width, and a working shell, so
 * a document opens in the side panel and an image in the lightbox. A step's
 * thread is noted, not opened; the task face does that.
 */
export function ThreadFrame({ children, term = 'paper' }: { children: ReactNode; term?: 'paper' | 'dark' }) {
  const [doc, setDoc] = useState<DocRef | null>(null)
  const [image, setImage] = useState<ImageRef | null>(null)
  const [step, setStep] = useState<StepRef | null>(null)
  const [steers, setSteers] = useState<Steer[]>([])
  const shell = useMemo<ThreadShell>(
    () => ({
      openDoc: setDoc,
      openImage: setImage,
      openStep: setStep,
      steers,
      steer: (st, text) => setSteers((v) => [...v, { id: v.length + 1, step: st, text }]),
    }),
    [steers],
  )
  return (
    <Shell.Provider value={shell}>
      <div className={doc ? `${s.frame} ${s.withPanel}` : s.frame} data-term={term}>
        <div className={s.column}>
          {children}
          {step && <p className={s.note}>Opened the thread of {step.label}.</p>}
        </div>
        {doc && <DocPanel doc={doc} onClose={() => setDoc(null)} />}
      </div>
      {image && <Lightbox image={image} onClose={() => setImage(null)} />}
    </Shell.Provider>
  )
}

export const threadDecorator = (Story: () => ReactNode) => (
  <ThreadFrame>
    <Story />
  </ThreadFrame>
)
