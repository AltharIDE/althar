// Scrappy: the little of vitest's `vi` the desktop tests' fixtures use, so their fake client runs in a browser.
type Fn = ((...args: never[]) => unknown) & {
  mockImplementation: (impl: (...args: never[]) => unknown) => Fn
  mockResolvedValue: (value: unknown) => Fn
}

const fn = (impl: (...args: never[]) => unknown = () => undefined): Fn => {
  let current = impl
  const mock = ((...args: never[]) => current(...args)) as Fn
  mock.mockImplementation = (next) => {
    current = next
    return mock
  }
  mock.mockResolvedValue = (value) => mock.mockImplementation(async () => value)
  return mock
}

export const vi = { fn }
