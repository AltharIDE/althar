// Scrappy: C's Scratch: chats are conversations, so they sit with the coordinator's, as one chip over its composer.
import { Composer as RealComposer, type ComposerProps } from '../../../src/composer/Composer/Composer'
import { Popover } from '../../../src/primitives/Popover/Popover'
import { VIEWS } from '../directions'
import { CHATS, css, ScratchList } from '../parts'
import { proto, useProto } from '../state'

const toChat = () => {
  proto.go('scratch')
  window.location.hash = '#/threads/th1'
}

export function Composer(props: ComposerProps) {
  const p = useProto()
  if (VIEWS[p.direction].scratch !== 'talk') return <RealComposer {...props} />
  return (
    <RealComposer
      {...props}
      above={
        <>
          <Popover
            label="Scratch"
            placement="above"
            align="start"
            width={340}
            padded={false}
            defaultOpen={p.opening === 'scratch'}
            trigger={
              <button type="button" className={css.scratchChip}>
                Scratch <b>{CHATS.length}</b>
              </button>
            }
          >
            <div className={css.scratchHead}>
              <span className={css.scratchTitle}>Scratch</span>
              <span className={css.note}>Chats, by their latest exchange</span>
            </div>
            <ScratchList onOpen={toChat} />
          </Popover>
          {props.above}
        </>
      }
    />
  )
}
