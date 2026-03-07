import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

export class LibreTranslateTranslator implements Translator {
  async translate(context: TranslateContext): Promise<string> {
    const body: Record<string, string> = {
      q: context.text,
      source: mapLanguageCode(context.from),
      target: mapLanguageCode(context.to),
      format: 'text'
    }
    if (context.settings['libre-key']) {
      body.api_key = context.settings['libre-key']
    }

    const response = await fetch(context.settings['libre-url'], {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`LibreTranslate failed: ${response.status}`)
    }

    const result = (await response.json()) as {translatedText?: string}
    const translatedText = result.translatedText?.trim()
    if (!translatedText) {
      throw new Error('LibreTranslate returned empty translation')
    }
    return translatedText
  }
}
