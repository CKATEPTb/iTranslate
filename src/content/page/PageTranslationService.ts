import {autoUpdate, computePosition, flip, offset, shift, type VirtualElement} from '@floating-ui/dom'
import {
    closestElementDeep,
    getSelectionBlockForNode,
    getTextNodeAnchorRect,
    getTextNodeElement,
    hasTranslatableTextDeep as hasTranslatableTextDeepBase,
    isDocumentScopeElement,
    isTextNodeVisible as isTextNodeVisibleBase,
    walkOpenShadowRootsDeep as walkOpenShadowRootsDeepBase,
    walkTextNodesDeep as walkTextNodesDeepBase,
} from '../dom/domUtils'
import type {TooltipController} from '../ui/FloatingTooltip'
import type {DetectableLanguage} from '../../languageDetection'
import {
    getPageTranslationPromptCopy,
    normalizePromptLanguage,
    parsePromptLanguage,
} from './pagePromptCopy'
import {getPageTranslationPromptStyle} from './pagePromptStyle'
import {
    analyzeFastPageLanguage,
    collectFastVisiblePageLanguageText as collectFastVisiblePageLanguageTextBase,
    collectVisiblePageLanguageSamples as collectVisiblePageLanguageSamplesBase,
    type PageLanguageAnalysis,
} from './pageLanguageAnalysis'
import {hasTranslatableText, splitPreservingWhitespace} from './pageTextUtils'
import {PageTranslationMemory} from './pageTranslationMemory'
import {PageTranslationWorkQueue} from './pageTranslationWorkQueue'

type TranslateMode = 'selection' | 'input' | 'page'
type TranslateResponse = { ok: true; translatedText: string; skipped?: boolean } | { ok: false; error?: string }
type RuntimeMessageResult<T> = {response?: T; error?: string; contextInvalidated?: boolean}

type TranslationStatusKey = 'input' | 'page'

type PageTranslationServiceOptions = {
    sendRuntimeMessage<T>(message: unknown): Promise<RuntimeMessageResult<T>>
    translateWithResponse(text: string, mode: TranslateMode, fromOverride?: string): Promise<TranslateResponse>
    showStatus(key: TranslationStatusKey, message: string): void
    hideStatus(key: TranslationStatusKey): void
    handleRuntimeError(error: unknown): boolean
    isRuntimeValid(): boolean
    getTooltip(): TooltipController
}

let pageDeps: PageTranslationServiceOptions | null = null

function getPageDeps(): PageTranslationServiceOptions {
    if (!pageDeps) throw new Error('PageTranslationService has not been initialized')
    return pageDeps
}

const TOOLTIP_ID = 'itranslate-tooltip'
const STATUS_ID = 'itranslate-status'
const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'
const PAGE_TRANSLATION_PROMPT_ID = 'itranslate-page-translation-prompt'
const PAGE_TRANSLATION_PROMPT_STYLE_ID = 'itranslate-page-translation-prompt-style'
const PAGE_STATUS_CLASS = 'itranslate-page-status'
const PAGE_STATUS_STYLE_ID = 'itranslate-page-status-style'
const PAGE_TRANSLATION_CONCURRENCY = 3
const PAGE_TRANSLATION_MUTATION_RESCAN_DELAY_MS = 350
const PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS = 2200
const PAGE_TRANSLATION_ACTIVE_RESCAN_MAX_INTERVAL_MS = 6000
const PAGE_TRANSLATION_ACTIVE_RESCAN_RECENT_COLLECT_MS = 1200
const PAGE_ORIGINAL_TOOLTIP_DELAY_MS = 1250
const PAGE_TRANSLATION_SUGGESTION_THRESHOLD = 0.05
const PAGE_TRANSLATION_SUGGESTION_MAX_NODES = 140
const PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES = 800
const PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES = 5000
const PAGE_TRANSLATION_SUGGESTION_MAX_CHARS = 9000
const PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS = 80
const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES = 800
const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES = 80
const PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS = 2200
const PAGE_TRANSLATION_SUGGESTION_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000]
const PAGE_TRANSLATION_PROMPT_TIMEOUT_MS = 12000
const PAGE_TRANSLATION_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_STATUS_CLASS}`,
    'script',
    'style',
    'noscript',
    'textarea',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    'canvas',
    '[aria-hidden="true"]',
].join(',')
const PAGE_TRANSLATION_PLACEHOLDER_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_STATUS_CLASS}`,
    'script',
    'style',
    'noscript',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    'canvas',
    '[aria-hidden="true"]',
].join(',')

type PageTranslationStateResponse = { ok: boolean; enabled?: boolean; sourceLanguage?: string; error?: string }
type PageTranslationSuggestSettingsResponse = {
    ok: boolean
    supported?: boolean
    target?: string
    hostname?: string
    never?: boolean
    alwaysFrom?: string[]
    error?: string
}
type PageTranslationAnalyzeSamplesResponse = { ok: boolean; analysis?: PageLanguageAnalysis | null; error?: string }
type PageTranslationAnalyzeSamplesRequest = {
    type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES'
    target: DetectableLanguage
    samples: string[]
    documentLanguage?: DetectableLanguage
}
type PageTranslationSetSitePreferenceResponse = {
    ok: boolean
    hostname?: string
    never?: boolean
    alwaysFrom?: string[]
    error?: string
}

type PageTextMeta = {
    runId: number
    sourceText: string
    sourceValue: string
    translatedValue: string
    translatedText: string
}

type PageTranslationStatus = {
    el: HTMLElement
    textEl: HTMLElement
    cleanup: (() => void) | null
    hideTimer: number | null
}
type PagePlaceholderElement = HTMLInputElement | HTMLTextAreaElement
type PagePlaceholderMeta = {
    runId: number
    sourceText: string
    sourceValue: string
    translatedValue: string
    translatedText: string
}

let pageTranslationEnabled = false
let pageTranslationObserver: MutationObserver | null = null
let pageTranslationSuggestionObserver: MutationObserver | null = null
let pageTranslationVisibilityObserver: IntersectionObserver | null = null
let pageTranslationRunId = 0

const pageTranslationTextQueue = new PageTranslationWorkQueue<Text>()
const pageTranslationPlaceholderQueue = new PageTranslationWorkQueue<PagePlaceholderElement>()
const pageTranslationMemory = new PageTranslationMemory()
const pageTranslationMeta = new WeakMap<Text, PageTextMeta>()
const pageTranslationPlaceholderMeta = new WeakMap<PagePlaceholderElement, PagePlaceholderMeta>()
const pageTranslationNodes = new Set<Text>()
const pageTranslationPlaceholderElements = new Set<PagePlaceholderElement>()
const pageTranslationObserved = new Map<Element, Set<Text>>()
const pageTranslationObservedPlaceholders = new Set<PagePlaceholderElement>()
const pageTranslationShadowRoots = new Set<ShadowRoot>()
const pageTranslationSuggestionShadowRoots = new Set<ShadowRoot>()
const pageTranslationStatuses = new WeakMap<Text, PageTranslationStatus>()
const pageTranslationStatusNodes = new Set<Text>()
let pageTranslationVisibilityFrame: number | null = null
let pageTranslationSuggestionTimer: number | null = null
let pageTranslationSuggestionRetryCount = 0
let pageTranslationSuggestionDismissed = false
let pageTranslationPromptEl: HTMLElement | null = null
let pageTranslationPromptProgressEl: HTMLElement | null = null
let pageTranslationPromptCountdownFrame: number | null = null
let pageTranslationPromptCountdownDeadline = 0
let pageTranslationPromptThemeListenerInstalled = false
let pageOriginalTooltipTimer: number | null = null
let pageOriginalTooltipHideTimer: number | null = null
let pageOriginalTooltipPendingNode: Text | null = null
let pageOriginalTooltipVisibleNode: Text | null = null
let pageOriginalTooltipPendingText = ''
let pageTranslationMutationRescanTimer: number | null = null
let pageTranslationActiveRescanTimer: number | null = null
let pageTranslationActiveRescanDelay = PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS
let pageTranslationLastCollectAt = 0

type PageTranslationDebugWindow = Window & {
    __itranslatePageTranslationDebug?: () => Record<string, unknown>
}

const pageTranslationDebug = {
    observerCreatedAt: 0,
    observerAttachedAt: 0,
    observerDisconnectedAt: 0,
    lastStartAt: 0,
    lastStopAt: 0,
    lastRuntimeInvalidatedAt: 0,
    lastMutationAt: 0,
    mutationBatches: 0,
    mutationRecords: 0,
    mutationRecordsWhileDisabled: 0,
    collectRuns: 0,
    mutationRescansScheduled: 0,
    mutationRescansRun: 0,
    activeRescansRun: 0,
    queuedText: 0,
    queuedPlaceholders: 0,
    translatedText: 0,
    translatedPlaceholders: 0,
    skippedTranslations: 0,
    failedTranslations: 0,
    lastRuntimeState: 'init',
    lastError: null as string | null,
}

function formatDebugTime(value: number): string | null {
    return value > 0 ? new Date(value).toISOString() : null
}

function markPageTranslationRuntimeState(state: string) {
    pageTranslationDebug.lastRuntimeState = state
}

function markPageTranslationError(error: unknown) {
    pageTranslationDebug.lastError = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : String(error)
}

function getPageTranslationDebugSnapshot(): Record<string, unknown> {
    return {
        enabled: pageTranslationEnabled,
        observerActive: !!pageTranslationObserver,
        visibilityObserverActive: !!pageTranslationVisibilityObserver,
        runtimeValid: pageDeps?.isRuntimeValid() ?? false,
        runId: pageTranslationRunId,
        sourceOverride: pageTranslationMemory.sourceLanguageOverride,
        textQueueLength: pageTranslationTextQueue.length,
        textActiveCount: pageTranslationTextQueue.activeCount,
        placeholderQueueLength: pageTranslationPlaceholderQueue.length,
        placeholderActiveCount: pageTranslationPlaceholderQueue.activeCount,
        translatedTextNodeCount: pageTranslationNodes.size,
        translatedPlaceholderCount: pageTranslationPlaceholderElements.size,
        observedVisibilityTargets: pageTranslationObserved.size,
        observedVisibilityPlaceholders: pageTranslationObservedPlaceholders.size,
        observedShadowRoots: pageTranslationShadowRoots.size,
        cacheSize: pageTranslationMemory.cacheSize,
        skipCacheSize: pageTranslationMemory.skipCacheSize,
        inflightCount: pageTranslationMemory.inflightCount,
        suggestionObserverActive: !!pageTranslationSuggestionObserver,
        suggestionDismissed: pageTranslationSuggestionDismissed,
        observerCreatedAt: formatDebugTime(pageTranslationDebug.observerCreatedAt),
        observerAttachedAt: formatDebugTime(pageTranslationDebug.observerAttachedAt),
        observerDisconnectedAt: formatDebugTime(pageTranslationDebug.observerDisconnectedAt),
        lastStartAt: formatDebugTime(pageTranslationDebug.lastStartAt),
        lastStopAt: formatDebugTime(pageTranslationDebug.lastStopAt),
        lastRuntimeInvalidatedAt: formatDebugTime(pageTranslationDebug.lastRuntimeInvalidatedAt),
        lastMutationAt: formatDebugTime(pageTranslationDebug.lastMutationAt),
        mutationBatches: pageTranslationDebug.mutationBatches,
        mutationRecords: pageTranslationDebug.mutationRecords,
        mutationRecordsWhileDisabled: pageTranslationDebug.mutationRecordsWhileDisabled,
        collectRuns: pageTranslationDebug.collectRuns,
        mutationRescansScheduled: pageTranslationDebug.mutationRescansScheduled,
        mutationRescansRun: pageTranslationDebug.mutationRescansRun,
        activeRescansRun: pageTranslationDebug.activeRescansRun,
        activeRescanDelayMs: pageTranslationActiveRescanDelay,
        lastCollectAt: formatDebugTime(pageTranslationLastCollectAt),
        queuedText: pageTranslationDebug.queuedText,
        queuedPlaceholders: pageTranslationDebug.queuedPlaceholders,
        translatedText: pageTranslationDebug.translatedText,
        translatedPlaceholders: pageTranslationDebug.translatedPlaceholders,
        skippedTranslations: pageTranslationDebug.skippedTranslations,
        failedTranslations: pageTranslationDebug.failedTranslations,
        lastRuntimeState: pageTranslationDebug.lastRuntimeState,
        lastError: pageTranslationDebug.lastError,
    }
}

function installPageTranslationDebugHook() {
    ;(window as PageTranslationDebugWindow).__itranslatePageTranslationDebug = getPageTranslationDebugSnapshot
}

function ensurePageTranslationStatusStyle() {
    if (!document.getElementById(PAGE_STATUS_STYLE_ID)) {
        const style = document.createElement('style')
        style.id = PAGE_STATUS_STYLE_ID
        style.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}.${PAGE_STATUS_CLASS}{position:fixed;z-index:2147483647;display:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border-radius:999px;background:rgba(15,23,42,.72);color:#f8fafc;border:1px solid rgba(255,255,255,.14);box-shadow:0 5px 14px rgba(15,23,42,.2);font:10px/1 -apple-system,"Segoe UI",sans-serif;pointer-events:none;backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%)}.${PAGE_STATUS_CLASS} .itranslate-page-status-spinner{width:8px;height:8px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}.${PAGE_STATUS_CLASS} .itranslate-page-status-text{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`
        document.documentElement.appendChild(style)
    }
}

function createPageTranslationStatus(node: Text): PageTranslationStatus {
    const existing = pageTranslationStatuses.get(node)
    if (existing?.el.isConnected && existing.textEl.isConnected) return existing

    ensurePageTranslationStatusStyle()

    const el = document.createElement('div')
    el.className = PAGE_STATUS_CLASS
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.setAttribute('aria-label', 'Translating...')

    const spinner = document.createElement('span')
    spinner.className = 'itranslate-page-status-spinner'

    const text = document.createElement('span')
    text.className = 'itranslate-page-status-text'

    el.append(spinner, text)
    document.documentElement.appendChild(el)

    const status: PageTranslationStatus = {el, textEl: text, cleanup: null, hideTimer: null}
    pageTranslationStatuses.set(node, status)
    pageTranslationStatusNodes.add(node)
    return status
}

function stopPageTranslationStatusAutoUpdate(status: PageTranslationStatus) {
    status.cleanup?.()
    status.cleanup = null
}

function showPageTextTranslationStatus(node: Text, message: string) {
    if (!isTextNodeVisible(node)) return

    const status = createPageTranslationStatus(node)
    if (status.hideTimer !== null) {
        clearTimeout(status.hideTimer)
        status.hideTimer = null
    }

    status.textEl.textContent = message
    status.el.setAttribute('aria-label', message)
    status.el.style.display = 'flex'
    stopPageTranslationStatusAutoUpdate(status)

    const contextElement = getTextNodeElement(node) ?? document.documentElement
    const ref: VirtualElement = {
        getBoundingClientRect: () => getTextNodeAnchorRect(node),
        contextElement,
    }

    status.cleanup = autoUpdate(ref, status.el, async () => {
        if (!pageTranslationEnabled || !node.isConnected || !isTextNodeVisible(node)) {
            hidePageTextTranslationStatus(node)
            return
        }

        const {x, y} = await computePosition(ref, status.el, {
            strategy: 'fixed',
            placement: 'top-start',
            middleware: [offset(3), flip({padding: 6}), shift({padding: 6})],
        })
        status.el.style.left = `${x}px`
        status.el.style.top = `${y}px`
    })
}

function hidePageTextTranslationStatus(node?: Text) {
    if (!node) {
        Array.from(pageTranslationStatusNodes).forEach(activeNode => hidePageTextTranslationStatus(activeNode))
        return
    }

    const status = pageTranslationStatuses.get(node)
    if (!status) return

    stopPageTranslationStatusAutoUpdate(status)

    if (status.hideTimer !== null) clearTimeout(status.hideTimer)
    status.hideTimer = window.setTimeout(() => {
        status.el.remove()
        pageTranslationStatuses.delete(node)
        pageTranslationStatusNodes.delete(node)
    }, 80)
}

function setPageTranslationSourceOverride(sourceLanguage?: DetectableLanguage | null): boolean {
    return pageTranslationMemory.setSourceOverride(sourceLanguage)
}

function normalizePageTranslationSourceLanguage(language: string | undefined): DetectableLanguage | null {
    if (typeof language !== 'string') return null

    const normalized = language.trim().toLowerCase()
    return normalized === 'en' || normalized === 'ru' || normalized === 'ua' || normalized === 'de' || normalized === 'fr'
        ? normalized
        : null
}

function clearPageOriginalTooltipTimer() {
    if (pageOriginalTooltipTimer !== null) {
        clearTimeout(pageOriginalTooltipTimer)
        pageOriginalTooltipTimer = null
    }
}

function clearPageOriginalTooltipHideTimer() {
    if (pageOriginalTooltipHideTimer !== null) {
        clearTimeout(pageOriginalTooltipHideTimer)
        pageOriginalTooltipHideTimer = null
    }
}

function hidePageOriginalTooltip() {
    clearPageOriginalTooltipTimer()
    clearPageOriginalTooltipHideTimer()
    pageOriginalTooltipPendingNode = null
    pageOriginalTooltipVisibleNode = null
    pageOriginalTooltipPendingText = ''
    getPageDeps().getTooltip().hide('page-original')
}

function schedulePageOriginalTooltipHide() {
    clearPageOriginalTooltipTimer()
    if (!getPageDeps().getTooltip().isOwnedBy('page-original')) {
        hidePageOriginalTooltip()
        return
    }

    clearPageOriginalTooltipHideTimer()
    pageOriginalTooltipHideTimer = window.setTimeout(() => {
        hidePageOriginalTooltip()
    }, 700)
}

function showPageOriginalTooltip(node: Text, text: string) {
    const rect = () => getTextNodeAnchorRect(node)
    getPageDeps().getTooltip().show(text, rect, 'page-original')
}

function schedulePageOriginalTooltip(node: Text, text: string) {
    clearPageOriginalTooltipHideTimer()
    if (pageOriginalTooltipVisibleNode === node && getPageDeps().getTooltip().isOwnedBy('page-original')) {
        showPageOriginalTooltip(node, text)
        return
    }

    if (pageOriginalTooltipPendingNode === node) {
        pageOriginalTooltipPendingText = text
        return
    }

    clearPageOriginalTooltipTimer()
    pageOriginalTooltipPendingNode = node
    pageOriginalTooltipVisibleNode = null
    pageOriginalTooltipPendingText = text
    getPageDeps().getTooltip().hide('page-original')

    pageOriginalTooltipTimer = window.setTimeout(() => {
        pageOriginalTooltipTimer = null
        if (!pageTranslationEnabled || pageOriginalTooltipPendingNode !== node || !node.isConnected) return
        if (!getActivePageTranslationMeta(node)) {
            hidePageOriginalTooltip()
            return
        }

        pageOriginalTooltipVisibleNode = node
        showPageOriginalTooltip(node, pageOriginalTooltipPendingText)
    }, PAGE_ORIGINAL_TOOLTIP_DELAY_MS)
}

function getActivePageTranslationMeta(node: Text): PageTextMeta | null {
    const meta = pageTranslationMeta.get(node)
    if (!meta || meta.runId !== pageTranslationRunId) return null

    const text = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(text)
    if (text !== meta.translatedText && value !== meta.translatedValue) return null

    return meta
}

function textNodeContainsPoint(node: Text, clientX: number, clientY: number): boolean {
    const range = document.createRange()
    try {
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
            if (
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom
            ) {
                return true
            }
        }
        return false
    } finally {
        range.detach()
    }
}

function getDeepElementFromPoint(clientX: number, clientY: number): Element | null {
    let element = document.elementFromPoint(clientX, clientY)

    while (element?.shadowRoot) {
        const nested = element.shadowRoot.elementFromPoint(clientX, clientY)
        if (!nested || nested === element) break
        element = nested
    }

    return element
}

function getTextNodeAtPoint(clientX: number, clientY: number): Text | null {
    const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
        caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node | null} | null
    }
    const range = doc.caretRangeFromPoint?.(clientX, clientY)
    const positionedNode = range?.startContainer ?? doc.caretPositionFromPoint?.(clientX, clientY)?.offsetNode
    if (positionedNode?.nodeType === Node.TEXT_NODE) {
        const textNode = positionedNode as Text
        if (getActivePageTranslationMeta(textNode)) return textNode
    }

    const element = getDeepElementFromPoint(clientX, clientY)
    if (!element) return null

    let found: Text | null = null
    walkTextNodesDeep(element, node => {
        if (getActivePageTranslationMeta(node) && textNodeContainsPoint(node, clientX, clientY)) {
            found = node
            return false
        }
    })

    return found
}

function handlePageOriginalTooltipPointerMove(event: MouseEvent) {
    if (!pageTranslationEnabled) {
        hidePageOriginalTooltip()
        return
    }

    const tooltipEl = document.getElementById(TOOLTIP_ID)
    if (
        getPageDeps().getTooltip().isOwnedBy('page-original') &&
        tooltipEl &&
        event.target instanceof Node &&
        tooltipEl.contains(event.target)
    ) {
        clearPageOriginalTooltipHideTimer()
        return
    }

    const node = getTextNodeAtPoint(event.clientX, event.clientY)
    const meta = node ? getActivePageTranslationMeta(node) : null
    if (!node || !meta) {
        schedulePageOriginalTooltipHide()
        return
    }

    schedulePageOriginalTooltip(node, meta.sourceText.trim() || meta.sourceValue)
}

function handlePageOriginalTooltipHide() {
    hidePageOriginalTooltip()
}

function startPageOriginalTooltipListeners() {
    document.addEventListener('mousemove', handlePageOriginalTooltipPointerMove, true)
    document.addEventListener('mouseleave', handlePageOriginalTooltipHide, true)
    document.addEventListener('scroll', handlePageOriginalTooltipHide, true)
}

function stopPageOriginalTooltipListeners() {
    document.removeEventListener('mousemove', handlePageOriginalTooltipPointerMove, true)
    document.removeEventListener('mouseleave', handlePageOriginalTooltipHide, true)
    document.removeEventListener('scroll', handlePageOriginalTooltipHide, true)
    hidePageOriginalTooltip()
}

function walkTextNodesDeep(root: Node, visitText: (node: Text) => boolean | void): boolean {
    return walkTextNodesDeepBase(root, visitText, shouldSkipPageTranslationElement)
}

function walkOpenShadowRootsDeep(root: Node, visitShadowRoot: (root: ShadowRoot) => void) {
    walkOpenShadowRootsDeepBase(root, visitShadowRoot, shouldSkipPageTranslationElement)
}

function hasTranslatableTextDeep(root: Node): boolean {
    return hasTranslatableTextDeepBase(root, hasTranslatableText, shouldSkipPageTranslationElement)
}

function isTextNodeVisible(node: Text): boolean {
    return isTextNodeVisibleBase(node, shouldSkipPageTranslationElement)
}

function getDocumentLanguageHint(): DetectableLanguage | null {
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

function normalizeSiteHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^www\./, '')
}

function getPageLanguageSampleContainer(node: Text): Element | null {
    const block = getSelectionBlockForNode(node)
    if (block && !isDocumentScopeElement(block)) return block

    return node.parentElement
}

function collectVisiblePageLanguageSamples(): string[] {
    return collectVisiblePageLanguageSamplesBase(document.body, {
        walkTextNodesDeep,
        isTextNodeVisible,
        hasTranslatableText,
        getSampleContainer: getPageLanguageSampleContainer,
        maxSampleNodes: PAGE_TRANSLATION_SUGGESTION_MAX_NODES,
        maxVisibleTextNodes: PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
        maxScannedTextNodes: PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES,
        maxChars: PAGE_TRANSLATION_SUGGESTION_MAX_CHARS,
    })
}

function collectFastVisiblePageLanguageText(): string {
    return collectFastVisiblePageLanguageTextBase(document.body, {
        walkTextNodesDeep,
        isTextNodeVisible,
        hasTranslatableText,
        maxVisibleTextNodes: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES,
        maxScannedTextNodes: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES,
        maxChars: PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS,
    })
}

function analyzeFastVisiblePageLanguage(targetLanguage: DetectableLanguage): PageLanguageAnalysis | null {
    const text = collectFastVisiblePageLanguageText()
    return analyzeFastPageLanguage(
        text,
        targetLanguage,
        getDocumentLanguageHint(),
        PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS
    )
}

async function analyzeVisiblePageLanguage(targetLanguage: DetectableLanguage): Promise<PageLanguageAnalysis | null> {
    const samples = collectVisiblePageLanguageSamples()
    if (samples.length === 0) return null

    const request: PageTranslationAnalyzeSamplesRequest = {
        type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES',
        target: targetLanguage,
        samples,
    }
    const documentLanguage = getDocumentLanguageHint()
    if (documentLanguage) request.documentLanguage = documentLanguage

    const {response, contextInvalidated} = await getPageDeps().sendRuntimeMessage<PageTranslationAnalyzeSamplesResponse>(request)
    if (contextInvalidated || !getPageDeps().isRuntimeValid()) return null
    return response?.ok ? response.analysis ?? null : null
}

function ensurePageTranslationPromptStyle() {
    if (document.getElementById(PAGE_TRANSLATION_PROMPT_STYLE_ID)) return

    const style = document.createElement('style')
    style.id = PAGE_TRANSLATION_PROMPT_STYLE_ID
    style.textContent = getPageTranslationPromptStyle(PAGE_TRANSLATION_PROMPT_ID)
    document.documentElement.appendChild(style)
}

function applyPageTranslationPromptTheme(theme: unknown) {
    const prompt = pageTranslationPromptEl
    if (!prompt) return

    const light = theme === 'light'
    prompt.classList.toggle('itranslate-page-prompt-light', light)
    prompt.classList.toggle('itranslate-page-prompt-dark', !light)
}

function syncPageTranslationPromptTheme() {
    applyPageTranslationPromptTheme('dark')

    if (!getPageDeps().isRuntimeValid()) return

    try {
        chrome.storage.local.get(['popup_theme'], (data) => {
            try {
                if (chrome.runtime.lastError) {
                    getPageDeps().handleRuntimeError(chrome.runtime.lastError.message)
                    return
                }
            } catch (error) {
                getPageDeps().handleRuntimeError(error)
                return
            }

            applyPageTranslationPromptTheme(data['popup_theme'])
        })
    } catch (error) {
        getPageDeps().handleRuntimeError(error)
    }

    if (pageTranslationPromptThemeListenerInstalled) return
    pageTranslationPromptThemeListenerInstalled = true

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes['popup_theme']) {
                applyPageTranslationPromptTheme(changes['popup_theme'].newValue)
            }
        })
    } catch (error) {
        getPageDeps().handleRuntimeError(error)
    }
}

function setPageTranslationPromptProgress(ratio: number) {
    pageTranslationPromptProgressEl?.style.setProperty(
        '--itranslate-page-prompt-progress',
        String(Math.max(0, Math.min(1, ratio)))
    )
}

function clearPageTranslationPromptCountdown() {
    if (pageTranslationPromptCountdownFrame !== null) {
        cancelAnimationFrame(pageTranslationPromptCountdownFrame)
        pageTranslationPromptCountdownFrame = null
    }
    pageTranslationPromptCountdownDeadline = 0
    pageTranslationPromptProgressEl = null
}

function tickPageTranslationPromptCountdown() {
    if (!pageTranslationPromptEl || !pageTranslationPromptProgressEl) return

    const remaining = pageTranslationPromptCountdownDeadline - Date.now()
    setPageTranslationPromptProgress(remaining / PAGE_TRANSLATION_PROMPT_TIMEOUT_MS)

    if (remaining <= 0) {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        return
    }

    pageTranslationPromptCountdownFrame = requestAnimationFrame(tickPageTranslationPromptCountdown)
}

function startPageTranslationPromptCountdown() {
    if (!pageTranslationPromptEl || !pageTranslationPromptProgressEl) return

    if (pageTranslationPromptCountdownFrame !== null) {
        cancelAnimationFrame(pageTranslationPromptCountdownFrame)
    }
    pageTranslationPromptCountdownDeadline = Date.now() + PAGE_TRANSLATION_PROMPT_TIMEOUT_MS
    setPageTranslationPromptProgress(1)
    pageTranslationPromptCountdownFrame = requestAnimationFrame(tickPageTranslationPromptCountdown)
}

function pausePageTranslationPromptCountdown() {
    if (pageTranslationPromptCountdownFrame !== null) {
        cancelAnimationFrame(pageTranslationPromptCountdownFrame)
        pageTranslationPromptCountdownFrame = null
    }
    pageTranslationPromptCountdownDeadline = Date.now() + PAGE_TRANSLATION_PROMPT_TIMEOUT_MS
    setPageTranslationPromptProgress(1)
}

function hidePageTranslationPrompt() {
    clearPageTranslationPromptCountdown()
    pageTranslationPromptEl?.remove()
    pageTranslationPromptEl = null
}

function requestPageTranslationStart(sourceLanguage: DetectableLanguage) {
    startPageTranslation(sourceLanguage)

    void getPageDeps().sendRuntimeMessage<PageTranslationStateResponse>({
        type: 'PAGE_TRANSLATION_SET_ACTIVE',
        enabled: true,
        sourceLanguage,
    })
        .then(({response, error, contextInvalidated}) => {
            if (contextInvalidated) {
                markPageTranslationRuntimeState('set-active-context-invalidated')
                return
            }
            if (response?.ok === false) {
                markPageTranslationRuntimeState('set-active-rejected')
                markPageTranslationError(response.error ?? 'Background rejected page translation activation')
                pageTranslationMemory.clearSourceOverride()
                stopPageTranslation()
                return
            }
            if (error) {
                markPageTranslationRuntimeState('set-active-transport-error')
                markPageTranslationError(error)
                return
            }
            if (!response) {
                markPageTranslationRuntimeState('set-active-no-response')
                return
            }
            markPageTranslationRuntimeState('set-active-ok')
        })
}

function isPageTranslationSuggestionBlocked(): boolean {
    return pageTranslationEnabled || pageTranslationSuggestionDismissed || !!pageTranslationPromptEl || !getPageDeps().isRuntimeValid()
}

function createPageTranslationPromptButton(className: string, text: string, label?: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = className
    button.type = 'button'
    button.textContent = text

    if (label) {
        button.title = label
        button.setAttribute('aria-label', label)
    }

    return button
}

function showPageTranslationPrompt(hostname: string, targetLanguage: DetectableLanguage, sourceLanguage: DetectableLanguage) {
    ensurePageTranslationPromptStyle()
    hidePageTranslationPrompt()

    const copy = getPageTranslationPromptCopy(targetLanguage, sourceLanguage, hostname)
    const prompt = document.createElement('div')
    prompt.id = PAGE_TRANSLATION_PROMPT_ID
    prompt.setAttribute('role', 'dialog')
    prompt.setAttribute('aria-label', copy.title)

    const row = document.createElement('div')
    row.className = 'itranslate-page-prompt-row'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'itranslate-page-prompt-title-wrap'

    const title = document.createElement('p')
    title.className = 'itranslate-page-prompt-title'
    title.textContent = copy.title

    const context = document.createElement('span')
    context.className = 'itranslate-page-prompt-context'
    context.textContent = copy.context

    titleWrap.append(title, context)

    const close = createPageTranslationPromptButton('itranslate-page-prompt-close', '×', copy.close)

    row.append(titleWrap, close)

    const actions = document.createElement('div')
    actions.className = 'itranslate-page-prompt-actions'

    const translateButton = createPageTranslationPromptButton('itranslate-page-prompt-primary', copy.translate)
    const neverButton = createPageTranslationPromptButton('itranslate-page-prompt-secondary', copy.never, copy.neverTitle)
    const alwaysButton = createPageTranslationPromptButton('itranslate-page-prompt-secondary', copy.always, copy.alwaysTitle)

    const progress = document.createElement('div')
    progress.className = 'itranslate-page-prompt-progress'

    const progressBar = document.createElement('span')
    progressBar.className = 'itranslate-page-prompt-progress-bar'
    progress.append(progressBar)

    actions.append(translateButton, neverButton, alwaysButton)
    prompt.append(row, actions, progress)

    prompt.addEventListener('mouseenter', pausePageTranslationPromptCountdown)
    prompt.addEventListener('mouseleave', startPageTranslationPromptCountdown)
    prompt.addEventListener('focusin', pausePageTranslationPromptCountdown)
    prompt.addEventListener('focusout', startPageTranslationPromptCountdown)

    close.addEventListener('click', () => {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
    })

    translateButton.addEventListener('click', () => {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        requestPageTranslationStart(sourceLanguage)
    })

    neverButton.addEventListener('click', () => {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        void getPageDeps().sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
            type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE',
            hostname,
            action: 'never',
        })
    })

    alwaysButton.addEventListener('click', () => {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        void getPageDeps().sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
            type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE',
            hostname,
            action: 'always-from',
            language: sourceLanguage,
        }).then(({response}) => {
            if (response?.ok) requestPageTranslationStart(sourceLanguage)
        })
    })

    document.documentElement.appendChild(prompt)
    prompt.style.display = 'block'
    pageTranslationPromptEl = prompt
    pageTranslationPromptProgressEl = progressBar
    syncPageTranslationPromptTheme()
    startPageTranslationPromptCountdown()
}

function clearPageTranslationSuggestionTimer() {
    if (pageTranslationSuggestionTimer !== null) {
        clearTimeout(pageTranslationSuggestionTimer)
        pageTranslationSuggestionTimer = null
    }
}

function resetPageTranslationSuggestionRetries() {
    pageTranslationSuggestionRetryCount = 0
}

function stopPageTranslationSuggestionObserver() {
    pageTranslationSuggestionObserver?.disconnect()
    pageTranslationSuggestionObserver = null
    pageTranslationSuggestionShadowRoots.clear()
    document.removeEventListener('scroll', handlePageTranslationSuggestionViewportChange, true)
    window.removeEventListener('resize', handlePageTranslationSuggestionViewportChange)
}

function schedulePageTranslationSuggestion(delay = 1200, resetRetries = false) {
    if (isPageTranslationSuggestionBlocked()) return
    if (resetRetries) resetPageTranslationSuggestionRetries()
    clearPageTranslationSuggestionTimer()
    pageTranslationSuggestionTimer = window.setTimeout(() => {
        pageTranslationSuggestionTimer = null
        void maybeSuggestPageTranslation()
    }, delay)
}

function handlePageTranslationSuggestionViewportChange() {
    schedulePageTranslationSuggestion(700, true)
}

function schedulePageTranslationSuggestionRetry() {
    if (isPageTranslationSuggestionBlocked()) return

    const delay = PAGE_TRANSLATION_SUGGESTION_RETRY_DELAYS_MS[pageTranslationSuggestionRetryCount]
    if (delay == null) return

    pageTranslationSuggestionRetryCount++
    schedulePageTranslationSuggestion(delay)
}

function observePageTranslationSuggestionShadowRoots(root: Node) {
    const observer = pageTranslationSuggestionObserver
    if (!observer) return

    walkOpenShadowRootsDeep(root, shadowRoot => {
        if (pageTranslationSuggestionShadowRoots.has(shadowRoot)) return

        pageTranslationSuggestionShadowRoots.add(shadowRoot)
        observer.observe(shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true,
        })
    })
}

function startPageTranslationSuggestionObserver() {
    if (pageTranslationSuggestionObserver || isPageTranslationSuggestionBlocked()) return

    const root = document.body ?? document.documentElement
    if (!root) {
        schedulePageTranslationSuggestion(800, true)
        return
    }

    pageTranslationSuggestionObserver = new MutationObserver((mutations) => {
        if (isPageTranslationSuggestionBlocked()) {
            stopPageTranslationSuggestionObserver()
            return
        }

        const hasTextChange = mutations.some((mutation) => {
            if (mutation.type === 'characterData') return true
            for (const node of mutation.addedNodes) {
                observePageTranslationSuggestionShadowRoots(node)
                if (node.nodeType === Node.TEXT_NODE) return hasTranslatableText(node.textContent ?? '')
                if (!(node instanceof Element) || shouldSkipPageTranslationElement(node)) continue
                if (hasTranslatableTextDeep(node)) return true
            }
            return false
        })
        if (hasTextChange) schedulePageTranslationSuggestion(1400, true)
    })

    pageTranslationSuggestionObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
    })
    observePageTranslationSuggestionShadowRoots(root)
    document.addEventListener('scroll', handlePageTranslationSuggestionViewportChange, true)
    window.addEventListener('resize', handlePageTranslationSuggestionViewportChange)
}

async function maybeSuggestPageTranslation() {
    if (isPageTranslationSuggestionBlocked()) return
    if (!document.body) {
        schedulePageTranslationSuggestion(800)
        startPageTranslationSuggestionObserver()
        return
    }
    if (document.visibilityState === 'hidden') return

    const hostname = normalizeSiteHostname(location.hostname)
    if (!hostname) return

    const {response, contextInvalidated} = await getPageDeps().sendRuntimeMessage<PageTranslationSuggestSettingsResponse>({
        type: 'PAGE_TRANSLATION_SUGGEST_SETTINGS',
        hostname,
    })
    if (contextInvalidated || !getPageDeps().isRuntimeValid()) return
    if (!response?.ok || !response.supported || response.never) {
        hidePageTranslationPrompt()
        return
    }

    const targetLanguage = normalizePromptLanguage(response.target)
    const fastAnalysis = analyzeFastVisiblePageLanguage(targetLanguage)
    const analysis = fastAnalysis ?? await analyzeVisiblePageLanguage(targetLanguage)
    if (!analysis || analysis.mismatchRatio < PAGE_TRANSLATION_SUGGESTION_THRESHOLD) {
        hidePageTranslationPrompt()
        startPageTranslationSuggestionObserver()
        schedulePageTranslationSuggestionRetry()
        return
    }

    resetPageTranslationSuggestionRetries()
    stopPageTranslationSuggestionObserver()

    if (response.alwaysFrom?.includes(analysis.sourceLanguage)) {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        requestPageTranslationStart(analysis.sourceLanguage)
        return
    }

    showPageTranslationPrompt(response.hostname || hostname, targetLanguage, analysis.sourceLanguage)
}

function applyPageTranslation(node: Text, sourceText: string, translatedValue: string) {
    const {leading, value: sourceValue, trailing} = splitPreservingWhitespace(sourceText)
    const translatedText = `${leading}${translatedValue}${trailing}`

    pageTranslationMeta.set(node, {runId: pageTranslationRunId, sourceText, sourceValue, translatedValue, translatedText})
    pageTranslationNodes.add(node)

    if (node.nodeValue !== translatedText) {
        node.nodeValue = translatedText
        pageTranslationDebug.translatedText++
    }
}

function reusePageTranslationIfUnchanged(node: Text): boolean {
    const meta = pageTranslationMeta.get(node)
    if (!meta || meta.runId !== pageTranslationRunId) return false

    const sourceText = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    if (sourceText === meta.translatedText || value === meta.translatedValue) return true
    if (value !== meta.sourceValue) return false

    applyPageTranslation(node, sourceText, meta.translatedValue)
    return true
}

function applyCachedPageTranslationIfAvailable(node: Text): boolean {
    const sourceText = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    const translated = pageTranslationMemory.getCached(value)
    if (!translated) return false

    applyPageTranslation(node, sourceText, translated)
    return true
}

function isPageTranslationKnownSkipped(value: string): boolean {
    return pageTranslationMemory.isSkipped(value)
}

function translatePageValue(value: string): Promise<string | null> {
    if (isPageTranslationKnownSkipped(value)) return Promise.resolve(null)

    const cached = pageTranslationMemory.getCached(value)
    if (cached) return Promise.resolve(cached)

    const inflight = pageTranslationMemory.getActiveRequest(value)
    if (inflight) return inflight

    const request = getPageDeps().translateWithResponse(value, 'page', pageTranslationMemory.sourceLanguageOverride ?? undefined)
        .then(response => {
            if (!response.ok) {
                pageTranslationDebug.failedTranslations++
                markPageTranslationError(response.error ?? 'Page translation failed')
                return null
            }
            if (response.skipped) {
                pageTranslationDebug.skippedTranslations++
                pageTranslationMemory.markSkipped(value)
                return null
            }
            const translated = response.ok && !response.skipped && typeof response.translatedText === 'string'
                ? response.translatedText
                : null
            if (translated) pageTranslationMemory.setCached(value, translated)
            return translated
        })
        .finally(() => {
            pageTranslationMemory.deleteActiveRequest(value)
        })

    pageTranslationMemory.setActiveRequest(value, request)
    return request
}

function shouldSkipPageTranslationElement(element: Element): boolean {
    return (element instanceof HTMLElement && element.isContentEditable) || !!closestElementDeep(element, PAGE_TRANSLATION_SKIP_SELECTOR)
}

function shouldSkipPageTranslationPlaceholderElement(element: Element): boolean {
    return (element instanceof HTMLElement && element.isContentEditable) ||
        !!closestElementDeep(element, PAGE_TRANSLATION_PLACEHOLDER_SKIP_SELECTOR)
}

function isPagePlaceholderElement(element: Element): element is PagePlaceholderElement {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return false
    if (element instanceof HTMLInputElement && element.type === 'hidden') return false
    return true
}

function isPagePlaceholderVisible(element: PagePlaceholderElement): boolean {
    if (!element.isConnected || shouldSkipPageTranslationPlaceholderElement(element)) return false

    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false

    for (const rect of element.getClientRects()) {
        if (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= window.innerHeight &&
            rect.left <= window.innerWidth
        ) {
            return true
        }
    }

    return false
}

function isPageTranslationPlaceholderCandidate(element: Element): element is PagePlaceholderElement {
    if (!isPagePlaceholderElement(element)) return false

    const text = element.getAttribute('placeholder') ?? ''
    const {value} = splitPreservingWhitespace(text)
    if (!value || !hasTranslatableText(value)) return false

    const meta = pageTranslationPlaceholderMeta.get(element)
    if (meta?.runId === pageTranslationRunId && text === meta.translatedText) return false
    if (meta?.runId === pageTranslationRunId && value === meta.translatedValue) return false

    return !shouldSkipPageTranslationPlaceholderElement(element)
}

function isPageTranslationCandidate(node: Text): boolean {
    const text = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(text)
    if (!value || !hasTranslatableText(value)) return false

    const meta = pageTranslationMeta.get(node)
    if (meta?.runId === pageTranslationRunId && text === meta.translatedText) return false
    if (meta?.runId === pageTranslationRunId && value === meta.translatedValue) return false

    const parent = node.parentElement
    if (!parent || shouldSkipPageTranslationElement(parent)) return false

    return true
}

function applyPagePlaceholderTranslation(
    element: PagePlaceholderElement,
    sourceText: string,
    translatedValue: string,
) {
    const {leading, value: sourceValue, trailing} = splitPreservingWhitespace(sourceText)
    const translatedText = `${leading}${translatedValue}${trailing}`

    pageTranslationPlaceholderMeta.set(element, {
        runId: pageTranslationRunId,
        sourceText,
        sourceValue,
        translatedValue,
        translatedText,
    })
    pageTranslationPlaceholderElements.add(element)

    if (element.getAttribute('placeholder') !== translatedText) {
        element.setAttribute('placeholder', translatedText)
        pageTranslationDebug.translatedPlaceholders++
    }
}

function reusePagePlaceholderTranslationIfUnchanged(element: PagePlaceholderElement): boolean {
    const meta = pageTranslationPlaceholderMeta.get(element)
    if (!meta || meta.runId !== pageTranslationRunId) return false

    const sourceText = element.getAttribute('placeholder') ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    if (sourceText === meta.translatedText || value === meta.translatedValue) return true
    if (value !== meta.sourceValue) return false

    applyPagePlaceholderTranslation(element, sourceText, meta.translatedValue)
    return true
}

function applyCachedPagePlaceholderTranslationIfAvailable(element: PagePlaceholderElement): boolean {
    const sourceText = element.getAttribute('placeholder') ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    const translated = pageTranslationMemory.getCached(value)
    if (!translated) return false

    applyPagePlaceholderTranslation(element, sourceText, translated)
    return true
}

function getPageTranslationObserverTarget(node: Text): Element | null {
    let element: Element | null = node.parentElement
    const fallback = element

    while (element && element !== document.documentElement) {
        if (element.getClientRects().length > 0) return element
        element = element.parentElement
    }

    return fallback
}

function unobservePageTextNode(node: Text) {
    for (const [target, nodes] of pageTranslationObserved) {
        if (!nodes.delete(node)) continue

        if (nodes.size === 0) {
            pageTranslationObserved.delete(target)
            pageTranslationVisibilityObserver?.unobserve(target)
        }
        return
    }
}

function checkObservedPageTextNodes() {
    if (!pageTranslationEnabled) return

    for (const [target, nodes] of pageTranslationObserved) {
        for (const node of nodes) {
            if (!node.isConnected || !isPageTranslationCandidate(node)) {
                nodes.delete(node)
                continue
            }

            if (isTextNodeVisible(node)) {
                nodes.delete(node)
                enqueuePageTextNode(node, false)
            }
        }

        if (nodes.size === 0) {
            pageTranslationObserved.delete(target)
            pageTranslationVisibilityObserver?.unobserve(target)
        }
    }
}

function scheduleObservedPageTextNodeCheck() {
    if (!pageTranslationEnabled || pageTranslationVisibilityFrame !== null) return

    pageTranslationVisibilityFrame = window.requestAnimationFrame(() => {
        pageTranslationVisibilityFrame = null
        checkObservedPageTextNodes()
        checkObservedPagePlaceholders()
    })
}

function ensurePageTranslationVisibilityObserver() {
    if (pageTranslationVisibilityObserver) return pageTranslationVisibilityObserver

    pageTranslationVisibilityObserver = new IntersectionObserver((entries) => {
        if (!pageTranslationEnabled) return

        for (const entry of entries) {
            if (entry.isIntersecting) {
                scheduleObservedPageTextNodeCheck()
                break
            }
        }
    })

    return pageTranslationVisibilityObserver
}

function observePageTextNode(node: Text) {
    if (!pageTranslationEnabled || !isPageTranslationCandidate(node)) return

    const target = getPageTranslationObserverTarget(node)
    if (!target) return

    const nodes = pageTranslationObserved.get(target) ?? new Set<Text>()
    nodes.add(node)
    pageTranslationObserved.set(target, nodes)
    ensurePageTranslationVisibilityObserver().observe(target)
}

function observePagePlaceholderElement(element: PagePlaceholderElement) {
    if (!pageTranslationEnabled || !isPageTranslationPlaceholderCandidate(element)) return

    pageTranslationObservedPlaceholders.add(element)
    ensurePageTranslationVisibilityObserver().observe(element)
}

function forgetObservedPageTextNodes(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
        unobservePageTextNode(root as Text)
        return
    }

    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

    walkTextNodesDeep(root, node => unobservePageTextNode(node))
}

function forgetObservedPagePlaceholders(root: Node) {
    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

    const elements = root instanceof Element && isPagePlaceholderElement(root)
        ? [root]
        : []

    if (root instanceof Element || root instanceof DocumentFragment) {
        root.querySelectorAll?.('input[placeholder], textarea[placeholder]').forEach(element => {
            if (isPagePlaceholderElement(element)) elements.push(element)
        })
    }

    for (const element of elements) {
        pageTranslationObservedPlaceholders.delete(element)
        pageTranslationVisibilityObserver?.unobserve(element)
    }
}

function clearPageTranslationVisibilityObserver() {
    pageTranslationVisibilityObserver?.disconnect()
    pageTranslationVisibilityObserver = null
    pageTranslationObserved.clear()
    pageTranslationObservedPlaceholders.clear()

    if (pageTranslationVisibilityFrame !== null) {
        cancelAnimationFrame(pageTranslationVisibilityFrame)
        pageTranslationVisibilityFrame = null
    }
}

function handlePageTranslationViewportChange() {
    resetPageTranslationActiveRescanDelay()
    scheduleObservedPageTextNodeCheck()
}

function checkObservedPagePlaceholders() {
    if (!pageTranslationEnabled) return

    for (const element of pageTranslationObservedPlaceholders) {
        if (!element.isConnected || !isPageTranslationPlaceholderCandidate(element)) {
            pageTranslationObservedPlaceholders.delete(element)
            pageTranslationVisibilityObserver?.unobserve(element)
            continue
        }

        if (isPagePlaceholderVisible(element)) {
            pageTranslationObservedPlaceholders.delete(element)
            pageTranslationVisibilityObserver?.unobserve(element)
            enqueuePagePlaceholderElement(element, false)
        }
    }
}

function enqueuePageTextNode(node: Text, requireVisible = true) {
    if (!pageTranslationEnabled || pageTranslationTextQueue.isQueued(node) || !isPageTranslationCandidate(node)) return
    if (requireVisible && !isTextNodeVisible(node)) {
        observePageTextNode(node)
        return
    }
    if (reusePageTranslationIfUnchanged(node)) return
    if (applyCachedPageTranslationIfAvailable(node)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(node.nodeValue ?? '').value)) return

    unobservePageTextNode(node)
    pageTranslationTextQueue.enqueue(node)
    pageTranslationDebug.queuedText++
    updatePageTranslationStatus()
    void drainPageTranslationQueue()
}

function enqueuePagePlaceholderElement(element: Element, requireVisible = true) {
    if (
        !pageTranslationEnabled ||
        !isPageTranslationPlaceholderCandidate(element)
    ) {
        return
    }
    if (pageTranslationPlaceholderQueue.isQueued(element)) return

    if (requireVisible && !isPagePlaceholderVisible(element)) {
        observePagePlaceholderElement(element)
        return
    }
    if (reusePagePlaceholderTranslationIfUnchanged(element)) return
    if (applyCachedPagePlaceholderTranslationIfAvailable(element)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(element.getAttribute('placeholder') ?? '').value)) return

    pageTranslationObservedPlaceholders.delete(element)
    pageTranslationVisibilityObserver?.unobserve(element)
    pageTranslationPlaceholderQueue.enqueue(element)
    pageTranslationDebug.queuedPlaceholders++
    updatePageTranslationStatus()
    void drainPageTranslationQueue()
}

function collectPageTextNodes(root: Node) {
    if (!pageTranslationEnabled) return

    if (root.nodeType === Node.TEXT_NODE) {
        enqueuePageTextNode(root as Text)
        return
    }

    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return
    if (root instanceof Element && shouldSkipPageTranslationElement(root)) return

    walkTextNodesDeep(root, node => enqueuePageTextNode(node))
}

function collectPagePlaceholderElements(root: Node) {
    if (!pageTranslationEnabled) return
    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

    if (root instanceof Element) {
        enqueuePagePlaceholderElement(root)
    }

    if (root instanceof Element && shouldSkipPageTranslationPlaceholderElement(root)) return

    root.querySelectorAll?.('input[placeholder], textarea[placeholder]').forEach(element => enqueuePagePlaceholderElement(element))
}

function resetPageTranslationActiveRescanDelay() {
    pageTranslationActiveRescanDelay = PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS
}

function hasPendingPageTranslationWork(): boolean {
    return pageTranslationTextQueue.hasPending() ||
        pageTranslationPlaceholderQueue.hasPending() ||
        pageTranslationMemory.hasActiveRequests()
}

function collectCurrentPageTranslationTargets() {
    if (!pageTranslationEnabled) return

    const root = document.body ?? document.documentElement
    if (!root) return

    pageTranslationLastCollectAt = Date.now()
    pageTranslationDebug.collectRuns++
    observePageTranslationShadowRoots(root)
    collectPageTextNodes(root)
    collectPagePlaceholderElements(root)
    scheduleObservedPageTextNodeCheck()
}

function clearPageTranslationMutationRescan() {
    if (pageTranslationMutationRescanTimer !== null) {
        clearTimeout(pageTranslationMutationRescanTimer)
        pageTranslationMutationRescanTimer = null
    }
}

function schedulePageTranslationMutationRescan() {
    if (!pageTranslationEnabled) return

    resetPageTranslationActiveRescanDelay()
    clearPageTranslationMutationRescan()
    pageTranslationDebug.mutationRescansScheduled++
    pageTranslationMutationRescanTimer = window.setTimeout(() => {
        pageTranslationMutationRescanTimer = null
        if (!pageTranslationEnabled) return

        pageTranslationDebug.mutationRescansRun++
        collectCurrentPageTranslationTargets()
    }, PAGE_TRANSLATION_MUTATION_RESCAN_DELAY_MS)
}

function clearPageTranslationActiveRescan() {
    if (pageTranslationActiveRescanTimer !== null) {
        clearTimeout(pageTranslationActiveRescanTimer)
        pageTranslationActiveRescanTimer = null
    }
}

function schedulePageTranslationActiveRescan() {
    if (!pageTranslationEnabled || pageTranslationActiveRescanTimer !== null) return

    pageTranslationActiveRescanTimer = window.setTimeout(() => {
        pageTranslationActiveRescanTimer = null
        if (!pageTranslationEnabled) return

        const hasPendingWork = hasPendingPageTranslationWork()
        const recentlyCollected = Date.now() - pageTranslationLastCollectAt < PAGE_TRANSLATION_ACTIVE_RESCAN_RECENT_COLLECT_MS
        if (document.visibilityState === 'visible' && !hasPendingWork && !recentlyCollected) {
            const queuedBefore = pageTranslationDebug.queuedText + pageTranslationDebug.queuedPlaceholders
            pageTranslationDebug.activeRescansRun++
            collectCurrentPageTranslationTargets()
            const queuedAfter = pageTranslationDebug.queuedText + pageTranslationDebug.queuedPlaceholders

            if (queuedAfter === queuedBefore && !hasPendingPageTranslationWork()) {
                pageTranslationActiveRescanDelay = Math.min(
                    Math.ceil(pageTranslationActiveRescanDelay * 1.5),
                    PAGE_TRANSLATION_ACTIVE_RESCAN_MAX_INTERVAL_MS
                )
            } else {
                resetPageTranslationActiveRescanDelay()
            }
        } else if (hasPendingWork) {
            resetPageTranslationActiveRescanDelay()
        }

        schedulePageTranslationActiveRescan()
    }, pageTranslationActiveRescanDelay)
}

function observePageTranslationShadowRoots(root: Node) {
    const observer = pageTranslationObserver
    if (!observer) return

    walkOpenShadowRootsDeep(root, shadowRoot => {
        if (pageTranslationShadowRoots.has(shadowRoot)) return

        pageTranslationShadowRoots.add(shadowRoot)
        observer.observe(shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'placeholder', 'type'],
        })
    })
}

function observePageTranslationDocumentRoot() {
    if (!pageTranslationObserver) return

    pageTranslationObserver.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'placeholder', 'type'],
    })
    pageTranslationDebug.observerAttachedAt = Date.now()
    if (document.documentElement) observePageTranslationShadowRoots(document.documentElement)
}

function handlePageTranslationMutations(mutations: MutationRecord[]) {
    pageTranslationDebug.mutationBatches++
    pageTranslationDebug.mutationRecords += mutations.length
    pageTranslationDebug.lastMutationAt = Date.now()

    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => observePageTranslationShadowRoots(node))
    }

    if (!pageTranslationEnabled) {
        pageTranslationDebug.mutationRecordsWhileDisabled += mutations.length
        return
    }

    let shouldRescan = false
    for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target instanceof Text) {
            enqueuePageTextNode(mutation.target)
            continue
        }

        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
            const attributeName = mutation.attributeName
            if (attributeName === 'hidden' || attributeName === 'aria-hidden') {
                collectPageTextNodes(mutation.target)
                collectPagePlaceholderElements(mutation.target)
                shouldRescan = true
            }
            if (
                attributeName === 'placeholder' ||
                attributeName === 'type'
            ) {
                collectPagePlaceholderElements(mutation.target)
            }
            scheduleObservedPageTextNodeCheck()
            continue
        }

        mutation.addedNodes.forEach(node => {
            collectPageTextNodes(node)
            collectPagePlaceholderElements(node)
            shouldRescan = true
        })
        mutation.removedNodes.forEach(node => {
            forgetObservedPageTextNodes(node)
            forgetObservedPagePlaceholders(node)
        })
    }
    if (shouldRescan) schedulePageTranslationMutationRescan()
}

function ensurePageTranslationMutationObserver() {
    if (!pageTranslationObserver) {
        pageTranslationObserver = new MutationObserver(handlePageTranslationMutations)
        pageTranslationDebug.observerCreatedAt = Date.now()
    }
    observePageTranslationDocumentRoot()
}

function disconnectPageTranslationMutationObserver() {
    pageTranslationObserver?.disconnect()
    pageTranslationObserver = null
    pageTranslationShadowRoots.clear()
    pageTranslationDebug.observerDisconnectedAt = Date.now()
}

async function translatePageTextNode(node: Text, runId: number) {
    if (!pageTranslationEnabled || runId !== pageTranslationRunId || !node.isConnected || !isPageTranslationCandidate(node)) return
    if (!isTextNodeVisible(node)) {
        observePageTextNode(node)
        return
    }
    if (reusePageTranslationIfUnchanged(node)) return

    const sourceText = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    const cached = pageTranslationMemory.getCached(value)
    if (cached) {
        applyPageTranslation(node, sourceText, cached)
        return
    }

    const existingRequest = pageTranslationMemory.getActiveRequest(value)
    if (!existingRequest) showPageTextTranslationStatus(node, 'Translating...')
    try {
        const translated = await (existingRequest ?? translatePageValue(value))
        if (!translated) return

        if (!pageTranslationEnabled || runId !== pageTranslationRunId || !node.isConnected) return
        if (!isTextNodeVisible(node)) {
            observePageTextNode(node)
            return
        }
        if ((node.nodeValue ?? '') !== sourceText) return

        applyPageTranslation(node, sourceText, translated)
    } finally {
        if (!existingRequest) hidePageTextTranslationStatus(node)
    }
}

async function translatePagePlaceholderElement(element: PagePlaceholderElement, runId: number) {
    if (
        !pageTranslationEnabled ||
        runId !== pageTranslationRunId ||
        !element.isConnected ||
        !isPageTranslationPlaceholderCandidate(element)
    ) {
        return
    }
    if (!isPagePlaceholderVisible(element)) {
        observePagePlaceholderElement(element)
        return
    }
    if (reusePagePlaceholderTranslationIfUnchanged(element)) return

    const sourceText = element.getAttribute('placeholder') ?? ''
    const {value} = splitPreservingWhitespace(sourceText)
    const cached = pageTranslationMemory.getCached(value)
    if (cached) {
        applyPagePlaceholderTranslation(element, sourceText, cached)
        return
    }

    const translated = await translatePageValue(value)
    if (!translated) return

    if (
        !pageTranslationEnabled ||
        runId !== pageTranslationRunId ||
        !element.isConnected ||
        !isPagePlaceholderVisible(element)
    ) {
        return
    }
    if ((element.getAttribute('placeholder') ?? '') !== sourceText) return

    applyPagePlaceholderTranslation(element, sourceText, translated)
}

function updatePageTranslationStatus() {
    const pendingCount = pageTranslationTextQueue.pendingCount + pageTranslationPlaceholderQueue.pendingCount
    getPageDeps().hideStatus('page')
    if (!pageTranslationEnabled || pendingCount === 0) {
        hidePageTextTranslationStatus()
    }
}

async function drainPageTranslationQueue() {
    while (pageTranslationEnabled) {
        const node = pageTranslationTextQueue.startNext(PAGE_TRANSLATION_CONCURRENCY)
        if (!node) break

        updatePageTranslationStatus()
        void translatePageTextNode(node, pageTranslationRunId).finally(() => {
            pageTranslationTextQueue.complete()
            void drainPageTranslationQueue()
            updatePageTranslationStatus()
        })
    }

    while (pageTranslationEnabled) {
        const element = pageTranslationPlaceholderQueue.startNext(PAGE_TRANSLATION_CONCURRENCY)
        if (!element) break

        updatePageTranslationStatus()
        void translatePagePlaceholderElement(element, pageTranslationRunId).finally(() => {
            pageTranslationPlaceholderQueue.complete()
            void drainPageTranslationQueue()
            updatePageTranslationStatus()
        })
    }
    updatePageTranslationStatus()
}

function restorePageTranslation() {
    for (const node of pageTranslationNodes) {
        const meta = pageTranslationMeta.get(node)
        if (meta && node.isConnected && node.nodeValue === meta.translatedText) {
            node.nodeValue = meta.sourceText
        }
    }
    pageTranslationNodes.clear()

    for (const element of pageTranslationPlaceholderElements) {
        const meta = pageTranslationPlaceholderMeta.get(element)
        if (meta && element.isConnected && element.getAttribute('placeholder') === meta.translatedText) {
            element.setAttribute('placeholder', meta.sourceText)
        }
    }
    pageTranslationPlaceholderElements.clear()
}

function startPageTranslation(sourceLanguage?: DetectableLanguage | null) {
    setPageTranslationSourceOverride(sourceLanguage)
    ensurePageTranslationMutationObserver()
    resetPageTranslationActiveRescanDelay()
    if (pageTranslationEnabled && pageTranslationObserver) {
        markPageTranslationRuntimeState('start-existing')
        schedulePageTranslationActiveRescan()
        collectCurrentPageTranslationTargets()
        updatePageTranslationStatus()
        return
    }

    pageTranslationDebug.lastStartAt = Date.now()
    markPageTranslationRuntimeState('start')
    pageTranslationEnabled = true
    pageTranslationSuggestionDismissed = true
    clearPageTranslationSuggestionTimer()
    stopPageTranslationSuggestionObserver()
    hidePageTranslationPrompt()
    pageTranslationRunId++
    pageTranslationMemory.clearTranslations()
    pageTranslationLastCollectAt = 0

    collectCurrentPageTranslationTargets()
    schedulePageTranslationActiveRescan()
    updatePageTranslationStatus()
    document.addEventListener('scroll', handlePageTranslationViewportChange, true)
    window.addEventListener('resize', handlePageTranslationViewportChange)
    startPageOriginalTooltipListeners()
}

function stopPageTranslation() {
    if (!pageTranslationEnabled) return

    pageTranslationDebug.lastStopAt = Date.now()
    markPageTranslationRuntimeState('stop')
    pageTranslationEnabled = false
    pageTranslationRunId++
    pageTranslationMemory.clearSourceOverride()
    pageTranslationTextQueue.clear()
    pageTranslationPlaceholderQueue.clear()
    pageTranslationMemory.clearActiveRequests()
    resetPageTranslationActiveRescanDelay()
    pageTranslationLastCollectAt = 0
    clearPageTranslationMutationRescan()
    clearPageTranslationActiveRescan()
    document.removeEventListener('scroll', handlePageTranslationViewportChange, true)
    window.removeEventListener('resize', handlePageTranslationViewportChange)
    stopPageOriginalTooltipListeners()
    clearPageTranslationVisibilityObserver()
    getPageDeps().hideStatus('page')
    hidePageTextTranslationStatus()
    restorePageTranslation()
}

export class PageTranslationService {
    constructor(options: PageTranslationServiceOptions) {
        pageDeps = options
    }

    start(sourceLanguage?: DetectableLanguage | null) {
        startPageTranslation(sourceLanguage)
    }

    stop() {
        stopPageTranslation()
    }

    observeMutations() {
        installPageTranslationDebugHook()
        ensurePageTranslationMutationObserver()
    }

    handleRuntimeInvalidated() {
        pageTranslationDebug.lastRuntimeInvalidatedAt = Date.now()
        markPageTranslationRuntimeState('runtime-invalidated')
        stopPageTranslation()
        disconnectPageTranslationMutationObserver()
        stopPageTranslationSuggestionObserver()
        hidePageTranslationPrompt()
        hidePageTextTranslationStatus()
        hidePageOriginalTooltip()
    }

    syncState() {
        void getPageDeps().sendRuntimeMessage<PageTranslationStateResponse>({type: 'PAGE_TRANSLATION_GET_STATE'})
            .then(({response, error, contextInvalidated}) => {
                if (contextInvalidated) {
                    markPageTranslationRuntimeState('sync-context-invalidated')
                    return
                }
                if (!getPageDeps().isRuntimeValid()) {
                    markPageTranslationRuntimeState('sync-runtime-invalid')
                    return
                }
                if (error) {
                    markPageTranslationRuntimeState('sync-transport-error')
                    markPageTranslationError(error)
                    return
                }
                if (!response?.ok) {
                    markPageTranslationRuntimeState('sync-no-state')
                    if (response?.error) markPageTranslationError(response.error)
                    return
                }
                if (response.enabled) {
                    const sourceLanguage = normalizePageTranslationSourceLanguage(response.sourceLanguage)
                    markPageTranslationRuntimeState('sync-enabled')
                    startPageTranslation(sourceLanguage)
                } else if (pageTranslationEnabled) {
                    markPageTranslationRuntimeState('sync-disabled')
                    stopPageTranslation()
                } else {
                    markPageTranslationRuntimeState('sync-inactive')
                }
            })
    }

    registerStateSync() {
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[PAGE_TRANSLATION_TABS_KEY]) {
                    this.syncState()
                }
            })
        } catch (error) {
            getPageDeps().handleRuntimeError(error)
        }
    }

    startSuggestionObserver() {
        startPageTranslationSuggestionObserver()
    }

    scheduleSuggestion(delay = 1200, resetRetries = false) {
        schedulePageTranslationSuggestion(delay, resetRetries)
    }
}
