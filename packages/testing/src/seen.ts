/**
 * What a wait last read, for the error it gives up with: as JSON, each long text cut to its start and its end, so a
 * prompt's few thousand words don't push what comes after them, such as its state, out of the report.
 */
export const seen = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'string' && item.length > 160 ? `${item.slice(0, 80)}…${item.slice(-60)}` : item,
  )

/**
 * Where a wait was asked for, the first frame outside this package's source and its dependencies (`file:line:column`),
 * read once as it starts: with what it waits for, its error says which wait gave up, where a test has several that read
 * alike.
 */
export const calledFrom = () => {
  const frames = (new Error().stack ?? '').split('\n').slice(1)
  const outside = frames.find((frame) => /:\d+:\d+\)?$/.test(frame) && !/[\\/](packages[\\/]testing[\\/]src|node_modules)[\\/]/.test(frame))
  return outside === undefined ? undefined : (/\((.+)\)$/.exec(outside)?.[1] ?? outside.trim().replace(/^at /, ''))
}

/** The error a wait gives up with: which wait, and what it last read. */
export const timedOut = (what: string | undefined, where: string | undefined, value: unknown) =>
  new Error(
    `Timed out waiting${what === undefined ? '' : ` for ${what}`}${where === undefined ? '' : ` (at ${where})`}; last saw ${seen(value)}`,
  )
