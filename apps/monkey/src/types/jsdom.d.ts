declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    window: Window & typeof globalThis
  }
}
