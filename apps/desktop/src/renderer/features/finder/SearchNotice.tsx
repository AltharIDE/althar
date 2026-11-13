import { useEffect, useState } from 'react'
import { Button } from '@althar/ui'
import s from './one.module.css'

interface Notice {
  readonly message: string
  readonly retry: () => void
}
/** Outlives the palette: a failed command remains readable and recoverable. */
export function SearchNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    const onError = (event: Event) => setNotice((event as CustomEvent<Notice>).detail)
    window.addEventListener('althar-search-error', onError)
    return () => window.removeEventListener('althar-search-error', onError)
  }, [])
  if (notice === null) return null
  return (
    <div className={s.notice} role="alert">
      <span>{notice.message}</span>
      <Button
        size="small"
        variant="quiet"
        onClick={() => {
          setNotice(null)
          notice.retry()
        }}
      >
        Try again
      </Button>
      <Button size="small" variant="quiet" onClick={() => setNotice(null)}>
        Dismiss
      </Button>
    </div>
  )
}
