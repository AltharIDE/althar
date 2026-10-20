// Scrappy: the page's clock reads 11:20 this morning, and runs on from there, so "until 14:00 today" is true whenever the page is opened, and every picture says the same times. Imported first.
const Real = Date
const realNow = Real.now.bind(Real)

const morning = new Real(realNow())
morning.setHours(11, 20, 0, 0)
const shift = morning.getTime() - realNow()

class Shifted extends Real {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    if (args.length === 0) super(realNow() + shift)
    else super(...(args as [string]))
  }

  static override now(): number {
    return realNow() + shift
  }
}

globalThis.Date = Shifted as DateConstructor

/** Today, at this hour and minute, on the page's clock; `days` on from today. */
export const today = (hours: number, minutes = 0, days = 0): string => {
  const at = new Date()
  at.setDate(at.getDate() + days)
  at.setHours(hours, minutes, 0, 0)
  return at.toISOString()
}

/** The next Monday, at this hour. */
export const nextMonday = (hours: number): string => {
  const at = new Date()
  const ahead = (8 - at.getDay()) % 7 || 7
  at.setDate(at.getDate() + ahead)
  at.setHours(hours, 0, 0, 0)
  return at.toISOString()
}

/** A moment this many minutes before now, on the page's clock. */
export const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()
