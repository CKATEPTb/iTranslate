import type {DetectableLanguage} from '../languageDetection.ts'

const LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
  eng: 'en',
  en: 'en',
  english: 'en',
  rus: 'ru',
  ru: 'ru',
  russian: 'ru',
  ukr: 'ua',
  uk: 'ua',
  ua: 'ua',
  ukrainian: 'ua',
  deu: 'de',
  ger: 'de',
  de: 'de',
  german: 'de',
  fra: 'fr',
  fre: 'fr',
  fr: 'fr',
  french: 'fr',
}

export function normalizeDetectableLanguage(language: string): DetectableLanguage | null {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return null

  for (const part of normalized.split(/[,;]/)) {
    const token = part.trim()
    if (!token) continue

    const primary = token.split(/[-_\s]/)[0]
    const parsed = LANGUAGE_ALIASES[token] ?? LANGUAGE_ALIASES[primary]
    if (parsed) return parsed
  }

  return null
}

export function getLanguageSampleWeight(text: string): number {
  const letterPattern = /\p{L}/gu
  let letters = 0
  while (letters < 700 && letterPattern.exec(text)) {
    letters++
  }
  return letters
}
