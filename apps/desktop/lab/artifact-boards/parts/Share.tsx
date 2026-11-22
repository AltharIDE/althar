import { CopyButton, Popover, Segmented } from '@althar/ui'

import { type Artifact, type Reach } from '../artifacts'
import { live, useLive } from '../live'
import { Glyph } from './Glyph'
import s from './parts.module.css'

/*
 * Share: who sees the artifact, which is its state in the chat's top row (a
 * draft, only you and its lead; shared with the people on the project, in
 * their Althar; or published, anyone with its link, as a page on the web
 * where they can comment), its link once it has one, and who has it.
 * Changing who sees it changes it at once. Where it lives in git is Keep's.
 */

const PEOPLE = [
  { name: 'Ana', role: 'Engineer', ink: 'ochre', can: 'Can comment' },
  { name: 'Sam', role: 'Product', ink: 'teal', can: 'Can comment' },
] as const

const LINE: Readonly<Record<Reach, string>> = {
  draft: 'Only you and its lead see it, in this chat.',
  shared: 'It opens in their Althar, beside their own conversation.',
  published: 'It opens as a page on the web. They can comment without Althar; their comments come here.',
}

export function Share({
  artifact,
  open,
  onOpenChange,
  tone = 'chip',
}: {
  artifact: Artifact
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Drawn as the canvas's chips, or as a top row's button. */
  tone?: 'chip' | 'head'
}) {
  useLive()
  const reach = live.reachOf(artifact)
  const link = `https://althar.link/kiln/${artifact.name}`
  return (
    <Popover
      label={`Share ${artifact.title}`}
      width={380}
      align="end"
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      trigger={
        <button type="button" className={tone === 'chip' ? s.shareChip : s.shareHead}>
          <Glyph name="share" size={13} />
          <span>Share</span>
        </button>
      }
    >
      <div className={s.share}>
        <div className={s.shareTitle}>Share {artifact.title}</div>
        <Segmented
          label="Who sees it"
          value={reach}
          onChange={(value) => live.reach(artifact, value)}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'shared', label: 'People on kiln' },
            { value: 'published', label: 'Anyone' },
          ]}
        />
        <p className={s.shareLine}>{LINE[reach]}</p>
        {reach !== 'draft' && (
          <div className={s.shareLink}>
            <span className={s.shareUrl} title={link}>
              {link.replace('https://', '')}
            </span>
            <CopyButton value={link} text={{ copy: 'Copy link' }} />
          </div>
        )}
        {reach !== 'draft' && (
          <ul className={s.people} aria-label="Who has it">
            {PEOPLE.map((one) => (
              <li key={one.name}>
                <span className={s.face} data-ink={one.ink} aria-hidden>
                  {one.name[0]}
                </span>
                <span className={s.personName}>{one.name}</span>
                <span className={s.personRole}>{one.role}</span>
                <span className={s.personCan}>{one.can}</span>
              </li>
            ))}
            <li>
              <input className={s.addPerson} placeholder="Add someone by name or email" aria-label="Add someone" />
            </li>
          </ul>
        )}
        <div className={s.shareRow}>
          <span className={s.shareRowWords}>
            <span>Download</span>
          </span>
          <span className={s.downloads}>
            <button type="button">Boards as PNG</button>
            <button type="button">Page as PDF</button>
          </span>
        </div>
      </div>
    </Popover>
  )
}
