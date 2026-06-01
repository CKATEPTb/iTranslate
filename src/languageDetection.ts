import {detectAll as detectTinyLanguages} from 'tinyld/light'

export type DetectableLanguage = 'en' | 'ru' | 'ua' | 'de' | 'fr'

type LanguageCandidate = {
  language: DetectableLanguage
  confidence: number
}

const LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
  eng: 'en',
  en: 'en',
  rus: 'ru',
  ru: 'ru',
  ukr: 'ua',
  uk: 'ua',
  ua: 'ua',
  deu: 'de',
  ger: 'de',
  de: 'de',
  fra: 'fr',
  fre: 'fr',
  fr: 'fr',
}

const TINY_LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
  eng: 'en',
  en: 'en',
  rus: 'ru',
  ru: 'ru',
  deu: 'de',
  de: 'de',
  fra: 'fr',
  fr: 'fr',
}

const TINY_LANGUAGES = ['en', 'ru', 'de', 'fr'] as const

const RUSSIAN_WORDS = new Set([
  'а', 'без', 'был', 'была', 'были', 'быть', 'вам', 'вас', 'ведь', 'весь', 'во', 'вот', 'все',
  'вы', 'где', 'да', 'для', 'до', 'его', 'ее', 'если', 'есть', 'еще', 'же', 'за', 'здесь', 'и',
  'из', 'или', 'как', 'когда', 'мне', 'может', 'мы', 'на', 'надо', 'нас', 'не', 'него', 'нет',
  'ни', 'но', 'ну', 'о', 'он', 'она', 'они', 'от', 'по', 'под', 'после', 'потому', 'при',
  'про', 'раз', 'с', 'сам', 'себе', 'себя', 'так', 'там', 'тебя', 'тем', 'теперь', 'то',
  'тогда', 'того', 'тоже', 'только', 'тот', 'тут', 'ты', 'у', 'уже', 'хоть', 'чего', 'чем',
  'через', 'что', 'чтобы', 'это', 'этого', 'этот', 'очень', 'я',
])

const RUSSIAN_DISTINCTIVE_WORDS = new Set([
  'его', 'ее', 'если', 'еще', 'здесь', 'как', 'когда', 'мне', 'надо', 'нет', 'они', 'очень', 'потому',
  'сейчас', 'тебя', 'теперь', 'тогда', 'того', 'только', 'уже', 'чего', 'чем', 'через', 'что',
  'чтобы', 'это', 'этого', 'этот',
])

const UKRAINIAN_WORDS = new Set([
  'а', 'аби', 'або', 'адже', 'але', 'без', 'був', 'була', 'були', 'бути', 'вам', 'вас', 'вже',
  'він', 'вона', 'вони', 'все', 'від', 'для', 'до', 'де', 'дуже', 'є', 'за', 'з', 'зі', 'і',
  'й', 'його', 'її', 'їм', 'їх', 'їй', 'коли', 'мене', 'мені', 'ми', 'може', 'на', 'нас', 'не',
  'нема', 'ніж', 'ні', 'ну', 'ось', 'після', 'по', 'про', 'себе', 'собі', 'так', 'там', 'та',
  'тебе', 'тепер', 'ти', 'тільки', 'тут', 'у', 'хто', 'це', 'цей', 'цього', 'цю', 'чи', 'чого',
  'чому', 'що', 'щоб', 'як', 'я',
])

const UKRAINIAN_DISTINCTIVE_WORDS = new Set([
  'аби', 'або', 'адже', 'але', 'був', 'від', 'він', 'вже', 'дуже', 'є', 'зі', 'його', 'її', 'їм',
  'їх', 'їй', 'коли', 'мене', 'мені', 'нема', 'ніж', 'ні', 'ось', 'після', 'собі', 'та', 'тебе',
  'тепер', 'тільки', 'хто', 'це', 'цей', 'цього', 'цю', 'чи', 'чому', 'що', 'щоб', 'як',
])

const ENGLISH_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'because',
  'been', 'being', 'but', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', "it's", 'me', 'my', 'not', 'of', 'on',
  'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'this', 'they',
  'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you',
  'your',
])

const GERMAN_WORDS = new Set([
  'aber', 'als', 'am', 'an', 'auch', 'auf', 'aus', 'bei', 'bin', 'bis', 'das', 'dass', 'dem',
  'den', 'der', 'des', 'die', 'du', 'ein', 'eine', 'einem', 'einen', 'einer', 'er', 'es', 'für',
  'haben', 'hat', 'ich', 'im', 'in', 'ist', 'mit', 'nach', 'nicht', 'noch', 'nur', 'oder', 'sie',
  'sich', 'so', 'und', 'von', 'war', 'was', 'wenn', 'wie', 'wir', 'zu',
])

const FRENCH_WORDS = new Set([
  'au', 'aux', 'avec', 'ce', 'ceci', 'cela', 'ces', 'cette', 'comme', 'dans', 'de', 'des', 'du',
  'elle', 'elles', 'en', 'est', 'et', 'il', 'ils', 'je', 'la', 'le', 'les', 'mais', 'ne', 'nous',
  'ou', 'où', 'pas', 'pour', 'que', 'qui', 'se', 'si', 'sur', 'un', 'une', 'vous',
])

const LATIN_WORD_SETS: Record<'en' | 'de' | 'fr', Set<string>> = {
  en: ENGLISH_WORDS,
  de: GERMAN_WORDS,
  fr: FRENCH_WORDS,
}

function normalizeTargetLanguage(language: string): DetectableLanguage | null {
  return LANGUAGE_ALIASES[language.toLowerCase()] ?? null
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length
}

function getLetterStats(text: string) {
  const letters = Array.from(text.matchAll(/\p{L}/gu), match => match[0])
  const cyrillic = letters.filter(letter => /\p{Script=Cyrillic}/u.test(letter)).length
  const latin = letters.filter(letter => /\p{Script=Latin}/u.test(letter)).length
  return {letters: letters.length, cyrillic, latin}
}

function tokenizeWords(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/\p{L}[\p{L}'’-]*/gu), match => match[0])
}

function scoreWords(words: string[], dictionary: Set<string>): number {
  return words.reduce((score, word) => score + (dictionary.has(word) ? 1 : 0), 0)
}

function getTinyCandidate(text: string): LanguageCandidate | null {
  const ranked = detectTinyLanguages(text, {only: [...TINY_LANGUAGES]})
    .map(({lang, accuracy}) => ({
      language: TINY_LANGUAGE_ALIASES[lang.toLowerCase()],
      accuracy,
    }))
    .filter((item): item is {language: DetectableLanguage; accuracy: number} => Boolean(item.language))
    .sort((a, b) => b.accuracy - a.accuracy)

  const top = ranked[0]
  if (!top) return null

  const secondAccuracy = ranked.find(item => item.language !== top.language)?.accuracy ?? 0
  const margin = top.accuracy - secondAccuracy
  const confidence = clamp(top.accuracy * 1.8 + margin * 1.2)

  if (top.accuracy < 0.05 && margin < 0.04) return null
  return {language: top.language, confidence}
}

function buildCyrillicCandidate(text: string, words: string[], tinyCandidate: LanguageCandidate | null): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const ruDistinctChars = countMatches(lower, /[ыэёъ]/gu)
  const uaDistinctChars = countMatches(lower, /[іїєґ]/gu)
  const ruWords = scoreWords(words, RUSSIAN_WORDS)
  const uaWords = scoreWords(words, UKRAINIAN_WORDS)
  const ruDistinctWords = scoreWords(words, RUSSIAN_DISTINCTIVE_WORDS)
  const uaDistinctWords = scoreWords(words, UKRAINIAN_DISTINCTIVE_WORDS)

  const tinyRuBoost = tinyCandidate?.language === 'ru'
    ? Math.min(uaDistinctChars + uaDistinctWords === 0 ? 0.58 : 0.42, tinyCandidate.confidence * 0.58)
    : 0

  const ruScore =
    Math.min(0.55, ruDistinctChars * 0.32) +
    Math.min(0.55, ruDistinctWords * 0.18) +
    Math.min(0.25, ruWords * 0.05) +
    tinyRuBoost

  const uaScore =
    Math.min(0.78, uaDistinctChars * 0.42) +
    Math.min(0.65, uaDistinctWords * 0.2) +
    Math.min(0.25, uaWords * 0.05)

  if (uaScore >= 0.5 && uaScore - ruScore >= 0.05) {
    return {language: 'ua', confidence: clamp(uaScore)}
  }

  if (ruScore >= 0.5 && ruScore - uaScore >= 0.08) {
    return {language: 'ru', confidence: clamp(ruScore)}
  }

  if (uaScore >= 0.72) return {language: 'ua', confidence: clamp(uaScore)}
  if (ruScore >= 0.72) return {language: 'ru', confidence: clamp(ruScore)}
  return null
}

function buildLatinCandidate(text: string, words: string[], tinyCandidate: LanguageCandidate | null): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const scores: Record<'en' | 'de' | 'fr', number> = {
    en: 0,
    de: countMatches(lower, /[äöüß]/gu) * 0.38,
    fr: countMatches(lower, /[àâæçéèêëîïôœùûüÿ]/gu) * 0.38,
  }

  for (const language of Object.keys(scores) as Array<'en' | 'de' | 'fr'>) {
    scores[language] += Math.min(0.62, scoreWords(words, LATIN_WORD_SETS[language]) * 0.16)
  }

  if (tinyCandidate?.language === 'en' || tinyCandidate?.language === 'de' || tinyCandidate?.language === 'fr') {
    scores[tinyCandidate.language] += Math.min(0.62, tinyCandidate.confidence * 0.62)
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[DetectableLanguage, number]>
  const [bestLanguage, bestScore] = ranked[0]
  const [, secondScore] = ranked[1]
  const margin = bestScore - secondScore

  if (bestScore >= 0.58 && margin >= 0.12) {
    return {language: bestLanguage, confidence: clamp(bestScore)}
  }

  if (tinyCandidate?.language === bestLanguage && tinyCandidate.confidence >= 0.62 && margin >= 0.06) {
    return {language: bestLanguage, confidence: clamp(bestScore)}
  }

  return null
}

function detectTextLanguageCandidate(text: string): LanguageCandidate | null {
  const trimmed = text.trim()
  if (trimmed.length < 3) return null

  const stats = getLetterStats(trimmed)
  if (stats.letters < 3) return null

  const words = tokenizeWords(trimmed)
  const tinyCandidate = getTinyCandidate(trimmed)
  const cyrillicRatio = stats.cyrillic / stats.letters
  const latinRatio = stats.latin / stats.letters

  if (cyrillicRatio >= 0.6) return buildCyrillicCandidate(trimmed, words, tinyCandidate)
  if (latinRatio >= 0.6) return buildLatinCandidate(trimmed, words, tinyCandidate)

  return null
}

export function detectTextLanguage(text: string): DetectableLanguage | null {
  return detectTextLanguageCandidate(text)?.language ?? null
}

export function isTextLikelyLanguage(text: string, language: string): boolean {
  const target = normalizeTargetLanguage(language)
  if (!target) return false

  const candidate = detectTextLanguageCandidate(text)
  return candidate?.language === target && candidate.confidence >= 0.58
}
