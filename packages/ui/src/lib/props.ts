import type { ComponentPropsWithRef, JSX } from 'react'

/**
 * A component's own props, plus everything its root element takes that the
 * component does not already name: `ref`, `id`, `className`, `data-*`,
 * `aria-*`, handlers. The component spreads the rest onto its root, so a
 * consumer can label, measure, focus or test it without a wrapper.
 */
export type RootProps<E extends keyof JSX.IntrinsicElements, P> = P & Omit<ComponentPropsWithRef<E>, keyof P>
