/**
 * What a wait last read, for the error it gives up with: as JSON, each long text cut to its start and its end, so a
 * prompt's few thousand words don't push what comes after them, such as its state, out of the report.
 */
export const seen = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'string' && item.length > 160 ? `${item.slice(0, 80)}…${item.slice(-60)}` : item,
  )
