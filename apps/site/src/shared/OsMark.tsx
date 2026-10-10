/*
 * The desktop systems Althar runs on, and their own marks in the text's
 * colour. Tux's belly and eyes take --os-belly, the colour behind the mark.
 */

export type Os = 'mac' | 'windows' | 'linux'

export const OS_NAME: Record<Os, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }

/** The system this page is read on, when it is a desktop one; a phone or tablet says nothing. `?platform=` overrides it. */
export const detectOs = (): Os | null => {
  if (typeof navigator === 'undefined') return null
  const asked = new URLSearchParams(window.location.search).get('platform')
  if (asked === 'mac' || asked === 'windows' || asked === 'linux') return asked
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return null
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux'
  return null
}

/** A system's own mark, in the text's colour: Apple's, Windows' four panes, and Tux. */
export function OsMark({ id, size = 18 }: { id: Os; size?: number }) {
  if (id === 'mac')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z"
        />
      </svg>
    )
  if (id === 'windows')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {/* Tux: the body, the belly, the eyes, the beak and the feet. */}
      <path
        fill="currentColor"
        d="M12 1.6c-2.6 0-4.4 2.1-4.4 5 0 1.6-.6 2.7-1.6 4.2-1.3 2-2.4 4.2-2.4 6.6 0 2.7 3.6 4.9 8.4 4.9s8.4-2.2 8.4-4.9c0-2.4-1.1-4.6-2.4-6.6-1-1.5-1.6-2.6-1.6-4.2 0-2.9-1.8-5-4.4-5Z"
      />
      <path
        fill="var(--os-belly, var(--n-2))"
        d="M12 9.4c-2.4 0-4.2 3.2-4.2 6.6 0 2.4 1.9 3.8 4.2 3.8s4.2-1.4 4.2-3.8c0-3.4-1.8-6.6-4.2-6.6Z"
      />
      <circle cx="10.4" cy="6.2" r="1" fill="var(--os-belly, var(--n-2))" />
      <circle cx="13.6" cy="6.2" r="1" fill="var(--os-belly, var(--n-2))" />
      <path
        fill="#f2b33d"
        d="M10.2 8c.5.9 1.1 1.4 1.8 1.4s1.3-.5 1.8-1.4c-.6-.4-1.2-.6-1.8-.6s-1.2.2-1.8.6ZM4.2 20.6c1.1-1.2 2.6-1.6 3.8-1 .6.3.7 1.2.2 1.8-.8.9-2.9 1-4 .4-.3-.3-.2-.8 0-1.2ZM19.8 20.6c-1.1-1.2-2.6-1.6-3.8-1-.6.3-.7 1.2-.2 1.8.8.9 2.9 1 4 .4.3-.3.2-.8 0-1.2Z"
      />
    </svg>
  )
}
