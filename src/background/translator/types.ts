export type TranslateContext = {
  text: string
  from: string
  to: string
  settings: Record<string, string>
}

export interface Translator {
  translate: (context: TranslateContext) => Promise<string>
}
