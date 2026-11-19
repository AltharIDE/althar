import { Component, createRef, type ReactNode } from 'react'

/*
 * What is shown while `open`, live; once it closes, a still picture of it
 * as it last was, for as long as it takes to fold away, then nothing. What
 * was live goes the moment it closes, so whatever it was doing stops then
 * (a sign-in under way, a timer), not once it has folded; opened again, it
 * starts afresh. The picture is a copy of its elements, inert: nothing in
 * it answers or runs.
 */

export interface AfterimageProps {
  open: boolean
  children: ReactNode
  /** How long the picture stays once it closes, in ms: the fold around it. */
  lasts: number
}

export class Afterimage extends Component<AfterimageProps> {
  private readonly live = createRef<HTMLDivElement>()
  private readonly still = createRef<HTMLDivElement>()
  private gone: number | undefined

  override getSnapshotBeforeUpdate(was: AfterimageProps): Node | null {
    // Closing: what was live, as it is on the page before it goes.
    return was.open && !this.props.open ? (this.live.current?.cloneNode(true) ?? null) : null
  }

  override componentDidUpdate(_was: AfterimageProps, _state: unknown, picture: Node | null) {
    const still = this.still.current
    if (this.props.open || still === null) {
      window.clearTimeout(this.gone)
      return
    }
    if (picture === null) return
    still.replaceChildren(picture)
    window.clearTimeout(this.gone)
    this.gone = window.setTimeout(() => still.replaceChildren(), this.props.lasts)
  }

  override componentWillUnmount() {
    window.clearTimeout(this.gone)
  }

  override render() {
    // Keyed apart, so neither is ever the other's element: opened again, the picture goes with its own.
    return this.props.open ? (
      <div key="live" ref={this.live}>
        {this.props.children}
      </div>
    ) : (
      <div key="still" ref={this.still} inert aria-hidden="true" />
    )
  }
}
