import { useEffect, useState } from 'react'
import { QuitWork } from '@althar/ui'

import type { QuitQuestion } from '../../../main/quitWork'
import type { Host } from '../../data/services'

/*
 * Quit with work under way (DEV-118), wherever the window is: mounted once,
 * round the whole window, as Report a problem is. The main process asks it
 * what quitting would stop, and hears quit, keep working in the background,
 * or cancel.
 */

const isQuestion = (value: unknown): value is QuitQuestion => typeof value === 'object' && value !== null && 'work' in value

export function QuitDialog({ host }: { readonly host: Host }) {
  const [question, setQuestion] = useState<QuitQuestion | null>(null)
  const { quit } = host
  useEffect(() => quit?.onAsk((asked) => setQuestion(isQuestion(asked) ? asked : null)), [quit])
  if (quit === undefined || question === null) return null
  const answer = (said: 'quit' | 'background' | 'cancel') => {
    setQuestion(null)
    quit.answer(said)
  }
  return (
    <QuitWork
      work={question.work}
      background={question.background}
      {...(question.update === null ? {} : { update: question.update })}
      onQuit={() => answer('quit')}
      onBackground={() => answer('background')}
      onCancel={() => answer('cancel')}
    />
  )
}
