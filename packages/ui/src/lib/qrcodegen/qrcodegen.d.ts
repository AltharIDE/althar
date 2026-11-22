/* The part of the vendored QR encoder (qrcodegen.js) the lab uses. */
export declare namespace qrcodegen {
  class QrCode {
    static encodeText(text: string, ecl: QrCode.Ecc): QrCode
    readonly version: number
    readonly size: number
    getModule(x: number, y: number): boolean
  }
  namespace QrCode {
    class Ecc {
      static readonly LOW: Ecc
      static readonly MEDIUM: Ecc
    }
  }
}
