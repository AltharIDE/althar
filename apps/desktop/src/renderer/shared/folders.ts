/** A folder as the person would recognise it: under their home, from ~. */
export const shortFolder = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~')
