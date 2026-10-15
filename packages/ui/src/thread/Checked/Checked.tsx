import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import type { EvidencePiece } from '../Evidence/Evidence'
import { Markdown } from '../Markdown/Markdown'
import s from './Checked.module.css'

export interface CheckedText {
  checked: string
  notChecked: string
  /** A check's row, read out: what it printed, by its caption. */
  printed: (caption: string) => string
}

export const checkedText: CheckedText = {
  checked: 'What it checked',
  notChecked: 'Not checked',
  printed: (caption) => `What it printed: ${caption}`,
}

export type CheckedProps = RootProps<
  'div',
  {
    /** What it showed other than by a picture: runs, responses, logs and notes. Pictures here are left out. */
    pieces: ReadonlyArray<EvidencePiece>
    /** What it changed but couldn't show working, which is still the person's to check. */
    unverified?: ReadonlyArray<string>
    text?: Partial<CheckedText>
  }
>

/** How many of a run's last lines show when it opens. */
const SHOWN = 30

/**
 * What a lead checked, other than by looking, under its result: a quiet line
 * each, ticked or crossed, opening to what it printed; then what it couldn't
 * check, in plain words. Nothing to say, nothing drawn.
 */
export function Checked({ pieces, unverified = [], text, className, ...rest }: CheckedProps) {
  const t = { ...checkedText, ...text }
  const checks = pieces.filter((piece) => piece.form !== 'picture')
  if (checks.length === 0 && unverified.length === 0) return null
  return (
    <div className={cx(s.checks, className)} {...rest}>
      {checks.length > 0 && (
        <div className={s.part}>
          <p className={s.head}>{t.checked}</p>
          {checks.map((piece) => {
            const failed = piece.form === 'output' && piece.exit !== undefined && piece.exit !== 0
            const printed =
              piece.form === 'output' ? [...(piece.command === undefined ? [] : [`$ ${piece.command}`]), ...piece.lines.slice(-SHOWN)] : []
            const said = piece.form === 'note' ? (piece.text ?? '') : ''
            const opens = printed.length > 0 || said !== ''
            const row = (
              <>
                <Icon name={failed ? 'close' : 'check'} className={failed ? s.bad : s.good} />
                <span className={s.caption}>{piece.caption}</span>
                {opens && <Caret />}
              </>
            )
            if (!opens)
              return (
                <div key={piece.id} className={s.row}>
                  {row}
                </div>
              )
            return (
              <Disclosure key={piece.id} className={s.check}>
                <DisclosureTrigger>
                  <button type="button" className={s.row} aria-label={t.printed(piece.caption)}>
                    {row}
                  </button>
                </DisclosureTrigger>
                <Fold bleed={false}>
                  {printed.length > 0 ? <pre className={s.out}>{printed.join('\n')}</pre> : <p className={s.note}>{said}</p>}
                </Fold>
              </Disclosure>
            )
          })}
        </div>
      )}
      {unverified.length > 0 && (
        <div className={s.part}>
          <p className={s.head}>{t.notChecked}</p>
          <Markdown source={unverified.map((line) => `- ${line}`).join('\n')} />
        </div>
      )}
    </div>
  )
}
