/*
 * Taking the person to a place in a task's conversation from elsewhere on its
 * screen, such as its Graph face: the block that holds an item (what started
 * a round, a step's report), found by the item's id (`data-item`) once the
 * conversation shows, reading earlier pages of the thread where the item is
 * further back than those read. Brought into the middle of the view and
 * given focus, so a screen reader goes there too.
 */

/** How many earlier pages it reads, at most, looking for an item: a hundred items each. */
const PAGES = 10
/** How many frames it waits for the conversation to show what it read. */
const FRAMES = 4

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const blockOf = (root: ParentNode, itemId: string) => root.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`)

/** The block for an item, once it shows: waiting a few frames for it, as the conversation draws what it read. */
const found = async (root: ParentNode, itemId: string): Promise<HTMLElement | null> => {
  for (let i = 0; i < FRAMES; i++) {
    const block = blockOf(root, itemId)
    if (block !== null) return block
    await frame()
  }
  return null
}

/**
 * Brings an item's block into view and gives it focus; reads earlier pages (`earlier`, which says whether there was one)
 * until it shows or there are none. Whether it was found.
 */
export async function reveal(itemId: string, earlier: () => Promise<boolean>, root: ParentNode = document): Promise<boolean> {
  for (let page = 0; page <= PAGES; page++) {
    const block = await found(root, itemId)
    if (block !== null) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      block.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      if (!block.hasAttribute('tabindex')) block.setAttribute('tabindex', '-1')
      block.focus({ preventScroll: true })
      return true
    }
    if (page === PAGES || !(await earlier())) return false
  }
  return false
}
