import type {TranslateContext, Translator} from '../types.ts'
import {mapLanguageCode} from '../language.ts'

export class OpenAITranslator implements Translator {
  async translate(context: TranslateContext): Promise<string> {
    const promptTemplate = context.settings['openai-prompt']
    const systemPrompt = promptTemplate
      .replaceAll('{FROM}', mapLanguageCode(context.from))
      .replaceAll('{TO}', mapLanguageCode(context.to))
    const baseUrl = context.settings['openai-url']
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`

    const headers: Record<string, string> = {'Content-Type': 'application/json'}
    if (context.settings['openai-key']) {
      headers.Authorization = `Bearer ${context.settings['openai-key']}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: context.settings['openai-model'],
        temperature: 0,
        messages: [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: context.text}
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI-compatible provider failed: ${response.status}`)
    }

    const result = (await response.json()) as {choices?: Array<{message?: {content?: string}}>}
    const translatedText = result.choices?.[0]?.message?.content?.trim()
    if (!translatedText) {
      throw new Error('OpenAI-compatible provider returned empty translation')
    }
    return translatedText
  }
}
