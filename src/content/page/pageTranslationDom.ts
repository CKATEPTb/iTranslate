import {
    getSelectionBlockForNode,
    hasTranslatableTextDeep as hasTranslatableTextDeepBase,
    isDocumentScopeElement,
    isTextNodeVisible as isTextNodeVisibleBase,
    walkOpenShadowRootsDeep as walkOpenShadowRootsDeepBase,
    walkTextNodesDeep as walkTextNodesDeepBase,
} from '../dom/domUtils'
import type {DetectableLanguage} from '../../languageDetection'
import {parsePromptLanguage} from './pagePromptCopy'
import {
    analyzeFastPageLanguage,
    collectFastVisiblePageLanguageText as collectFastVisiblePageLanguageTextBase,
    collectVisiblePageLanguageSamples as collectVisiblePageLanguageSamplesBase,
    type PageLanguageAnalysis,
} from './pageLanguageAnalysis'
import {hasTranslatableText} from './pageTextUtils'
import {
    PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS,
    PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES,
    PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
    PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS,
    PAGE_TRANSLATION_SUGGESTION_MAX_CHARS,
    PAGE_TRANSLATION_SUGGESTION_MAX_NODES,
    PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES,
    PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
} from './pageTranslationConfig'

type ShouldSkipElement = (element: Element) => boolean

export function normalizeSiteHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^www\./, '')
}

export class PageTranslationDomAdapter {
    private readonly shouldSkipElement: ShouldSkipElement

    constructor(shouldSkipElement: ShouldSkipElement) {
        this.shouldSkipElement = shouldSkipElement
    }

    walkTextNodesDeep(root: Node, visitText: (node: Text) => boolean | void): boolean {
        return walkTextNodesDeepBase(root, visitText, this.shouldSkipElement)
    }

    walkOpenShadowRootsDeep(root: Node, visitShadowRoot: (root: ShadowRoot) => void) {
        walkOpenShadowRootsDeepBase(root, visitShadowRoot, this.shouldSkipElement)
    }

    hasTranslatableTextDeep(root: Node): boolean {
        return hasTranslatableTextDeepBase(root, hasTranslatableText, this.shouldSkipElement)
    }

    isTextNodeVisible(node: Text): boolean {
        return isTextNodeVisibleBase(node, this.shouldSkipElement)
    }

    getDocumentLanguageHint(): DetectableLanguage | null {
        const candidates = [
            document.documentElement.getAttribute('lang'),
            document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content'),
            document.querySelector('meta[name="language" i]')?.getAttribute('content'),
        ]

        for (const candidate of candidates) {
            const parsed = parsePromptLanguage(candidate)
            if (parsed) return parsed
        }

        return null
    }

    collectVisiblePageLanguageSamples(): string[] {
        return collectVisiblePageLanguageSamplesBase(document.body, {
            walkTextNodesDeep: (root, visitText) => this.walkTextNodesDeep(root, visitText),
            isTextNodeVisible: node => this.isTextNodeVisible(node),
            hasTranslatableText,
            getSampleContainer: node => this.getPageLanguageSampleContainer(node),
            maxSampleNodes: PAGE_TRANSLATION_SUGGESTION_MAX_NODES,
            maxVisibleTextNodes: PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
            maxScannedTextNodes: PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES,
            maxChars: PAGE_TRANSLATION_SUGGESTION_MAX_CHARS,
        })
    }

    collectFastVisiblePageLanguageText(): string {
        return collectFastVisiblePageLanguageTextBase(document.body, {
            walkTextNodesDeep: (root, visitText) => this.walkTextNodesDeep(root, visitText),
            isTextNodeVisible: node => this.isTextNodeVisible(node),
            hasTranslatableText,
            maxVisibleTextNodes: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
            maxScannedTextNodes: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES,
            maxChars: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS,
        })
    }

    analyzeFastVisiblePageLanguage(targetLanguage: DetectableLanguage): PageLanguageAnalysis | null {
        return analyzeFastPageLanguage(
            this.collectFastVisiblePageLanguageText(),
            targetLanguage,
            this.getDocumentLanguageHint(),
            PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS,
        )
    }

    private getPageLanguageSampleContainer(node: Text): Element | null {
        const block = getSelectionBlockForNode(node)
        if (block && !isDocumentScopeElement(block)) return block

        return node.parentElement
    }
}
