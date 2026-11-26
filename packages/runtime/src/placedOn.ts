/** Where a proposed plan's parameters say it runs (ADR-103), and when that was chosen, as the plan card reads them. */
export const placedOn = (parameters: unknown): { readonly runsOn?: string; readonly runsOnChosenAt?: number } => {
  if (typeof parameters !== 'object' || parameters === null) return {}
  const { runsOn, runsOnChosenAt } = parameters as Record<string, unknown>
  return {
    ...(typeof runsOn === 'string' && runsOn !== '' ? { runsOn } : {}),
    ...(typeof runsOnChosenAt === 'number' ? { runsOnChosenAt } : {}),
  }
}
