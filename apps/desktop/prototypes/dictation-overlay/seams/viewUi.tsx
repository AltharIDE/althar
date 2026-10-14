// Throwaway: the kit as the project and task screens see it. The composer says it is on screen, by the thread it writes to; in E, a line over it says the words moved here, with a way back.
import { useEffect } from 'react'

import { Composer as KitComposer, type ComposerProps, Icon, LinkButton } from '@althar/ui'

import { addressOf, act, composerShown, useLive } from '../voice'
import s from './seams.module.css'

export * from '@althar/ui'

const fromWhom = (key: string) => {
  const from = addressOf(key)
  return from.kind === 'coordinator' ? 'the coordinator' : `“${from.name}”`
}

export function Composer(props: ComposerProps) {
  const key = (props.dictation as { __key?: string } | undefined)?.__key
  const live = useLive()
  useEffect(() => (key === undefined ? undefined : composerShown(key)), [key])
  const moved = live.idea === 'E' && key !== undefined && live.moved?.to === key ? live.moved : null
  if (moved === null) return <KitComposer {...props} />
  const line = (
    <p className={s.moved}>
      <Icon name="corner" size={12} />
      <span>
        Moved here from {fromWhom(moved.from)} when you opened {key?.startsWith('thread:') === true ? 'this task' : 'the conversation'}
      </span>
      <LinkButton onClick={act.moveBack}>Send it to {fromWhom(moved.from)} instead</LinkButton>
    </p>
  )
  return (
    <KitComposer
      {...props}
      above={
        <>
          {line}
          {props.above}
        </>
      }
    />
  )
}
