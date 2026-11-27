import { device } from '../../foundations/device'
import { BrandChip } from '../../foundations/Marks/Marks'
import type { Brand } from '../../foundations/brands/brands'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Problem } from '../../primitives/Problem/Problem'
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
 * and, for one installed by hand, a way to look for it again at once. One
 * Althar alone fetches, whose maker has no build for this device, says so,
 * and nothing more: there is nothing to install.
 */

export interface AgentInstallText {
  missing: (name: string) => string
  can: (name: string, size: string) => string
  canPinned: (name: string, size: string, pinned: PinnedDownload) => string
  cannot: (name: string) => string
  noBuild: (name: string) => string
  notHere: (name: string) => string
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
  noBuild: (name) => `There’s no build of ${name} for ${device.this}, so it can’t run here.`,
  notHere: (name) => `Althar can’t download ${name} from this window.`,
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
    /** Its maker publishes no build for this device, and nothing else installs it: it says so, with nothing to press. */
    noBuild?: boolean
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
  noBuild = false,
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
        {noBuild ? (
          <p className={s.note}>{t.noBuild(name)}</p>
        ) : state.kind === 'installing' && size !== undefined ? (
          <p className={s.busy} role="status">
            <Spinner size="small" />
            {t.downloading(name, size)}
          </p>
        ) : (
          <>
            {state.kind === 'failed' && <Problem>{state.why}</Problem>}
            {/* Only one with its own installer, its instructions beside it, is sent to install it. */}
            <p className={s.note}>
              {can
                ? pinned === undefined
                  ? t.can(name, size)
                  : t.canPinned(name, size, pinned)
                : onHelp === undefined
                  ? t.notHere(name)
                  : t.cannot(name)}
            </p>
            <div className={s.ways}>
              {can ? (
                <Button variant="default" onClick={onInstall}>
                  {state.kind === 'failed' ? t.tryAgain : t.download(name)}
                </Button>
              ) : (
                check
              )}
              {onHelp && (
                // First in its row, where there is nothing to download or check, its glyph lines up with the words over it.
                <ActionButton icon="external" {...(can || check ? {} : { flush: 'start' as const })} onClick={onHelp}>
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
