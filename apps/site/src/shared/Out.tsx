/** The mark beside a link that leaves the site. */
export function Out({ size = 9 }: { size?: number }) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true">
      <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
