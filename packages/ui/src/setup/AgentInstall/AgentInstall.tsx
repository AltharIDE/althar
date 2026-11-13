import { device } from '../../foundations/device'
import { BrandChip } from '../../foundations/Marks/Marks'
import type { Brand } from '../../foundations/brands/brands'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import type { PinnedDownload } from '../Runtimes/Runtimes'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './AgentInstall.module.css'

/*
 * An agent that isn't on this device, where its accounts would be: what is
 * missing, and, where Althar can fetch it, the way to have it, said plainly:
 * from where, about how big, checked, and kept apart from the person's own
 * tools. While it downloads it says so; if it didn't finish, why, and the
 * way to try again. The agent's own instructions are beside it either way,
 * and, for one installed by hand, a way to look for it again at once.
 */

export interface AgentInstallText {
  missing: (name: string) => string
  can: (name: string, size: string) => string
  canPinned: (name: string, size: string, pinned: PinnedDownload) => string
  cannot: (name: string) => string
  download: (name: string) => string
  downloading: (name: string, size: string) => string
  tryAgain: string
  yourself: string
  check: string
}

export const agentInstallText: AgentInstallText = {
  missing: (name) => `${name} isn’t on ${device.this}`,
  can: (name, size) => `${name}’s latest release, from GitHub, about ${size}.`,
  canPinned: (name, size, { from, version }) => `${name} ${version}, from ${from}, about ${size}.`,
  cannot: (name) => `Install ${name} with its own installer, then come back here.`,
  download: (name) => `Download ${name}`,
  downloading: (name, size) => `Downloading ${name}, about ${size}, and checking it…`,
  tryAgain: 'Try again',
  yourself: 'Install it yourself',
  check: 'Check again',
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
    /** The one version it fetches, from its maker rather than a latest release on GitHub. */
    pinned?: PinnedDownload
    state?: AgentInstallState
    /** Downloads it. Without it, there is no button. */
    onInstall?: () => void
    /** Opens the agent's own instructions. Without it, no such link. */
    onHelp?: () => void
    /** Looks for it again, for one the person installed themselves. Without it, no such button. */
    onCheck?: () => void
    /** Looking for it again now. */
    checking?: boolean
    text?: Partial<AgentInstallText>
  }
>

export function AgentInstall({
  name,
  brand,
  size,
  pinned,
  state = { kind: 'idle' },
  onInstall,
  onHelp,
  onCheck,
  checking = false,
  className,
  text,
  ...rest
}: AgentInstallProps) {
  const t = { ...agentInstallText, ...text }
  const can = size !== undefined && onInstall !== undefined
  // Looking again leads where there is nothing to download, and follows the download where there is.
  const check = onCheck && (
    <Button variant={can ? 'quiet' : 'default'} busy={checking} onClick={onCheck}>
      {t.check}
    </Button>
  )
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
            <p className={s.note}>{can ? (pinned === undefined ? t.can(name, size) : t.canPinned(name, size, pinned)) : t.cannot(name)}</p>
            <div className={s.ways}>
              {can ? (
                <Button variant="default" onClick={onInstall}>
                  {state.kind === 'failed' ? t.tryAgain : t.download(name)}
                </Button>
              ) : (
                check
              )}
              {onHelp && (
                <ActionButton icon="external" onClick={onHelp}>
                  {t.yourself}
                </ActionButton>
              )}
              {can && check}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
