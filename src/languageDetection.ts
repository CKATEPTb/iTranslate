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
  'he', 'hello', 'her', 'his', 'i', 'if', 'in', 'input', 'is', 'it', 'its', "it's", 'kind', 'may',
  'me', 'miss', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'overall', 'page', 'she', 'so', 'software',
  'still', 'system', 'text', 'thanks', 'thank', 'that', 'the', 'their', 'them', 'then', 'there', 'this',
  'they', 'to', 'translate', 'translation', 'wait', 'was', 'we', 'well', 'were', 'what', 'when', 'where',
  'which', 'who', 'will', 'with', 'working', 'yes', 'you', 'your',
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
  if (!pattern.global && !pattern.sticky) return pattern.test(text) ? 1 : 0

  let count = 0
  pattern.lastIndex = 0
  while (pattern.exec(text)) {
    count++
  }
  pattern.lastIndex = 0
  return count
}

function getLetterStats(text: string) {
  const letterPattern = /\p{L}/gu
  const cyrillicPattern = /\p{Script=Cyrillic}/u
  const latinPattern = /\p{Script=Latin}/u
  let letters = 0
  let cyrillic = 0
  let latin = 0
  let match: RegExpExecArray | null

  while ((match = letterPattern.exec(text))) {
    const letter = match[0]
    letters++
    if (cyrillicPattern.test(letter)) cyrillic++
    else if (latinPattern.test(letter)) latin++
  }

  return {letters, cyrillic, latin}
}

function tokenizeWords(text: string): string[] {
  const pattern = /\p{L}[\p{L}'’-]*/gu
  const words: string[] = []
  const normalized = text.toLowerCase()
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalized))) {
    words.push(match[0])
  }

  return words
}

function scoreWords(words: string[], dictionary: Set<string>): number {
  return words.reduce((score, word) => score + (dictionary.has(word) ? 1 : 0), 0)
}

function buildCyrillicCandidate(text: string, words: string[]): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const ruDistinctChars = countMatches(lower, /[ыэёъ]/gu)
  const uaDistinctChars = countMatches(lower, /[іїєґ]/gu)
  const ruWords = scoreWords(words, RUSSIAN_WORDS)
  const uaWords = scoreWords(words, UKRAINIAN_WORDS)
  const ruDistinctWords = scoreWords(words, RUSSIAN_DISTINCTIVE_WORDS)
  const uaDistinctWords = scoreWords(words, UKRAINIAN_DISTINCTIVE_WORDS)

  const ruScriptFallback = uaDistinctChars + uaDistinctWords === 0 && (ruDistinctWords > 0 || ruWords > uaWords)
    ? 0.42
    : 0

  const ruScore =
    Math.min(0.55, ruDistinctChars * 0.32) +
    Math.min(0.55, ruDistinctWords * 0.18) +
    Math.min(0.35, ruWords * 0.07) +
    ruScriptFallback

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

function buildLatinCandidate(text: string, words: string[]): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const wordMatches: Record<'en' | 'de' | 'fr', number> = {
    en: 0,
    de: 0,
    fr: 0,
  }
  const scores: Record<'en' | 'de' | 'fr', number> = {
    en: 0,
    de: countMatches(lower, /[äöüß]/gu) * 0.38,
    fr: countMatches(lower, /[àâæçéèêëîïôœùûüÿ]/gu) * 0.38,
  }

  for (const language of Object.keys(scores) as Array<'en' | 'de' | 'fr'>) {
    wordMatches[language] = scoreWords(words, LATIN_WORD_SETS[language])
    scores[language] += Math.min(0.62, wordMatches[language] * 0.16)
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[DetectableLanguage, number]>
  const [bestLanguage, bestScore] = ranked[0]
  const [, secondScore] = ranked[1]
  const margin = bestScore - secondScore

  if (bestScore >= 0.48 && margin >= 0.12) {
    return {language: bestLanguage, confidence: clamp(bestScore)}
  }

  if (bestLanguage === 'en' && wordMatches.en >= 3 && margin >= 0.08) {
    return {language: 'en', confidence: clamp(Math.max(bestScore, 0.5))}
  }

  return null
}

function detectTextLanguageCandidate(text: string): LanguageCandidate | null {
  const trimmed = text.trim()
  if (trimmed.length < 3) return null

  const stats = getLetterStats(trimmed)
  if (stats.letters < 3) return null

  const words = tokenizeWords(trimmed)
  const cyrillicRatio = stats.cyrillic / stats.letters
  const latinRatio = stats.latin / stats.letters

  if (cyrillicRatio >= 0.6) return buildCyrillicCandidate(trimmed, words)
  if (latinRatio >= 0.6) return buildLatinCandidate(trimmed, words)

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
