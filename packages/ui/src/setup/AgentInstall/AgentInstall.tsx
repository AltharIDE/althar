import { BrandChip } from '../../foundations/Marks/Marks'
import type { Brand } from '../../foundations/brands/brands'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './AgentInstall.module.css'

/*
 * An agent that isn't on this device, where its accounts would be: what is
 * missing, and, where Althar can fetch it, the way to have it, said plainly:
 * from where, about how big, checked, and kept apart from the person's own
 * tools. While it downloads it says so; if it didn't finish, why, and the
 * way to try again. The agent's own instructions are beside it either way.
 */

export interface AgentInstallText {
  missing: (name: string) => string
  can: (name: string, size: string) => string
  cannot: (name: string) => string
  download: (name: string) => string
  downloading: (name: string, size: string) => string
  tryAgain: string
  yourself: string
}

export const agentInstallText: AgentInstallText = {
  missing: (name) => `${name} isn’t on this Mac`,
  can: (name, size) =>
    `Althar can fetch ${name}’s latest release from GitHub, about ${size}, check it against the release, and keep it in its own folder. Your terminal stays as it is.`,
  cannot: (name) => `Install ${name} with its own installer, then come back here.`,
  download: (name) => `Download ${name}`,
  downloading: (name, size) => `Downloading ${name}, about ${size}, and checking it…`,
  tryAgain: 'Try again',
  yourself: 'Install it yourself',
}

/** Where a download stands: not started, under way, or stopped with a reason. */
export type AgentInstallState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'installing' }
  | { readonly kind: 'failed'; readonly why: string }

export type AgentInstallProps = RootProps<
  'section',
  {
    name: string
    brand?: Brand
    /** About how big the download is; without it, Althar can't fetch this one. */
    size?: string
    state?: AgentInstallState
    /** Downloads it. Without it, there is no button. */
    onInstall?: () => void
    /** Opens the agent's own instructions. Without it, no such link. */
    onHelp?: () => void
    text?: Partial<AgentInstallText>
  }
>

export function AgentInstall({
  name,
  brand,
  size,
  state = { kind: 'idle' },
  onInstall,
  onHelp,
  className,
  text,
  ...rest
}: AgentInstallProps) {
  const t = { ...agentInstallText, ...text }
  const can = size !== undefined && onInstall !== undefined
  return (
    <section aria-label={t.missing(name)} className={cx(s.install, className)} {...rest}>
      <BrandChip {...(brand === undefined ? {} : { brand })} size={44} className={s.chip} />
      <div className={s.words}>
        <h3 className={s.title}>{t.missing(name)}</h3>
        {state.kind === 'installing' && size !== undefined ? (
          <p className={s.busy} role="status">
            <Spinner size="small" />
            {t.downloading(name, size)}
          </p>
        ) : (
          <>
            {state.kind === 'failed' && (
              <p className={s.failed} role="alert">
                {state.why}
              </p>
            )}
            <p className={s.note}>{can ? t.can(name, size) : t.cannot(name)}</p>
            <div className={s.ways}>
              {can && (
                <Button variant="default" onClick={onInstall}>
                  {state.kind === 'failed' ? t.tryAgain : t.download(name)}
                </Button>
              )}
              {onHelp && (
                <ActionButton icon="external" onClick={onHelp}>
                  {t.yourself}
                </ActionButton>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
