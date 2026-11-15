import type { ThreadItem } from '@althar/contracts'

import type { Writer } from '../data'
import { latest, plan } from '../plan'
import { option, scenario, scenarioKey, stage } from '../state'

/*
 * The coordinator's conversation, as the chat option on show has it: the
 * request, the coordinator's answer with its plan, the talk that changed
 * it, and, once launched, the plan running. The plan's cards are drawn by
 * the option (index.tsx); here is only where each one sits.
 *
 * A plan card's kind says what it draws: `card` the plan whole, folded
 * where a later version took its place (A); `written` the plan written out,
 * always as it is now (B); `diff` what one version changed (B); `chip` a
 * version's line (C); `launched` the plan running, small (D).
 */

/** Why the plan is shaped as it is, as a list after the coordinator's line. */
const reasoned = (answer: string, reasons: ReadonlyArray<string>) => `${answer}\n\n${reasons.map((one) => `- ${one}`).join('\n')}`

export const chatItems = (write: Writer): ReadonlyArray<ThreadItem> => {
  const s = scenario()
  const p = plan.get()
  const picked = option.chat.get()
  const launched = stage.get() === 'run'
  const last = latest(p).n
  const out: ThreadItem[] =
    scenarioKey.get() === 'cloud'
      ? [
          write.you('Is anything still waiting on 0.9.0?', 'c_earlier_you', -340),
          write.says('No. It published this morning; the changelog task is fixing the time it shows.', 'c_earlier_says', -339),
        ]
      : [
          write.you('Is anything still waiting on the Stripe upgrade?', 'c_earlier_you', -340),
          write.says('No: #402 merged this morning and nothing else was waiting for it.', 'c_earlier_says', -339),
        ]
  out.push(write.you(s.asked, 'c_asked', -46))

  // The coordinator's answer: written out (B) says it in a line, the plan saying the rest; the others give their reasons.
  out.push(write.says(picked === 'b' ? s.answer : reasoned(s.answer, s.reasons), 'c_answer', -45.6))
  if (picked === 'a') out.push(write.plan('card', 1, 'c_plan_1', -45.5))
  if (picked === 'b') out.push(write.plan('written', last, 'c_plan', -45.5))
  if (picked === 'c') out.push(write.plan('chip', 1, 'c_plan_1', -45.5))

  for (const one of p.talk) {
    if (one.kind === 'you') {
      out.push(write.you(one.text, one.id, one.minute))
      continue
    }
    out.push(write.says(one.text, one.id, one.minute))
    if (one.version === null) continue
    if (picked === 'a') out.push(write.plan('card', one.version, `${one.id}_plan`, one.minute + 0.01))
    if (picked === 'b') out.push(write.plan('diff', one.version, `${one.id}_plan`, one.minute + 0.01))
    if (picked === 'c') out.push(write.plan('chip', one.version, `${one.id}_plan`, one.minute + 0.01))
  }
  // Beside the talk, the plan comes into the conversation once launched, as it runs.
  if (picked === 'd' && launched) out.push(write.plan('launched', last, 'c_launched', 0))
  return out.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
