import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

type LaraTranslateResponse = {
  status?: number
  content?: {
    translations?: Array<{
      translation?: string
    }>
  }
}

function toLaraTargetLanguage(code: string): string {
  switch (code) {
    case 'en':
      return 'en-US'
    case 'ru':
      return 'ru-RU'
    case 'uk':
      return 'uk-UA'
    case 'de':
      return 'de-DE'
    case 'fr':
      return 'fr-FR'
    default:
      return code
  }
}

export class LaraTranslator implements Translator {
  async translate(context: TranslateContext): Promise<string> {
    const source = context.from === 'auto' ? 'auto' : mapLanguageCode(context.from)
    const target = toLaraTargetLanguage(mapLanguageCode(context.to))

    const response = await fetch('https://webapi.laratranslate.com/translate/segmented', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-lara-client': 'Webapp'
      },
      body: JSON.stringify({
        q: context.text,
        source,
        target,
        instructions: [],
        style: 'faithful',
        adapt_to: [],
        glossaries: [],
        content_type: 'text/plain'
      })
    })

    if (!response.ok) {
      throw new Error(`Lara failed: ${response.status}`)
    }

    const result = (await response.json()) as LaraTranslateResponse
    const translatedText = result.content?.translations?.[0]?.translation?.trim()
    if (!translatedText) {
      throw new Error('Lara returned empty translation')
    }
    return translatedText
  }
}
