/* The app's picture address, for a page in a browser: the prototype's server answers it from Althar's artifact store. */
export * from '../../src/main/pictureAddress'

export const pictureUrl = (digest: string, _smaller = false) => `/pictures/${digest}`
