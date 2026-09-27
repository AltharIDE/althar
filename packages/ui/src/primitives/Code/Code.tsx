import type { ReactNode } from 'react'

import s from './Code.module.css'

/** Code in running text: a name, a path, a command. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={s.code}>{children}</code>
}
