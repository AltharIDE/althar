import { Button } from '@althar/ui'

import { artifactOf, GIFT } from './artifacts'
import { live, useLive } from './live'
import { momentOf } from './moments'
import { ArtifactCanvas } from './parts/ArtifactCanvas'
import { roundOf } from './state'
import s from './lab.module.css'

/*
 * Gift a class as someone it was shared with sees it (D, 3): a page on the
 * web, at its link, with no Althar. Sam sees the boards and every pin, and
 * comments; what they say comes back to the boards in Althar, where the lead
 * can take it on.
 */

export function Shared() {
  useLive()
  const artifact = artifactOf(GIFT)
  return (
    <div className={s.shared}>
      <div className={s.address}>
        <span className={s.addressDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={s.addressField}>althar.link/kiln/{artifact.name}</span>
      </div>
      <header className={s.sharedHead}>
        <span className={s.sharedMark} aria-hidden>
          k
        </span>
        <span className={s.sharedTitle}>{artifact.title}</span>
        <span className={s.sharedFacts}>kiln · v{live.version(artifact)} · shared by you, 2 minutes ago</span>
        <span className={s.gap} />
        <span className={s.sharedWho}>
          <span className={s.face} data-ink="teal" aria-hidden>
            S
          </span>
          Commenting as Sam
        </span>
        <Button size="small">Open in Althar</Button>
      </header>
      <div className={s.sharedBody}>
        <ArtifactCanvas key={roundOf()} artifact={artifact} talk="conversation" guest opening={momentOf('d', 2).opening} />
      </div>
    </div>
  )
}
