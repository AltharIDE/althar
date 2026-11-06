// Scrappy: a picture by its digest, as this server keeps it: the lead's shots and the crops comments carry.
export const PICTURE_SCHEME = 'althar-picture'
export const THUMB_WIDTH = 1120
export const pictureUrl = (digest: string, _smaller = false) => `/__shot/${digest}`
export const pictureAsked = () => null
