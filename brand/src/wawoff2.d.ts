declare module 'wawoff2' {
  export function decompress(woff2: Uint8Array): Promise<Uint8Array>
}
