import {detectTextLanguage} from '../languageDetection.ts'
import {normalizeProvider} from '../providers.ts'
import {getTranslator} from './translator'
import type {TranslateContext, Translator} from './translator/types.ts'
import {splitTranslationText} from './translationChunks.ts'

const PROVIDERS_WITH_NATIVE_AUTO_SOURCE = new Set(['Google', 'DeepL', 'LibreTranslate', 'Lara', 'OpenAI (Ollama)'])
const translatorCache = new Map<string, Translator>()

function getCachedTranslator(provider: string): Translator {
  let translator = translatorCache.get(provider)
  if (!translator) {
    translator = getTranslator(provider)
    translatorCache.set(provider, translator)
  }
  return translator
}

export function resolveSourceLanguage(text: string, requestedSource: string, provider: string): string {
  if (requestedSource !== 'auto') return requestedSource

  const detected = detectTextLanguage(text)
  if (detected) return detected

  if (PROVIDERS_WITH_NATIVE_AUTO_SOURCE.has(normalizeProvider(provider))) return 'auto'

  throw new Error('Could not detect source language automatically')
}

export async function translateWithProvider(provider: string, context: TranslateContext): Promise<string> {
  const chunks = splitTranslationText(context.text)
  const translator = getCachedTranslator(provider)
  if (chunks.length === 1) return translator.translate(context)

  const translatedChunks: string[] = []
  for (const chunk of chunks) {
    translatedChunks.push(chunk.trim() ? await translator.translate({...context, text: chunk}) : chunk)
  }

  return translatedChunks.join('')
}
