import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

export class MyMemoryTranslator implements Translator {
  async translate(context: TranslateContext): Promise<string> {
    const url = new URL('https://api.mymemory.translated.net/get')
    url.searchParams.set('q', context.text)
    url.searchParams.set('langpair', `${mapLanguageCode(context.from)}|${mapLanguageCode(context.to)}`)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`MyMemory failed: ${response.status}`)
    }

    const result = (await response.json()) as {responseData?: {translatedText?: string}}
    const translatedText = result.responseData?.translatedText?.trim()
    if (!translatedText) {
      throw new Error('MyMemory returned empty translation')
    }
    return translatedText
  }
}
