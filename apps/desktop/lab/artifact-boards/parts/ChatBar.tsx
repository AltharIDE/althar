import { BackCrumb, Icon, IconButton, Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '@althar/ui'

import { type Artifact, REACH, type Reach } from '../artifacts'
import { chat, useChat } from '../chat'
import { live, useLive } from '../live'
import { momentOf } from '../moments'
import { useLab, useOpenSoon } from '../state'
import { Glyph } from './Glyph'
import { Keep } from './Keep'
import { Share } from './Share'
import { Switcher } from './Switcher'
import s from './chatbar.module.css'

/*
 * An artifact chat's top row. The chat is the artifact's, so the row is the
 * artifact's, not a task's: the way back, then the artifact (its name opens
 * every artifact on the project) and who sees it, a draft, shared or
 * published, where a task has its step. At the end, what's for the whole
 * artifact: its versions, open comments, where it lives in git, Share, the
 * canvas with the window to itself, and the rest. The canvas keeps only its
 * own: its pages and the view, zoom, and the tool bar.
 */

const REACHES: ReadonlyArray<Reach> = ['draft', 'shared', 'published']

export function ChatStart({
  back,
  onBack,
  artifact,
  task,
  onPick,
  room = false,
}: {
  /** Where the way back goes: the project, or every artifact. */
  back: string
  onBack: () => void
  artifact: Artifact
  /** The task whose chat it is: its artifacts come first in the switcher. */
  task: string | null
  onPick: (id: string) => void
  /** In the project's Artifacts, rather than beside a task's conversation. */
  room?: boolean
}) {
  const { d, m } = useLab()
  const [browsing, setBrowsing] = useOpenSoon(momentOf(d, m).switcher === true && !room)
  return (
    <div className={s.start}>
      <BackCrumb to={back} onBack={onBack} kbd="esc" />
      <span className={s.sep} aria-hidden>
        /
      </span>
      <Switcher artifact={artifact} task={task} onPick={onPick} open={browsing} onOpenChange={setBrowsing} />
      <ReachMenu artifact={artifact} />
    </div>
  )
}

/** Who sees it, as a tag: on a card or a row in the project's Artifacts. */
export function ReachTag({ reach }: { reach: Reach }) {
  return (
    <span className={s.reachTag} data-reach={reach}>
      <span className={s.reachDot} aria-hidden />
      {REACH[reach].label}
    </span>
  )
}

/** Who sees it, in place of a task's step: changed here, or in Share. */
function ReachMenu({ artifact }: { artifact: Artifact }) {
  useLive()
  const reach = live.reachOf(artifact)
  return (
    <Menu
      label="Who sees it"
      width={280}
      trigger={
        <button type="button" className={s.reach} data-reach={reach}>
          <span className={s.reachDot} aria-hidden />
          {REACH[reach].label}
        </button>
      }
    >
      <MenuRadioGroup label="Who sees it" value={reach} onChange={(value) => live.reach(artifact, value as Reach)}>
        {REACHES.map((one) => (
          <MenuRadioItem key={one} value={one} description={REACH[one].line}>
            {REACH[one].label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

export function ChatEnd({ artifact, talk, room = false }: { artifact: Artifact; talk: 'conversation' | 'pin'; room?: boolean }) {
  const { d, m } = useLab()
  const moment = momentOf(d, m)
  const { wide } = useChat()
  // A moment opens its popover on the artifact it opens with.
  const here = room ? moment.open === artifact.id : true
  const [sharing, setSharing] = useOpenSoon(moment.share === true && here)
  const [keeping, setKeeping] = useOpenSoon(moment.keep === true && here)
  return (
    <div className={s.end}>
      <Facts artifact={artifact} talk={talk} />
      <span className={s.rule} aria-hidden />
      <Keep artifact={artifact} open={keeping} onOpenChange={setKeeping} />
      <Share artifact={artifact} tone="head" open={sharing} onOpenChange={setSharing} />
      <span className={s.rule} aria-hidden />
      <IconButton
        icon={wide ? 'compress' : 'expand'}
        label={wide ? 'Bring the conversation back' : 'The canvas on its own'}
        tooltip="below"
        tooltipAlign="end"
        size="small"
        onClick={() => chat.wide(!wide)}
      />
      <Menu
        label="More"
        align="end"
        width={260}
        trigger={
          <button type="button" className={s.more} aria-label="More">
            <Glyph name="more" size={16} />
          </button>
        }
      >
        <MenuItem icon="pr" description="A workspace, a review and a pull request" onSelect={() => undefined}>
          Build it
        </MenuItem>
        {room && artifact.task !== null && artifact.found !== true && (
          <MenuItem icon="arrow" onSelect={() => undefined}>
            Open {artifact.task}
          </MenuItem>
        )}
        <MenuItem icon="copy" onSelect={() => undefined}>
          Duplicate
        </MenuItem>
        <MenuItem icon="download" onSelect={() => undefined}>
          Download
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="remove" onSelect={() => undefined}>
          Archive
        </MenuItem>
      </Menu>
    </div>
  )
}

/** Its version, with every one before; how many comments or pins are open on it. */
export function Facts({ artifact, talk }: { artifact: Artifact; talk: 'conversation' | 'pin' }) {
  const world = useLive()
  const version = live.version(artifact)
  const open = world.pins.filter((one) => one.spot.artifactId === artifact.id && one.state !== 'resolved').length
  return (
    <>
      <Menu
        label="Versions"
        align="end"
        trigger={
          <button type="button" className={s.version}>
            v{version}
            <Glyph name="down" size={10} />
          </button>
        }
      >
        {Array.from({ length: version }, (_, i) => version - i).map((one) => (
          <MenuItem key={one} hint={one === version ? 'Latest' : undefined} onSelect={() => undefined}>
            Version {one}
          </MenuItem>
        ))}
      </Menu>
      {open > 0 && (
        <span
          className={s.pins}
          title={`${open} open ${talk === 'pin' ? (open === 1 ? 'pin' : 'pins') : open === 1 ? 'comment' : 'comments'}`}
        >
          <Icon name="comment" size={13} />
          {open}
        </span>
      )}
    </>
  )
}
