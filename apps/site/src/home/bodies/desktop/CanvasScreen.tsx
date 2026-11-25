import {
  BackCrumb,
  CanvasLine,
  CanvasPanel,
  ChromeButton,
  Composer,
  Prose,
  TaskFace,
  TaskHeader,
  TaskMenu,
  TaskParts,
  TaskStatus,
  Thread,
  ThreadShellProvider,
  TitleBar,
  trackOf,
  Turn,
  You,
} from '@althar/ui'

import { SignInPage } from '../kit/CanvasAtWork'
import { Shot } from '../kit/Shot'
import { OPUS } from '../kit/world'
import s from './CanvasScreen.module.css'

/*
 * The gallery's canvas, drawn here rather than taken from the brand pack's
 * screenshot, so it shows the sign-in page the carousel builds (CanvasAtWork's
 * SignInPage, split, its brand on the left): a task's window as the app draws
 * it, its conversation asking for the page and then for the split, and the
 * canvas beside it at the version that answers. Framed as the brand pack
 * frames its windows (brand/scripts/screenshots.ts): 112px of the Aurora
 * wallpaper at night at the sides, 80 above, more below, at 1440 by 900.
 */

const none = () => {}
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
  { value: 'graph' as const, label: 'Graph', kbd: 'g' },
]
const SIGN_IN = { canvasId: 'cnv_signin', name: 'sign-in', title: 'Sign-in page', kind: 'html' } as const
const VERSIONS = ['Email and password, then Google and GitHub', 'Split: the brand on the left, the form on the right'] as const

/** `label`: what it shows, for someone who can't see it (the gallery's list). */
export function CanvasScreen({ label }: { label: string }) {
  return (
    <Shot w={1664} h={1144} label={label} className={s.shot}>
      <div className={s.stage}>
        <div className={s.window}>
          <TitleBar
            lights="drawn"
            end={
              <TaskHeader
                title="Build the sign-in page"
                status={TaskStatus.Running}
                state="Implementing"
                steps={trackOf(['Implement'], 0, 0, false).map((step) => ({ ...step, who: OPUS.name }))}
                took="12m"
                elapsed="12m"
                faces={FACES}
                face="talk"
                onFace={none}
                parts={
                  <TaskParts
                    parts={[
                      {
                        id: 'worktree',
                        icon: 'folder',
                        name: 'Worktree',
                        detail: '3 files changed',
                        facts: [['Branch', 'tally/sign-in-page']],
                      },
                    ]}
                    kinds={[]}
                  />
                }
                actions={
                  <>
                    <ChromeButton icon="play" label="Run" onClick={none} />
                    <TaskMenu onStop={none} onAbandon={none} />
                  </>
                }
              />
            }
          >
            <BackCrumb to="Tally" kbd="esc" title="Build the sign-in page" titleLevel={2} onBack={none} />
          </TitleBar>
          <div className={s.face}>
            <ThreadShellProvider value={{ openCanvas: none, openedCanvas: SIGN_IN.canvasId }}>
              <TaskFace
                panelWidth={660}
                panel={
                  <CanvasPanel
                    {...SIGN_IN}
                    version={2}
                    latest={2}
                    newer={null}
                    onVersion={none}
                    onComment={none}
                    onReload={none}
                    onClose={none}
                    fill
                  >
                    <SignInPage />
                  </CanvasPanel>
                }
                composer={<Composer value="" onChange={none} onSubmit={none} placeholder="Tell the lead" hint="/" />}
              >
                <Thread label="Build the sign-in page">
                  <You at="10:12">Build Tally’s sign-in page: email and password, and Google too.</You>
                  <Turn model={OPUS} at="10:19">
                    <Prose>Here it is: email and password, then Google and GitHub, and a way to sign up under them.</Prose>
                    <CanvasLine canvas={{ ...SIGN_IN, version: 1 }} action="published" note={VERSIONS[0]} />
                  </Turn>
                  <You at="10:26">Now split it: our brand on the left, the form on the right.</You>
                  <Turn model={OPUS} at="10:27">
                    <Prose>
                      Done: split, with the brand on the left. The form keeps its width, and what Tally does sits at the foot of the brand’s
                      side.
                    </Prose>
                    <CanvasLine canvas={{ ...SIGN_IN, version: 2 }} action="published" note={VERSIONS[1]} />
                  </Turn>
                </Thread>
              </TaskFace>
            </ThreadShellProvider>
          </div>
        </div>
      </div>
    </Shot>
  )
}
