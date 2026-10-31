import { useEffect, useState, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { useTheme } from '../../lib/theme'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Lightbox, type LightboxText } from '../Lightbox/Lightbox'
import { diagram, type Drawn } from './drawing'
import s from './Markdown.module.css'

export interface DiagramText {
  /** The drawing's name, for a screen reader and over it opened bigger. */
  name: string
  /** The switch to the diagram's source, and back. */
  source: string
  diagram: string
  bigger: string
  /** Said over mermaid's own error, where the source isn't a diagram it can draw. */
  failed: string
  lightbox?: Partial<LightboxText>
}

export const diagramText: DiagramText = {
  name: 'Diagram',
  source: 'Source',
  diagram: 'Diagram',
  bigger: 'Open bigger',
  failed: 'Couldn’t draw this diagram',
}

/** A fenced block's text, as code, with its copy in the corner. */
export function CodeBlock({ text, copy, after }: { text: string; copy: Partial<CopyButtonText> | undefined; after?: ReactNode }) {
  /* the copy sits in the block's corner, over a band the code keeps clear of; beside a single line instead */
  return (
    <div className={cx(s.block, !text.includes('\n') && s.oneLine)}>
      <pre>
        <code>{text}</code>
      </pre>
      <span className={s.copy}>
        <CopyButton value={text} text={copy} ghost />
      </span>
      {after}
    </div>
  )
}

type Shown = { source: string; drawn: Drawn; error?: undefined } | { source: string; drawn?: undefined; error: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).trim()

/**
 * A ```mermaid block, drawn: its source until the block is closed and drawn,
 * then the diagram at its own size, scrolling sideways where it is wider than
 * the thread, with a switch to its source, its copy, and a way to open it
 * bigger. Drawn again in the other theme's colours when the theme changes,
 * the last drawing staying until the new one is ready. Where mermaid can't
 * draw it, its source with mermaid's error under it.
 */
export function Diagram({
  source,
  done,
  text,
  copy,
}: {
  source: string
  /** The block is closed: a message still streaming shows it as source. */
  done: boolean
  text?: Partial<DiagramText>
  copy?: Partial<CopyButtonText>
}) {
  const t = { ...diagramText, ...text }
  const theme = useTheme()
  const [shown, setShown] = useState<Shown>()
  const [asSource, setAsSource] = useState(false)
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (!done || source.trim() === '') return
    let live = true
    diagram(source, theme).then(
      (drawn) => live && setShown({ source, drawn }),
      (error: unknown) => live && setShown({ source, error: message(error) }),
    )
    return () => {
      live = false
    }
  }, [source, theme, done])

  const now = shown?.source === source ? shown : undefined
  if (now === undefined) return <CodeBlock text={source} copy={copy} />
  if (now.error !== undefined)
    return (
      <CodeBlock
        text={source}
        copy={copy}
        after={
          <div className={s.diagramError} role="note">
            <span>{t.failed}</span>
            <pre>{now.error}</pre>
          </div>
        }
      />
    )

  const { drawn } = now
  /* sanitized when drawn (drawDiagram): nothing in it runs or fetches */
  const svg = { __html: drawn.svg }
  return (
    <div className={cx(s.block, s.drawing)} data-view={asSource ? 'source' : 'diagram'}>
      {asSource ? (
        <pre>
          <code>{source}</code>
        </pre>
      ) : (
        <div className={s.diagram} role="img" aria-label={t.name} dangerouslySetInnerHTML={svg} />
      )}
      <span className={s.copy}>
        <ActionButton size="small" onClick={() => setAsSource((was) => !was)}>
          {asSource ? t.diagram : t.source}
        </ActionButton>
        {!asSource && (
          <Tooltip label={t.bigger}>
            <ActionButton icon="expand" aria-label={t.bigger} onClick={() => setBig(true)} />
          </Tooltip>
        )}
        <CopyButton value={source} text={copy} ghost />
      </span>
      {big && (
        <Lightbox
          images={[
            {
              name: t.name,
              /* a small diagram opens larger than it is drawn in the thread; a wide one fits the window */
              width: Math.round(drawn.width * 1.6),
              height: Math.round(drawn.height * 1.6),
              view: <div className={s.bigDiagram} role="img" aria-label={t.name} dangerouslySetInnerHTML={svg} />,
            },
          ]}
          onClose={() => setBig(false)}
          {...(t.lightbox === undefined ? {} : { text: t.lightbox })}
        />
      )}
    </div>
  )
}
