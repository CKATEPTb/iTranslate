import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

export class GoogleTranslator implements Translator {
  async translate(context: TranslateContext): Promise<string> {
    if (context.settings['google-key']) {
      return this.translateWithApiKey(context)
    }
    return this.translateWithFreeApi(context)
  }

  private async translateWithApiKey(context: TranslateContext): Promise<string> {
    const url = new URL('https://translation.googleapis.com/language/translate/v2')
    url.searchParams.set('key', context.settings['google-key'])

    const body: Record<string, string> = {
      q: context.text,
      target: mapLanguageCode(context.to),
      format: 'text'
    }
    if (context.from !== 'auto') {
      body.source = mapLanguageCode(context.from)
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new Error(`Google failed: ${response.status}`)
    }

    const payload = (await response.json()) as {data?: {translations?: Array<{translatedText?: string}>}}
    const translatedText = payload.data?.translations?.[0]?.translatedText?.trim()
    if (!translatedText) {
      throw new Error('Google returned empty translation')
    }
    return translatedText
  }

  private async translateWithFreeApi(context: TranslateContext): Promise<string> {
    const url = new URL('https://translate.googleapis.com/translate_a/single')
    url.searchParams.set('client', 'gtx')
    url.searchParams.set('sl', mapLanguageCode(context.from))
    url.searchParams.set('tl', mapLanguageCode(context.to))
    url.searchParams.set('dt', 't')
    url.searchParams.set('q', context.text)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Google failed: ${response.status}`)
    }

    const payload = (await response.json()) as unknown
    const translatedText = (Array.isArray(payload) ? (payload[0] as unknown[]) : [])
      .map((part) => (Array.isArray(part) ? String(part[0] ?? '') : ''))
      .join('')
      .trim()

    if (!translatedText) {
      throw new Error('Google returned empty translation')
    }
    return translatedText
  }
}
