import type {DetectableLanguage} from '../../languageDetection'

export type PageLanguageAnalysis = {
    sourceLanguage: DetectableLanguage
    mismatchRatio: number
    totalWeight: number
    mismatchWeight: number
}

type TextNodeWalker = (root: Node, visitText: (node: Text) => boolean | void) => boolean

type VisibleTextCollector = {
    walkTextNodesDeep: TextNodeWalker
    isTextNodeVisible(node: Text): boolean
    hasTranslatableText(text: string): boolean
}

type PageLanguageSampleCollector = VisibleTextCollector & {
    getSampleContainer(node: Text): Element | null
    maxSampleNodes: number
    maxVisibleTextNodes: number
    maxScannedTextNodes: number
    maxChars: number
}

type FastLanguageTextCollector = VisibleTextCollector & {
    maxVisibleTextNodes: number
    maxScannedTextNodes: number
    maxChars: number
}

type FastLetterStats = {
    letters: number
    latin: number
    cyrillic: number
}

export function normalizePageLanguageSampleText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

export function collectVisiblePageLanguageSamples(root: Node | null, options: PageLanguageSampleCollector): string[] {
    if (!root) return []

    const sampleParts = new Map<Element, string[]>()
    let collectedChars = 0
    let scannedTextNodes = 0
    let visibleTextNodes = 0

    options.walkTextNodesDeep(root, node => {
        const rawText = node.textContent?.trim() ?? ''
        if (!options.hasTranslatableText(rawText)) return

        scannedTextNodes++
        if (scannedTextNodes >= options.maxScannedTextNodes) return false
        if (collectedChars >= options.maxChars) return false

        if (!options.isTextNodeVisible(node)) return
        visibleTextNodes++
        if (visibleTextNodes > options.maxVisibleTextNodes) return false

        const value = normalizePageLanguageSampleText(node.nodeValue ?? '')
        if (!value || !options.hasTranslatableText(value)) return

        const container = options.getSampleContainer(node)
        if (!container) return

        const parts = sampleParts.get(container) ?? []
        parts.push(value)
        sampleParts.set(container, parts)
        collectedChars += value.length
    })

    const samples: string[] = []
    for (const parts of sampleParts.values()) {
        if (samples.length >= options.maxSampleNodes) break

        const sample = normalizePageLanguageSampleText(parts.join(' '))
        if (sample.length >= 12) {
            samples.push(sample)
        }
    }

    return samples
}

export function collectFastVisiblePageLanguageText(root: Node | null, options: FastLanguageTextCollector): string {
    if (!root) return ''

    const parts: string[] = []
    let collectedChars = 0
    let scannedTextNodes = 0
    let visibleTextNodes = 0

    options.walkTextNodesDeep(root, node => {
        const rawText = node.textContent?.trim() ?? ''
        if (!options.hasTranslatableText(rawText)) return

        scannedTextNodes++
        if (scannedTextNodes >= options.maxScannedTextNodes) return false
        if (collectedChars >= options.maxChars) return false

        if (!options.isTextNodeVisible(node)) return
        visibleTextNodes++
        if (visibleTextNodes > options.maxVisibleTextNodes) return false

        const value = normalizePageLanguageSampleText(node.nodeValue ?? '')
        if (!value || !options.hasTranslatableText(value)) return

        parts.push(value)
        collectedChars += value.length
    })

    return normalizePageLanguageSampleText(parts.join(' '))
}

function getFastLetterStats(text: string): FastLetterStats {
    const letterPattern = /\p{L}/gu
    const latinPattern = /\p{Script=Latin}/u
    const cyrillicPattern = /\p{Script=Cyrillic}/u
    let letters = 0
    let latin = 0
    let cyrillic = 0
    let match: RegExpExecArray | null

    while ((match = letterPattern.exec(text))) {
        const letter = match[0]
        letters++
        if (latinPattern.test(letter)) latin++
        else if (cyrillicPattern.test(letter)) cyrillic++
    }

    return {letters, latin, cyrillic}
}

function fastLanguageScriptMatches(language: DetectableLanguage, stats: FastLetterStats, minLetters: number): boolean {
    if (stats.letters < minLetters) return false

    const latinRatio = stats.latin / stats.letters
    const cyrillicRatio = stats.cyrillic / stats.letters
    return language === 'ru' || language === 'ua'
        ? cyrillicRatio >= 0.55
        : latinRatio >= 0.55
}

function guessFastLatinLanguage(text: string, documentLanguage: DetectableLanguage | null): DetectableLanguage {
    if (documentLanguage === 'en' || documentLanguage === 'de' || documentLanguage === 'fr') return documentLanguage

    const lower = text.toLowerCase()
    if (/[\u00e0-\u00e6\u00e7\u00e8-\u00ef\u00f4\u0153\u00f9-\u00fc\u00ff]/u.test(lower)) return 'fr'
    if (/[\u00e4\u00f6\u00fc\u00df]/u.test(lower)) return 'de'
    if (/\b(le|la|les|des|une|pour|que|qui|dans|avec)\b/u.test(lower)) return 'fr'
    if (/\b(der|die|das|und|nicht|mit|ich|ist|ein|eine)\b/u.test(lower)) return 'de'
    return 'en'
}

function guessFastCyrillicLanguage(text: string, documentLanguage: DetectableLanguage | null): DetectableLanguage {
    if (documentLanguage === 'ru' || documentLanguage === 'ua') return documentLanguage

    const lower = text.toLowerCase()
    if (/[\u0456\u0406\u0457\u0407\u0454\u0404\u0491\u0490]/u.test(lower)) return 'ua'
    return 'ru'
}

export function analyzeFastPageLanguage(
    text: string,
    targetLanguage: DetectableLanguage,
    documentLanguage: DetectableLanguage | null,
    minLetters: number,
): PageLanguageAnalysis | null {
    const stats = getFastLetterStats(text)
    if (stats.letters < minLetters) return null

    const latinRatio = stats.latin / stats.letters
    const cyrillicRatio = stats.cyrillic / stats.letters
    let sourceLanguage: DetectableLanguage | null = null
    let mismatchRatio = 0

    if (targetLanguage === 'ru' || targetLanguage === 'ua') {
        if (latinRatio >= 0.55) {
            sourceLanguage = guessFastLatinLanguage(text, documentLanguage)
            mismatchRatio = latinRatio
        } else if (
            documentLanguage &&
            documentLanguage !== targetLanguage &&
            fastLanguageScriptMatches(documentLanguage, stats, minLetters)
        ) {
            sourceLanguage = documentLanguage
            mismatchRatio = 0.65
        }
    } else if (cyrillicRatio >= 0.55) {
        sourceLanguage = guessFastCyrillicLanguage(text, documentLanguage)
        mismatchRatio = cyrillicRatio
    } else if (
        documentLanguage &&
        documentLanguage !== targetLanguage &&
        fastLanguageScriptMatches(documentLanguage, stats, minLetters)
    ) {
        sourceLanguage = documentLanguage
        mismatchRatio = 0.65
    }

    if (!sourceLanguage || sourceLanguage === targetLanguage) return null

    return {
        sourceLanguage,
        mismatchRatio,
        totalWeight: stats.letters,
        mismatchWeight: Math.round(stats.letters * mismatchRatio),
    }
}
