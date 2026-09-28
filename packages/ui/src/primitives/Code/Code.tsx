import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './Code.module.css'

export type CodeProps = RootProps<'code', object>

/** Code in running text: a name, a path, a command. */
export function Code({ className, ...rest }: CodeProps) {
  return <code className={cx(s.code, className)} {...rest} />
}
