/** Whether the person asked their system for less motion. False where there is no window to ask. */
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
