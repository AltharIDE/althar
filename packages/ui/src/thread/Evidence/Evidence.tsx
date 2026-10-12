import { EvidenceKind } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Markdown } from '../Markdown/Markdown'
import type { ImageRef } from '../Shell/Shell'
import { Shots, type ShotsText } from '../Shots/Shots'
import { ExitShown } from '../Terminal/exitShown'
import { Terminal, type TerminalText } from '../Terminal/Terminal'
import s from './Evidence.module.css'

export interface EvidenceText {
  /** What the task built, above its proof. */
  built: string
  title: string
  /** What couldn't be shown, as its own list. */
  unverified: string
  kinds: Record<EvidenceKind, string>
  exit: (code: number) => string
  /** The button that opens what a command printed; aria-expanded says whether it is open. */
  open: (caption: string) => string
  shots: Partial<ShotsText>
  terminal: Partial<TerminalText>
}

export const evidenceText: EvidenceText = {
  built: 'What it built',
  title: 'Evidence',
  unverified: 'Unverified',
  kinds: {
    [EvidenceKind.Screenshot]: 'Screenshot',
    [EvidenceKind.Recording]: 'Recording',
    [EvidenceKind.Command]: 'Command',
    [EvidenceKind.TestRun]: 'Test run',
    [EvidenceKind.Response]: 'Response',
    [EvidenceKind.Log]: 'Log',
    [EvidenceKind.Note]: 'Note',
  },
  exit: (code) => `exit ${code}`,
  open: (caption) => `What it printed: ${caption}`,
  shots: { label: 'Screenshots' },
  terminal: {},
}

/** A piece of evidence: a picture, something printed, or a note; each with its kind and what it shows. */
export type EvidencePiece = { id: string; kind: EvidenceKind; caption: string } & (
  | { form: 'picture'; shot: ImageRef }
  | {
      form: 'output'
      /** What ran; none for a response or a log. */
      command?: string
      exit?: number
      /** Its end, which is where a run says how it went. */
      lines: string[]
      earlier?: string[]
      /** Lines from its start that weren't kept. */
      omitted?: number
    }
  | { form: 'note'; text?: string }
)

export type EvidenceProps = RootProps<
  'section',
  {
    /** What the task built, as its lead last said it, in markdown: its summary, read before the proof. */
    built?: string | null
    pieces: readonly EvidencePiece[]
    /** What the lead changed but couldn't show working, each in a line. */
    unverified?: readonly string[]
    headingLevel?: HeadingLevel
    text?: Partial<EvidenceText>
  }
>

/**
 * A task's finished view: what it built, as its lead last said it, then
 * what the lead showed of its change working, at the end of its step: the
 * pictures together, each opening full size; each command or test run a
 * row saying what it shows and how it exited, opening to what it printed;
 * notes as they were said. Then what it couldn't show, plainly, so the
 * person knows what is still theirs to check. With none of them, nothing shows.
 */
export function Evidence({ built = null, pieces, unverified = [], headingLevel = 3, text, className, ...rest }: EvidenceProps) {
  const t = { ...evidenceText, ...text, kinds: { ...evidenceText.kinds, ...text?.kinds } }
  if (built === null && pieces.length === 0 && unverified.length === 0) return null
  const shots = pieces.flatMap((piece) => (piece.form === 'picture' ? [{ ...piece.shot, id: piece.id, label: piece.caption }] : []))
  const rows = pieces.filter((piece) => piece.form !== 'picture')
  return (
    <section className={cx(s.evidence, className)} {...rest}>
      {built !== null && (
        <>
          <Heading level={headingLevel} className={s.label}>
            {t.built}
          </Heading>
          <Markdown source={built} headingLevel={headingLevel === 6 ? 6 : ((headingLevel + 1) as HeadingLevel)} />
        </>
      )}
      {pieces.length > 0 && (
        <>
          <Heading level={headingLevel} className={s.label}>
            {t.title}
          </Heading>
          <Shots items={shots} text={t.shots} />
          {rows.length > 0 && (
            <ul className={s.rows}>
              {rows.map((piece) => (
                <li key={piece.id}>
                  {piece.form === 'output' ? (
                    <Disclosure>
                      <DisclosureTrigger>
                        <button type="button" className={cx(s.row, s.opens)} aria-label={t.open(piece.caption)}>
                          <span className={s.kind}>{t.kinds[piece.kind]}</span>
                          <span className={s.caption}>{piece.caption}</span>
                          {piece.exit !== undefined && <span className={cx(s.exit, piece.exit !== 0 && s.bad)}>{t.exit(piece.exit)}</span>}
                          <Caret />
                        </button>
                      </DisclosureTrigger>
                      <Fold bleed={false}>
                        <div className={s.printed}>
                          <ExitShown.Provider value={piece.exit !== undefined}>
                            <Terminal
                              lines={piece.lines}
                              {...(piece.command === undefined ? {} : { command: piece.command })}
                              {...(piece.exit === undefined ? {} : { exit: piece.exit })}
                              {...(piece.earlier === undefined ? {} : { earlier: piece.earlier })}
                              {...(piece.omitted === undefined ? {} : { omitted: piece.omitted })}
                              text={t.terminal}
                            />
                          </ExitShown.Provider>
                        </div>
                      </Fold>
                    </Disclosure>
                  ) : (
                    <div className={s.row}>
                      <span className={s.kind}>{t.kinds[piece.kind]}</span>
                      <span className={s.caption}>
                        {piece.caption}
                        {piece.form === 'note' && piece.text !== undefined && <span className={s.said}>{piece.text}</span>}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {unverified.length > 0 && (
        <>
          <Heading level={headingLevel} className={s.label}>
            {t.unverified}
          </Heading>
          <ul className={s.unverified}>
            {unverified.map((line, index) => (
              <li key={`${index}:${line}`}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
