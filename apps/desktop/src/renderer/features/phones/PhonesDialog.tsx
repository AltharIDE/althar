import { Dialog, Notice, PairPhone, PhoneList } from '@althar/ui'

import { useNow } from '../../shared/time'
import { phoneOf, usePairedPhones, usePairing } from './usePairing'
import s from './Phones.module.css'

/*
 * Pair a phone… from the homes menu: one dialog that pairs a phone with the
 * window's home and lists what it has paired with a code, each with Remove:
 * phones, and computers that connected the same way, which the home doesn't
 * tell apart. Done
 * closes it; Pair another phone makes a new code in place. Over it, until
 * the phone app is out, that it isn't in the app stores yet.
 */

export const soonText = {
  title: 'The Althar phone app isn’t in the app stores yet',
  body: 'It’s coming very soon.',
}

export interface PhonesDialogProps {
  /** The window's home, as the window names it: This Mac, or the remote home's name. */
  readonly home: string
  readonly onClose: () => void
}

export function PhonesDialog({ home, onClose }: PhonesDialogProps) {
  const phones = usePairedPhones()
  const pairing = usePairing(phones.paired)
  const now = useNow(false)
  const list = phones.devices ?? []
  return (
    <Dialog title={`Pair a phone with ${home}`} onClose={onClose} width={660}>
      <Notice icon="phone" title={soonText.title} className={s.soon}>
        {soonText.body}
      </Notice>
      <PairPhone
        home={home}
        state={pairing.state}
        {...(pairing.reach === null ? {} : { reach: pairing.reach })}
        onLetIn={pairing.letIn}
        {...(pairing.shutOut === undefined ? {} : { onShutOut: pairing.shutOut })}
        {...(pairing.shutProblem === null ? {} : { shutProblem: pairing.shutProblem })}
        onNewCode={pairing.again}
        onDone={onClose}
        onPairAnother={pairing.again}
      />
      {list.length > 0 && (
        <section className={s.paired}>
          <span className={s.pairedHead}>Paired with a code</span>
          <PhoneList home={home} phones={list.map((device) => phoneOf(device, now, phones.fresh))} onRemove={phones.remove} />
          {phones.problem !== null && <span className={s.problem}>{phones.problem}</span>}
        </section>
      )}
    </Dialog>
  )
}
