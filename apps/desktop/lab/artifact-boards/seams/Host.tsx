import { useState } from 'react'

import { Icon, IconButton, Menu, MenuItem } from '@althar/ui'

import { artifactOf } from '../artifacts'
import { live, useLive } from '../live'
import { momentOf, type Moment } from '../moments'
import { ArtifactCanvas } from '../parts/ArtifactCanvas'
import { Rule } from '../parts/Boards'
import { Keep } from '../parts/Keep'
import { Share } from '../parts/Share'
import { Switcher } from '../parts/Switcher'
import { roundOf, useLab, useOpenSoon } from '../state'
import h from './host.module.css'

/*
 * The lab's canvas beside a conversation (in place of
 * features/canvases/CanvasHost, for ThreadHost): an artifact as a canvas of
 * boards, with no bar over it. What it is floats top left (its name opens
 * every artifact on the project, A's browsing; then its pages and the view);
 * its version, comments, where it lives in git, Share and closing it, top
 * right. What is said on it goes to the conversation beside it (A), or
 * stays on a pin on the part (D).
 */

export interface OpenCanvas {
  readonly canvasId: string
  readonly version: number | null
  readonly follow: boolean
}

export interface CanvasHostProps {
  readonly threadId: string
  readonly open: OpenCanvas
  readonly draft: string | null
  readonly onVersion: (version: number) => void
  readonly onClose: () => void
}

export function CanvasHost({ open, onClose }: CanvasHostProps) {
  const { d, m } = useLab()
  // The moment's opening is for the canvas the moment opens with; one opened from the thread opens as it is.
  const moment = momentOf(d, m)
  return (
    <Panel
      key={`${open.canvasId}|${roundOf()}`}
      canvasId={open.canvasId}
      talk={d === 'd' ? 'pin' : 'conversation'}
      moment={moment}
      onClose={onClose}
    />
  )
}

/** Its version, with every one before; how many comments or pins are open on it. */
export function Facts({ artifactId, talk }: { artifactId: string; talk: 'conversation' | 'pin' }) {
  const world = useLive()
  const artifact = artifactOf(artifactId)
  const version = live.version(artifact)
  const open = world.pins.filter((one) => one.spot.artifactId === artifact.id && one.state !== 'resolved').length
  return (
    <>
      <Menu
        label="Versions"
        align="end"
        trigger={
          <button type="button" className={h.version}>
            v{version}
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
          className={h.pins}
          title={`${open} open ${talk === 'pin' ? (open === 1 ? 'pin' : 'pins') : open === 1 ? 'comment' : 'comments'}`}
        >
          <Icon name="comment" size={12} />
          {open}
        </span>
      )}
    </>
  )
}

export function Panel({
  canvasId,
  talk,
  moment,
  onClose,
}: {
  canvasId: string
  talk: 'conversation' | 'pin'
  moment: Moment
  onClose: () => void
}) {
  const [id, setId] = useState(canvasId)
  const [browsing, setBrowsing] = useOpenSoon(moment.switcher === true)
  const [sharing, setSharing] = useOpenSoon(moment.share === true)
  const [keeping, setKeeping] = useOpenSoon(moment.keep !== undefined)
  const artifact = artifactOf(id)
  return (
    <section
      className={h.panel}
      aria-label={artifact.title}
      onKeyDown={(event) => {
        // The canvas takes Escape first, for what is open on it; then it closes.
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
      }}
    >
      <ArtifactCanvas
        key={id}
        artifact={artifact}
        talk={talk}
        opening={id === canvasId ? moment.opening : {}}
        lead={
          <>
            <Switcher artifact={artifact} task="Gift a class" onPick={setId} open={browsing} onOpenChange={setBrowsing} />
            <Rule />
          </>
        }
        trail={
          <>
            <Facts artifactId={artifact.id} talk={talk} />
            <Rule />
            <Keep
              artifact={artifact}
              open={keeping}
              onOpenChange={setKeeping}
              {...(moment.keep === undefined ? {} : { start: moment.keep })}
            />
            <Share title={artifact.title} slug={artifact.name} tone="head" open={sharing} onOpenChange={setSharing} />
            <Rule />
          </>
        }
        close={<IconButton icon="close" label="Close" kbd="Esc" tooltip="below" size="small" onClick={onClose} />}
      />
    </section>
  )
}
