import { useState } from 'react'

import { Menu, MenuItem, SidePanel } from '@althar/ui'

import { artifactOf } from '../artifacts'
import { live, useLive } from '../live'
import { momentOf, type Moment } from '../moments'
import { ArtifactCanvas } from '../parts/ArtifactCanvas'
import { Keep } from '../parts/Keep'
import { Share } from '../parts/Share'
import { Switcher } from '../parts/Switcher'
import { roundOf, useLab, useOpenSoon } from '../state'
import h from './host.module.css'

/*
 * The lab's canvas beside a conversation (in place of
 * features/canvases/CanvasHost, for ThreadHost): an artifact as a canvas of
 * boards. Its name in the head opens every artifact on the project (A's
 * browsing); where it lives in git (Keep) and Share are in its head. What is said on it goes to the
 * conversation beside it (A), or stays on a pin on the part (D).
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
  const world = useLive()
  const [id, setId] = useState(canvasId)
  const [browsing, setBrowsing] = useOpenSoon(moment.switcher === true)
  const [sharing, setSharing] = useOpenSoon(moment.share === true)
  const [keeping, setKeeping] = useOpenSoon(moment.keep !== undefined)
  const artifact = artifactOf(id)
  const version = live.version(artifact)
  const pins = world.pins.filter((one) => one.spot.artifactId === artifact.id && one.state !== 'resolved').length
  return (
    <SidePanel
      label={artifact.title}
      onClose={onClose}
      className={h.panel}
      head={<Switcher artifact={artifact} task="Gift a class" onPick={setId} open={browsing} onOpenChange={setBrowsing} />}
      actions={
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
          {pins > 0 && (
            <span className={h.pins} title={`${pins} open on the boards`}>
              {pins} {talk === 'pin' ? (pins === 1 ? 'pin' : 'pins') : pins === 1 ? 'comment' : 'comments'}
            </span>
          )}
          <Keep
            artifact={artifact}
            open={keeping}
            onOpenChange={setKeeping}
            {...(moment.keep === undefined ? {} : { start: moment.keep })}
          />
          <Share title={artifact.title} slug={artifact.name} tone="head" open={sharing} onOpenChange={setSharing} />
        </>
      }
    >
      <ArtifactCanvas key={id} artifact={artifact} talk={talk} opening={id === canvasId ? moment.opening : {}} />
    </SidePanel>
  )
}
