export type DetectableLanguage = 'en' | 'ru' | 'ua' | 'de' | 'fr'

type LanguageCandidate = {
  language: DetectableLanguage
  confidence: number
}

type LetterStats = {
  letters: number
  cyrillic: number
  latin: number
}

type LatinLanguage = 'en' | 'de' | 'fr'
type CyrillicLanguage = 'ru' | 'ua'

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

const COMMON_WORDS: Record<DetectableLanguage, Set<string>> = {
  ru: new Set([
    'а', 'без', 'был', 'была', 'были', 'быть', 'вам', 'вас', 'ведь', 'весь', 'во', 'вот', 'все',
    'вы', 'где', 'да', 'для', 'до', 'его', 'ее', 'если', 'есть', 'еще', 'же', 'за', 'здесь', 'и',
    'из', 'или', 'как', 'когда', 'мне', 'может', 'мы', 'на', 'надо', 'нас', 'не', 'него', 'нет',
    'ни', 'но', 'ну', 'о', 'он', 'она', 'они', 'от', 'по', 'под', 'после', 'потому', 'при',
    'про', 'раз', 'с', 'сам', 'себе', 'себя', 'так', 'там', 'тебя', 'тем', 'теперь', 'то',
    'тогда', 'того', 'тоже', 'только', 'тот', 'тут', 'ты', 'у', 'уже', 'хоть', 'чего', 'чем',
    'через', 'что', 'чтобы', 'это', 'этого', 'этот', 'очень', 'я',
  ]),
  ua: new Set([
    'а', 'аби', 'або', 'адже', 'але', 'без', 'був', 'була', 'були', 'бути', 'вам', 'вас', 'вже',
    'він', 'вона', 'вони', 'все', 'від', 'для', 'до', 'де', 'дуже', 'є', 'за', 'з', 'зі', 'і',
    'й', 'його', 'її', 'їм', 'їх', 'їй', 'коли', 'мене', 'мені', 'ми', 'може', 'на', 'нас', 'не',
    'нема', 'ніж', 'ні', 'ну', 'ось', 'після', 'по', 'про', 'себе', 'собі', 'так', 'там', 'та',
    'тебе', 'тепер', 'ти', 'тільки', 'тут', 'у', 'хто', 'це', 'цей', 'цього', 'цю', 'чи', 'чого',
    'чому', 'що', 'щоб', 'як', 'я',
  ]),
  en: new Set([
    'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'ask', 'at',
    'back', 'be', 'because', 'been', 'being', 'better', 'but', 'by', 'can', 'claude', 'could',
    'curious', 'did', 'do', 'does', 'door', 'early', 'for', 'from', 'get', 'good', 'had', 'has',
    'have', 'he', 'hello', 'her', 'his', 'i', 'if', 'in', 'input', 'is', 'it', "it's", 'its',
    'kind', 'may', 'me', 'miss', 'mom', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'overall',
    'page', 'project', 'she', 'so', 'software', 'sound', 'sounds', 'still', 'system', 'text',
    'thanks', 'thank', 'that', 'the', 'their', 'them', 'then', 'there', 'this', 'they', 'to',
    'translate', 'translation', 'wait', 'was', 'we', 'well', 'were', 'what', 'when', 'where',
    'which', 'who', 'will', 'with', 'working', 'yes', 'you', 'your',
  ]),
  de: new Set([
    'aber', 'als', 'am', 'an', 'auch', 'auf', 'aus', 'bei', 'bin', 'bis', 'das', 'dass', 'dem',
    'den', 'der', 'des', 'die', 'du', 'ein', 'eine', 'einem', 'einen', 'einer', 'er', 'es', 'für',
    'haben', 'hat', 'ich', 'im', 'in', 'ist', 'mit', 'nach', 'nicht', 'noch', 'nur', 'oder', 'sie',
    'sich', 'so', 'und', 'von', 'war', 'was', 'wenn', 'wie', 'wir', 'zu', 'zum', 'zur',
  ]),
  fr: new Set([
    'au', 'aux', 'avec', 'ce', 'ceci', 'cela', 'ces', 'cette', 'comme', 'dans', 'de', 'des', 'du',
    'elle', 'elles', 'en', 'est', 'et', 'il', 'ils', 'je', 'la', 'le', 'les', 'mais', 'ne', 'nous',
    'ou', 'où', 'pas', 'pour', 'que', 'qui', 'se', 'si', 'sur', 'un', 'une', 'vous',
  ]),
}

const DISTINCTIVE_WORDS: Partial<Record<DetectableLanguage, Set<string>>> = {
  ru: new Set([
    'его', 'ее', 'если', 'еще', 'здесь', 'как', 'когда', 'мне', 'надо', 'нет', 'они', 'очень', 'потому',
    'сейчас', 'тебя', 'теперь', 'тогда', 'того', 'только', 'уже', 'чего', 'чем', 'через', 'что',
    'чтобы', 'это', 'этого', 'этот',
  ]),
  ua: new Set([
    'аби', 'або', 'адже', 'але', 'був', 'від', 'він', 'вже', 'дуже', 'є', 'зі', 'його', 'її', 'їм',
    'їх', 'їй', 'коли', 'мене', 'мені', 'нема', 'ніж', 'ні', 'ось', 'після', 'собі', 'та', 'тебе',
    'тепер', 'тільки', 'хто', 'це', 'цей', 'цього', 'цю', 'чи', 'чому', 'що', 'щоб', 'як',
  ]),
}

const NGRAMS: Record<DetectableLanguage, string[]> = {
  en: [
    ' the ', ' and ', ' that ', ' you ', ' with ', ' have ', ' for ', ' not ', 'ing', 'ion',
    'ent', 'ers', 'ate', 'all', 'was', 'his', 'her', 'ter', 'ver', 'this', 'there',
  ],
  de: [
    ' der ', ' die ', ' das ', ' und ', ' nicht ', ' ich ', ' mit ', ' ein', 'sch', 'cht',
    'ung', 'chen', 'gen', 'den', 'dem', 'ist', 'sie', 'ver', 'auf', 'lich',
  ],
  fr: [
    ' le ', ' la ', ' les ', ' des ', ' que ', ' qui ', ' pour ', ' dans ', ' avec ', ' est ',
    'pas', 'une', 'aux', 'ait', 'ont', 'eur', 'eau', 'ment', 'tion', 'elle',
  ],
  ru: [
    ' что ', ' это ', ' как ', ' для ', ' его ', ' она ', ' они ', 'ого', 'ему', 'ими',
    'ать', 'еть', 'ный', 'ная', 'ние', 'ться', 'ого ', 'ему ', 'при', 'про',
  ],
  ua: [
    ' що ', ' це ', ' як ', ' для ', ' його ', ' вона ', ' вони ', 'від', 'ого', 'ому',
    'ими', 'ати', 'ити', 'ний', 'ція', 'ться', 'ємо', 'єте', 'ться', 'після',
  ],
}

const SUFFIXES: Partial<Record<DetectableLanguage, string[]>> = {
  en: ['ing', 'ed', 'ly', 'tion', 'ment', 'ness', 'able', 'ive'],
  de: ['ung', 'keit', 'chen', 'lich', 'isch', 'heit'],
  fr: ['ment', 'tion', 'ique', 'eaux', 'eux', 'euse', 'ais', 'ait'],
  ru: ['ого', 'ему', 'ыми', 'ий', 'ая', 'ое', 'ние', 'ться'],
  ua: ['ого', 'ому', 'ими', 'ій', 'ація', 'ість', 'ться', 'ємо'],
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

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count++
    index = text.indexOf(needle, index + Math.max(1, needle.length - 1))
  }
  return count
}

function getLetterStats(text: string): LetterStats {
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
  const normalized = text.toLowerCase().replaceAll('’', "'")
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalized))) {
    words.push(match[0])
  }

  return words
}

function uniqueWordMatches(words: string[], dictionary: Set<string>): number {
  let matches = 0
  for (const word of new Set(words)) {
    if (dictionary.has(word)) matches++
  }
  return matches
}

function suffixMatches(words: string[], suffixes: string[] | undefined): number {
  if (!suffixes) return 0

  let matches = 0
  for (const word of new Set(words)) {
    if (word.length < 5) continue
    if (suffixes.some(suffix => word.endsWith(suffix))) matches++
  }
  return matches
}

function ngramMatches(text: string, language: DetectableLanguage): number {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  return NGRAMS[language].reduce((score, signal) => score + Math.min(3, countOccurrences(normalized, signal)), 0)
}

function rankScores<T extends DetectableLanguage>(scores: Record<T, number>): Array<[T, number]> {
  return (Object.entries(scores) as Array<[T, number]>).sort((a, b) => b[1] - a[1])
}

function candidateFromScores<T extends DetectableLanguage>(
  scores: Record<T, number>,
  minScore: number,
  minMargin: number,
): LanguageCandidate | null {
  const [[bestLanguage, bestScore], [, secondScore = 0]] = rankScores(scores)
  const margin = bestScore - secondScore
  if (bestScore < minScore || margin < minMargin) return null
  return {language: bestLanguage, confidence: clamp(bestScore)}
}

function buildCyrillicCandidate(text: string, words: string[], stats: LetterStats): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const ruDistinctChars = countMatches(lower, /[ыэёъ]/gu)
  const uaDistinctChars = countMatches(lower, /[іїєґ]/gu)
  const commonRu = uniqueWordMatches(words, COMMON_WORDS.ru)
  const commonUa = uniqueWordMatches(words, COMMON_WORDS.ua)
  const distinctiveRu = uniqueWordMatches(words, DISTINCTIVE_WORDS.ru ?? new Set())
  const distinctiveUa = uniqueWordMatches(words, DISTINCTIVE_WORDS.ua ?? new Set())

  const scores: Record<CyrillicLanguage, number> = {
    ru:
      Math.min(0.5, ruDistinctChars * 0.3) +
      Math.min(0.5, distinctiveRu * 0.16) +
      Math.min(0.3, commonRu * 0.05) +
      Math.min(0.22, ngramMatches(text, 'ru') * 0.035) +
      Math.min(0.16, suffixMatches(words, SUFFIXES.ru) * 0.05),
    ua:
      Math.min(0.78, uaDistinctChars * 0.42) +
      Math.min(0.65, distinctiveUa * 0.2) +
      Math.min(0.3, commonUa * 0.05) +
      Math.min(0.24, ngramMatches(text, 'ua') * 0.04) +
      Math.min(0.18, suffixMatches(words, SUFFIXES.ua) * 0.05),
  }

  if (uaDistinctChars + distinctiveUa === 0 && stats.cyrillic >= 8) {
    scores.ru += commonRu > commonUa || distinctiveRu > 0 ? 0.42 : 0.34
  }

  return candidateFromScores(scores, 0.45, 0.06)
}

function buildLatinCandidate(text: string, words: string[]): LanguageCandidate | null {
  const lower = text.toLowerCase()
  const wordMatches: Record<LatinLanguage, number> = {
    en: uniqueWordMatches(words, COMMON_WORDS.en),
    de: uniqueWordMatches(words, COMMON_WORDS.de),
    fr: uniqueWordMatches(words, COMMON_WORDS.fr),
  }
  const accentScores: Record<LatinLanguage, number> = {
    en: 0,
    de: Math.min(0.7, countMatches(lower, /[äöüß]/gu) * 0.38),
    fr: Math.min(0.7, countMatches(lower, /[àâæçéèêëîïôœùûüÿ]/gu) * 0.38),
  }
  const scores: Record<LatinLanguage, number> = {
    en:
      Math.min(0.58, wordMatches.en * 0.13) +
      Math.min(0.34, ngramMatches(text, 'en') * 0.035) +
      Math.min(0.18, suffixMatches(words, SUFFIXES.en) * 0.05),
    de:
      accentScores.de +
      Math.min(0.58, wordMatches.de * 0.14) +
      Math.min(0.36, ngramMatches(text, 'de') * 0.04) +
      Math.min(0.2, suffixMatches(words, SUFFIXES.de) * 0.06),
    fr:
      accentScores.fr +
      Math.min(0.58, wordMatches.fr * 0.14) +
      Math.min(0.36, ngramMatches(text, 'fr') * 0.04) +
      Math.min(0.2, suffixMatches(words, SUFFIXES.fr) * 0.06),
  }

  const candidate = candidateFromScores(scores, 0.44, 0.1)
  if (candidate) return candidate

  const hasNonEnglishAccent = accentScores.de > 0 || accentScores.fr > 0
  if (!hasNonEnglishAccent && wordMatches.en >= 2 && wordMatches.en > wordMatches.de + wordMatches.fr) {
    return {language: 'en', confidence: clamp(Math.max(scores.en, 0.6))}
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

  if (cyrillicRatio >= 0.6) return buildCyrillicCandidate(trimmed, words, stats)
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
