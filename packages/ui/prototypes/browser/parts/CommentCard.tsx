// Scrappy: a comment pointed on a page, on hover: the spot as cropped, the comment, and the element as the page drew it. The lead
// gets the same: its selector and text, the page and its size, and the crop.
import { KeyValues } from '../../../src/primitives/KeyValues/KeyValues'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import { shown } from '../addresses'
import type { Comment } from '../state'
import s from './CommentCard.module.css'

/** A crop the server drew, by its digest. */
export const cropSrc = (digest: string) => `/__shot/${digest}`

export function Crop({ comment }: { comment: Comment }) {
  if (comment.crop === 'drawing')
    return (
      <span className={s.drawing}>
        <Spinner size="small" />
      </span>
    )
  if (comment.crop === 'failed') return null
  return (
    <img
      className={s.crop}
      src={cropSrc(comment.crop.digest)}
      alt=""
      style={{ aspectRatio: `${comment.crop.width} / ${comment.crop.height}` }}
    />
  )
}

const Swatch = ({ color }: { color: string }) => (
  <span className={s.color}>
    <span className={s.swatch} style={{ background: color.split(' ')[0] }} />
    {color}
  </span>
)

export function CommentCard({ comment, n }: { comment: Comment; n: number }) {
  const { look } = comment
  return (
    <span className={s.card}>
      <Crop comment={comment} />
      <span className={s.note}>
        <span className={s.n}>{n}</span>
        {comment.note}
      </span>
      <KeyValues
        className={s.facts}
        keyWidth={74}
        items={[
          ['Element', <code key="el">{comment.label}</code>],
          ...(comment.text === ''
            ? []
            : [
                [
                  'Text',
                  <span key="t" className={s.text}>
                    “{comment.text}”
                  </span>,
                ] as const,
              ]),
          ['Size', `${Math.round(comment.box.w)} × ${Math.round(comment.box.h)}`],
          ['Font', look.font],
          ['Colour', <Swatch key="c" color={look.color} />],
          ...(look.background === null ? [] : [['Background', <Swatch key="b" color={look.background} />] as const]),
          ['Page', `${shown(comment.address)} at ${comment.viewport.w} × ${comment.viewport.h}`],
          [
            'Selector',
            <code key="s" className={s.selector}>
              {comment.selector}
            </code>,
          ],
        ]}
      />
    </span>
  )
}
