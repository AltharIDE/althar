/** Joins class names, skipping the ones that are off. Undefined when none are on, so no empty class attribute. */
export const cx = (...names: (string | false | null | undefined)[]): string | undefined => names.filter(Boolean).join(' ') || undefined
