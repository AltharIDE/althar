import { type FrameKind, type Refusal, refusalOf, type SignInService, signInOf } from './addresses'

/*
 * What a page beside the conversation may do, decided before Electron acts
 * (ADR-099): where a navigation, a redirect or a pop-up goes, which web
 * permissions it gets (none, but writing what the person copies), and what
 * becomes of a download. Pure, so each rule is tested on its own; pages.ts
 * hangs them on the page's session and contents.
 */

/** Where a navigation goes: on, refused where it was, or out to the person's browser for a sign-in. */
export type Verdict =
  | { readonly kind: 'go' }
  | { readonly kind: 'refuse'; readonly refusal: Refusal }
  | { readonly kind: 'sign-in'; readonly service: SignInService }

/** A navigation of the page or a frame in it, a redirect included: only web pages, and a sign-in of Althar's services goes outside. */
export const navigation = (address: string, where: FrameKind = 'top'): Verdict => {
  const refusal = refusalOf(address, where)
  if (refusal !== null) return { kind: 'refuse', refusal }
  // A frame that signs in (an embedded sign-in) is left alone: it can't take the page anywhere, and what it shows is the page's.
  const service = where === 'top' ? signInOf(address) : null
  return service === null ? { kind: 'go' } : { kind: 'sign-in', service }
}

/**
 * A pop-up the page opens (`window.open`, a link to a new tab): never a
 * window of its own. A web page opens in the same view; a sign-in in the
 * person's browser; anything else is refused.
 */
export const popUp = (address: string): Verdict => navigation(address, 'top')

/** What a refused permission is, in the person's words, where the page asked for something they'd notice; null for what pages only check. */
export type Asked =
  | 'camera'
  | 'microphone'
  | 'camera and microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'
  | 'MIDI devices'
  | 'screen'

/**
 * The one web permission a page gets: writing to the clipboard what the
 * person copies with a press (a docs page's Copy), sanitized, as any browser
 * lets a page. Every other request and check is refused: the camera, the
 * microphone, location, notifications, reading the clipboard, devices, the
 * screen, full screen, pointer lock and whatever Chromium adds later.
 */
export const allowed = (permission: string): boolean => permission === 'clipboard-sanitized-write'

/** What a refused request asked for, as the line under the bar says it; null where it needs no line. */
export const askedOf = (permission: string, mediaTypes: ReadonlyArray<string> = []): Asked | null => {
  switch (permission) {
    case 'media': {
      const video = mediaTypes.includes('video')
      const audio = mediaTypes.includes('audio')
      if (video && audio) return 'camera and microphone'
      if (video) return 'camera'
      return audio ? 'microphone' : null
    }
    case 'geolocation':
      return 'location'
    case 'notifications':
      return 'notifications'
    case 'clipboard-read':
      return 'clipboard'
    case 'midi':
    case 'midiSysex':
      return 'MIDI devices'
    case 'display-capture':
      return 'screen'
    default:
      return null
  }
}

/**
 * A download the page starts: never kept here. One from a web address is
 * offered to the person's browser, which keeps it where they keep
 * downloads; one made by the page itself (`blob:`, `data:`) can't go
 * anywhere else, and is only refused.
 */
export const downloadOffered = (address: string): string | null => (refusalOf(address) === null ? address : null)

/**
 * A file link pressed on a web page never becomes a navigation: Chromium
 * blocks it in the page and only says so in its console. That saying is
 * read, so the line under the bar says it too. A page can write the same
 * words to its console; all that does is show the same line.
 */
export const blockedFile = (level: string, message: string): boolean =>
  level === 'error' && message.startsWith('Not allowed to load local resource: file:')
