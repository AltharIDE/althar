import s from './Logo.module.css'

/*
 * Charrette's mark, as @charrette/ui draws it: the section through a
 * triangular scale ruler, bored, with a point of colour in the bore. Ink is
 * the text colour around it; the point is cobalt, or whatever --logo-point
 * says (the mast makes it lime over a dark panel). Decorative.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M12.42 5.53A15.36 15.36 0 0 0 19.89 18.47L19.47 19.2A15.36 15.36 0 0 0 4.53 19.2L4.11 18.47A15.36 15.36 0 0 0 11.58 5.53ZM10.2 14.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z"
        fillRule="evenodd"
      />
      <circle className={s.point} cx="12" cy="14.4" r="0.8" />
    </svg>
  )
}
