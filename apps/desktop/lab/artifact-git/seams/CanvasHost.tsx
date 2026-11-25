import { CanvasHost as AppCanvasHost, type CanvasHostProps } from '../../../src/renderer/features/canvases/CanvasHost'
import { shownOf } from '../data'
import { lab, useLab } from '../state'

export * from '../../../src/renderer/features/canvases/CanvasHost'

/*
 * The app's own CanvasHost, in the artifact's room, told which version to
 * show: the moment's, or the one the person stepped to. A version that came
 * from someone else in git doesn't move the canvas under the person's eyes;
 * the panel says it's there, with Show.
 */
export function CanvasHost(props: CanvasHostProps) {
  const s = useLab()
  return (
    <AppCanvasHost
      {...props}
      open={{ canvasId: props.open.canvasId, version: shownOf(s), follow: false }}
      onVersion={(version) => lab.set({ shown: version })}
    />
  )
}
