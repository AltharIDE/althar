// Throwaway: C, the same composer, small, travelling with you: what is said arrives in its field as it does in the conversation's, and its lower row says who it goes to.
import { ActionButton, Composer, DictationSetup, DictationTray, IconButton, Menu, MenuRadioGroup, MenuRadioItem } from '@althar/ui'

import { act, addressOf, COORDINATOR, joinText, toLine } from '../voice'
import { After, back, type View } from './common'
import s from './C.module.css'
import { useAboveComposer } from './place'

/** Who it goes to, in the composer's lower row where the model picker sits: the coordinator, where it started, or the task on screen. */
function ToPick({ view }: { view: View }) {
  const { session } = view
  const choices = [...new Set([COORDINATOR, session.origin, session.to, ...(view.here === null ? [] : [view.here.key])])]
  return (
    <Menu
      label="Who it goes to"
      placement="above"
      align="start"
      width={320}
      trigger={
        <ActionButton size="small" trailingIcon="chevronD" className={s.pick}>
          {view.to.kind === 'coordinator' ? 'To: Coordinator' : 'To: this task’s lead'}
        </ActionButton>
      }
    >
      <MenuRadioGroup label="Who it goes to" value={session.to} onChange={act.address}>
        {choices.map((key) => {
          const address = addressOf(key)
          return (
            <MenuRadioItem
              key={key}
              value={key}
              description={key === session.origin ? 'Where you started talking' : view.here?.key === key ? 'The task on screen' : undefined}
            >
              {toLine(address)}
            </MenuRadioItem>
          )
        })}
      </MenuRadioGroup>
    </Menu>
  )
}

export function C({ view, area }: { view: View; area: HTMLElement | null }) {
  const above = useAboveComposer(area, 16)
  const { session } = view
  if (!view.shown) return null
  const lingering = session.phase === 'sent' || session.phase === 'cancelled'
  const listening = session.phase === 'listening' || session.phase === 'paused'
  const interim = listening || session.phase === 'writing' ? joinText(view.settled, view.unsettled) : ''
  return (
    <div className={s.float} style={{ bottom: above }} data-overlay="">
      {lingering ? (
        <div className={s.after}>
          <After view={view} />
        </div>
      ) : (
        <>
          <div className={s.top}>
            <span className={s.where}>{toLine(view.to)}</span>
            <span className={s.grow} />
            {session.phase === 'listening' && <IconButton icon="hold" size="small" label="Pause" onClick={act.pause} />}
            <IconButton
              icon="corner"
              size="small"
              label={`Back to ${view.to.kind === 'coordinator' ? 'the conversation' : 'the task'}`}
              onClick={() => back(view.to)}
            />
            <IconButton icon="close" size="small" label="Throw it away" onClick={act.cancel} />
          </div>
          <Composer
            className={s.composer}
            value={session.phase === 'done' ? session.text : ''}
            onChange={(text) => session.phase === 'done' && act.edit(text)}
            onSubmit={() => act.send(session.to)}
            placeholder={`Tell ${view.to.who} something`}
            dictation={{
              elapsed: session.phase === 'listening' ? view.elapsed : null,
              levels: session.levels,
              interim,
              kbd: '⌘⇧D',
              busy: session.phase === 'writing',
              expanded: session.phase === 'failed',
              onStart: act.resume,
              onStop: act.stop,
            }}
            tray={
              session.phase === 'failed' && (
                <DictationTray
                  state={{ kind: DictationSetup.Failed, said: view.elapsed }}
                  onRetry={act.retry}
                  onDiscard={act.cancel}
                  onDismiss={act.cancel}
                />
              )
            }
            picker={<ToPick view={view} />}
          />
        </>
      )}
    </div>
  )
}
