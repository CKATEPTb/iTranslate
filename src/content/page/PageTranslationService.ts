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

type TranslateMode = 'selection' | 'input' | 'page'
type DetectableLanguage = 'en' | 'ru' | 'ua' | 'de' | 'fr'
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
type PageLanguageAnalysis = {
    sourceLanguage: DetectableLanguage
    mismatchRatio: number
    totalWeight: number
    mismatchWeight: number
}
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

let pageTranslationSourceOverride: DetectableLanguage | null = null

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
let pageTranslationActiveCount = 0
let pageTranslationPlaceholderActiveCount = 0

const pageTranslationQueue: Text[] = []
const pageTranslationQueued = new WeakSet<Text>()
const pageTranslationPlaceholderQueue: PagePlaceholderElement[] = []
const pageTranslationPlaceholderQueued = new WeakSet<PagePlaceholderElement>()
const pageTranslationMeta = new WeakMap<Text, PageTextMeta>()
const pageTranslationPlaceholderMeta = new WeakMap<PagePlaceholderElement, PagePlaceholderMeta>()
const pageTranslationNodes = new Set<Text>()
const pageTranslationPlaceholderElements = new Set<PagePlaceholderElement>()
const pageTranslationObserved = new Map<Element, Set<Text>>()
const pageTranslationObservedPlaceholders = new Set<PagePlaceholderElement>()
const pageTranslationCache = new Map<string, string>()
const pageTranslationSkipCache = new Set<string>()
const pageTranslationInflight = new Map<string, Promise<string | null>>()
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
        sourceOverride: pageTranslationSourceOverride,
        textQueueLength: pageTranslationQueue.length,
        textActiveCount: pageTranslationActiveCount,
        placeholderQueueLength: pageTranslationPlaceholderQueue.length,
        placeholderActiveCount: pageTranslationPlaceholderActiveCount,
        translatedTextNodeCount: pageTranslationNodes.size,
        translatedPlaceholderCount: pageTranslationPlaceholderElements.size,
        observedVisibilityTargets: pageTranslationObserved.size,
        observedVisibilityPlaceholders: pageTranslationObservedPlaceholders.size,
        observedShadowRoots: pageTranslationShadowRoots.size,
        cacheSize: pageTranslationCache.size,
        skipCacheSize: pageTranslationSkipCache.size,
        inflightCount: pageTranslationInflight.size,
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
    if (!sourceLanguage || pageTranslationSourceOverride === sourceLanguage) return false

    pageTranslationSourceOverride = sourceLanguage
    pageTranslationCache.clear()
    pageTranslationSkipCache.clear()
    pageTranslationInflight.clear()
    return true
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
        return Array.from(range.getClientRects()).some(rect =>
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        )
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

function splitPreservingWhitespace(text: string) {
    const leading = text.match(/^\s*/)?.[0] ?? ''
    const trailing = text.match(/\s*$/)?.[0] ?? ''
    return {
        leading,
        value: text.trim(),
        trailing,
    }
}

function hasTranslatableText(text: string): boolean {
    return /[\p{L}]/u.test(text)
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

const PAGE_PROMPT_LANGUAGE_ALIASES: Record<string, DetectableLanguage> = {
    en: 'en',
    eng: 'en',
    english: 'en',
    ru: 'ru',
    rus: 'ru',
    russian: 'ru',
    uk: 'ua',
    ua: 'ua',
    ukr: 'ua',
    ukrainian: 'ua',
    de: 'de',
    deu: 'de',
    ger: 'de',
    german: 'de',
    fr: 'fr',
    fra: 'fr',
    fre: 'fr',
    french: 'fr',
}

const PAGE_PROMPT_FROM_LANGUAGE_NAMES: Record<DetectableLanguage, Record<DetectableLanguage, string>> = {
    en: {
        en: 'English',
        ru: 'Russian',
        ua: 'Ukrainian',
        de: 'German',
        fr: 'French',
    },
    ru: {
        en: 'английского',
        ru: 'русского',
        ua: 'украинского',
        de: 'немецкого',
        fr: 'французского',
    },
    ua: {
        en: 'англійської',
        ru: 'російської',
        ua: 'української',
        de: 'німецької',
        fr: 'французької',
    },
    de: {
        en: 'Englisch',
        ru: 'Russisch',
        ua: 'Ukrainisch',
        de: 'Deutsch',
        fr: 'Französisch',
    },
    fr: {
        en: "l'anglais",
        ru: 'le russe',
        ua: "l'ukrainien",
        de: "l'allemand",
        fr: 'le français',
    },
}

const PAGE_PROMPT_LANGUAGE_CODES: Record<DetectableLanguage, string> = {
    en: 'EN',
    ru: 'RU',
    ua: 'UA',
    de: 'DE',
    fr: 'FR',
}

function parsePromptLanguage(language: string | undefined | null): DetectableLanguage | null {
    if (!language) return null

    const normalized = language.trim().toLowerCase()
    if (!normalized) return null

    for (const part of normalized.split(/[,;]/)) {
        const token = part.trim()
        if (!token) continue

        const primary = token.split(/[-_\s]/)[0]
        const parsed = PAGE_PROMPT_LANGUAGE_ALIASES[token] ?? PAGE_PROMPT_LANGUAGE_ALIASES[primary]
        if (parsed) return parsed
    }

    return null
}

function normalizePromptLanguage(language: string | undefined): DetectableLanguage {
    return parsePromptLanguage(language) ?? 'en'
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

function normalizePageLanguageSampleText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

function getPageLanguageSampleContainer(node: Text): Element | null {
    const block = getSelectionBlockForNode(node)
    if (block && !isDocumentScopeElement(block)) return block

    return node.parentElement
}

function getPageTranslationPromptCopy(targetLanguage: DetectableLanguage, sourceLanguage: DetectableLanguage, hostname: string) {
    const source = PAGE_PROMPT_FROM_LANGUAGE_NAMES[targetLanguage][sourceLanguage]
    const context = `${hostname} · ${PAGE_PROMPT_LANGUAGE_CODES[sourceLanguage]} -> ${PAGE_PROMPT_LANGUAGE_CODES[targetLanguage]}`

    if (targetLanguage === 'ru') {
        return {
            title: 'Перевести страницу?',
            context,
            translate: 'Перевести',
            never: 'Никогда',
            always: 'Всегда',
            neverTitle: `Никогда не переводить ${hostname}`,
            alwaysTitle: `Всегда переводить с ${source}`,
            close: 'Закрыть',
        }
    }

    if (targetLanguage === 'ua') {
        return {
            title: 'Перекласти сторінку?',
            context,
            translate: 'Перекласти',
            never: 'Ніколи',
            always: 'Завжди',
            neverTitle: `Ніколи не перекладати ${hostname}`,
            alwaysTitle: `Завжди перекладати з ${source}`,
            close: 'Закрити',
        }
    }

    if (targetLanguage === 'de') {
        return {
            title: 'Seite übersetzen?',
            context,
            translate: 'Übersetzen',
            never: 'Nie',
            always: 'Immer',
            neverTitle: `${hostname} nie übersetzen`,
            alwaysTitle: `Immer aus ${source} übersetzen`,
            close: 'Schließen',
        }
    }

    if (targetLanguage === 'fr') {
        return {
            title: 'Traduire la page ?',
            context,
            translate: 'Traduire',
            never: 'Jamais',
            always: 'Toujours',
            neverTitle: `Ne jamais traduire ${hostname}`,
            alwaysTitle: `Toujours traduire depuis ${source}`,
            close: 'Fermer',
        }
    }

    return {
        title: 'Translate this page?',
        context,
        translate: 'Translate',
        never: 'Never',
        always: 'Always',
        neverTitle: `Never translate ${hostname}`,
        alwaysTitle: `Always translate from ${source}`,
        close: 'Close',
    }
}

function collectVisiblePageLanguageSamples(): string[] {
    if (!document.body) return []

    const sampleParts = new Map<Element, string[]>()
    let collectedChars = 0
    let scannedTextNodes = 0
    let visibleTextNodes = 0

    walkTextNodesDeep(document.body, node => {
        const rawText = node.textContent?.trim() ?? ''
        if (!hasTranslatableText(rawText)) return

        scannedTextNodes++
        if (scannedTextNodes >= PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES) return false
        if (collectedChars >= PAGE_TRANSLATION_SUGGESTION_MAX_CHARS) return false

        if (!isTextNodeVisible(node)) return
        visibleTextNodes++
        if (visibleTextNodes > PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES) return false

        const value = normalizePageLanguageSampleText(node.nodeValue ?? '')
        if (!value || !hasTranslatableText(value)) return

        const container = getPageLanguageSampleContainer(node)
        if (!container) return

        const parts = sampleParts.get(container) ?? []
        parts.push(value)
        sampleParts.set(container, parts)
        collectedChars += value.length
    })

    const samples: string[] = []
    for (const parts of sampleParts.values()) {
        if (samples.length >= PAGE_TRANSLATION_SUGGESTION_MAX_NODES) break

        const sample = normalizePageLanguageSampleText(parts.join(' '))
        if (sample.length >= 12) {
            samples.push(sample)
        }
    }

    return samples
}

function collectFastVisiblePageLanguageText(): string {
    if (!document.body) return ''

    const parts: string[] = []
    let collectedChars = 0
    let scannedTextNodes = 0
    let visibleTextNodes = 0

    walkTextNodesDeep(document.body, node => {
        const rawText = node.textContent?.trim() ?? ''
        if (!hasTranslatableText(rawText)) return

        scannedTextNodes++
        if (scannedTextNodes >= PAGE_TRANSLATION_FAST_SUGGESTION_MAX_SCANNED_TEXT_NODES) return false
        if (collectedChars >= PAGE_TRANSLATION_FAST_SUGGESTION_MAX_CHARS) return false

        if (!isTextNodeVisible(node)) return
        visibleTextNodes++
        if (visibleTextNodes > PAGE_TRANSLATION_FAST_SUGGESTION_MAX_VISIBLE_TEXT_NODES) return false

        const value = normalizePageLanguageSampleText(node.nodeValue ?? '')
        if (!value || !hasTranslatableText(value)) return

        parts.push(value)
        collectedChars += value.length
    })

    return normalizePageLanguageSampleText(parts.join(' '))
}

function getFastLetterStats(text: string) {
    let letters = 0
    let latin = 0
    let cyrillic = 0

    for (const letter of text.match(/\p{L}/gu) ?? []) {
        letters++
        if (/\p{Script=Latin}/u.test(letter)) latin++
        else if (/\p{Script=Cyrillic}/u.test(letter)) cyrillic++
    }

    return {letters, latin, cyrillic}
}

function fastLanguageScriptMatches(language: DetectableLanguage, stats: ReturnType<typeof getFastLetterStats>): boolean {
    if (stats.letters < PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS) return false

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

function analyzeFastVisiblePageLanguage(targetLanguage: DetectableLanguage): PageLanguageAnalysis | null {
    const text = collectFastVisiblePageLanguageText()
    const stats = getFastLetterStats(text)
    if (stats.letters < PAGE_TRANSLATION_FAST_SUGGESTION_MIN_LETTERS) return null

    const documentLanguage = getDocumentLanguageHint()
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
            fastLanguageScriptMatches(documentLanguage, stats)
        ) {
            sourceLanguage = documentLanguage
            mismatchRatio = 0.65
        }
    } else {
        if (cyrillicRatio >= 0.55) {
            sourceLanguage = guessFastCyrillicLanguage(text, documentLanguage)
            mismatchRatio = cyrillicRatio
        } else if (
            documentLanguage &&
            documentLanguage !== targetLanguage &&
            fastLanguageScriptMatches(documentLanguage, stats)
        ) {
            sourceLanguage = documentLanguage
            mismatchRatio = 0.65
        }
    }

    if (!sourceLanguage || sourceLanguage === targetLanguage) return null

    return {
        sourceLanguage,
        mismatchRatio,
        totalWeight: stats.letters,
        mismatchWeight: Math.round(stats.letters * mismatchRatio),
    }
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
    style.textContent = `#${PAGE_TRANSLATION_PROMPT_ID}{--itranslate-page-prompt-progress:1;--itranslate-page-prompt-bg:rgba(15,23,42,.9);--itranslate-page-prompt-fg:#f8fafc;--itranslate-page-prompt-muted:#cbd5e1;--itranslate-page-prompt-border:rgba(148,163,184,.24);--itranslate-page-prompt-shadow:0 14px 38px rgba(15,23,42,.34);--itranslate-page-prompt-close-bg:rgba(255,255,255,.08);--itranslate-page-prompt-secondary-bg:rgba(255,255,255,.06);--itranslate-page-prompt-secondary-border:rgba(255,255,255,.12);--itranslate-page-prompt-progress-bg:rgba(148,163,184,.2);--itranslate-page-prompt-progress-fg:#38bdf8;position:fixed;right:14px;top:14px;z-index:2147483647;display:none;width:min(304px,calc(100vw - 28px));padding:10px 10px 9px;border-radius:14px;background:var(--itranslate-page-prompt-bg);color:var(--itranslate-page-prompt-fg);border:1px solid var(--itranslate-page-prompt-border);box-shadow:var(--itranslate-page-prompt-shadow);font:12px/1.35 -apple-system,"Segoe UI",sans-serif;backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);overflow:hidden}#${PAGE_TRANSLATION_PROMPT_ID}.itranslate-page-prompt-light{--itranslate-page-prompt-bg:rgba(248,250,252,.95);--itranslate-page-prompt-fg:#0f172a;--itranslate-page-prompt-muted:#64748b;--itranslate-page-prompt-border:rgba(15,23,42,.12);--itranslate-page-prompt-shadow:0 14px 34px rgba(15,23,42,.14);--itranslate-page-prompt-close-bg:rgba(15,23,42,.07);--itranslate-page-prompt-secondary-bg:rgba(255,255,255,.72);--itranslate-page-prompt-secondary-border:rgba(15,23,42,.1);--itranslate-page-prompt-progress-bg:rgba(15,23,42,.1);--itranslate-page-prompt-progress-fg:#0284c7}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-row{display:grid;grid-template-columns:minmax(0,1fr) 22px;align-items:start;gap:8px;margin-bottom:9px}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-title-wrap{min-width:0}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-title{min-width:0;margin:0;font-weight:760;color:var(--itranslate-page-prompt-fg);font-size:13px;line-height:1.2}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-context{display:block;margin-top:3px;color:var(--itranslate-page-prompt-muted);font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-close{width:22px;height:22px;border:0;border-radius:999px;background:var(--itranslate-page-prompt-close-bg);color:var(--itranslate-page-prompt-muted);cursor:pointer;font:15px/1 -apple-system,"Segoe UI",sans-serif}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-actions{display:grid;grid-template-columns:1.18fr .82fr .82fr;gap:6px}#${PAGE_TRANSLATION_PROMPT_ID} button{font:11.5px/1.15 -apple-system,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-primary,#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-secondary{min-width:0;min-height:28px;border-radius:8px;padding:6px 8px;cursor:pointer;text-align:center}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-primary{border:1px solid rgba(56,189,248,.72);background:#38bdf8;color:#082f49;font-weight:750}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-secondary{border:1px solid var(--itranslate-page-prompt-secondary-border);background:var(--itranslate-page-prompt-secondary-bg);color:var(--itranslate-page-prompt-fg)}#${PAGE_TRANSLATION_PROMPT_ID} button:hover{filter:brightness(1.06)}#${PAGE_TRANSLATION_PROMPT_ID} button:focus{outline:2px solid rgba(56,189,248,.45);outline-offset:1px}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-progress{height:2px;margin:9px -10px -9px;background:var(--itranslate-page-prompt-progress-bg);overflow:hidden}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-progress-bar{display:block;width:100%;height:100%;background:var(--itranslate-page-prompt-progress-fg);transform-origin:left center;transform:scaleX(var(--itranslate-page-prompt-progress))}@media (max-width:340px){#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-actions{grid-template-columns:1fr 1fr}#${PAGE_TRANSLATION_PROMPT_ID} .itranslate-page-prompt-primary{grid-column:1 / -1}}`
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
                pageTranslationSourceOverride = null
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

    const close = document.createElement('button')
    close.className = 'itranslate-page-prompt-close'
    close.type = 'button'
    close.setAttribute('aria-label', copy.close)
    close.textContent = '×'

    row.append(titleWrap, close)

    const actions = document.createElement('div')
    actions.className = 'itranslate-page-prompt-actions'

    const translateButton = document.createElement('button')
    translateButton.className = 'itranslate-page-prompt-primary'
    translateButton.type = 'button'
    translateButton.textContent = copy.translate

    const neverButton = document.createElement('button')
    neverButton.className = 'itranslate-page-prompt-secondary'
    neverButton.type = 'button'
    neverButton.textContent = copy.never
    neverButton.title = copy.neverTitle
    neverButton.setAttribute('aria-label', copy.neverTitle)

    const alwaysButton = document.createElement('button')
    alwaysButton.className = 'itranslate-page-prompt-secondary'
    alwaysButton.type = 'button'
    alwaysButton.textContent = copy.always
    alwaysButton.title = copy.alwaysTitle
    alwaysButton.setAttribute('aria-label', copy.alwaysTitle)

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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !getPageDeps().isRuntimeValid()) return
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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !getPageDeps().isRuntimeValid()) return

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
    if (pageTranslationSuggestionObserver || pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !getPageDeps().isRuntimeValid()) return

    const root = document.body ?? document.documentElement
    if (!root) {
        schedulePageTranslationSuggestion(800, true)
        return
    }

    pageTranslationSuggestionObserver = new MutationObserver((mutations) => {
        if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !getPageDeps().isRuntimeValid()) {
            stopPageTranslationSuggestionObserver()
            return
        }

        const hasTextChange = mutations.some((mutation) => {
            if (mutation.type === 'characterData') return true
            return Array.from(mutation.addedNodes).some((node) => {
                observePageTranslationSuggestionShadowRoots(node)
                if (node.nodeType === Node.TEXT_NODE) return hasTranslatableText(node.textContent ?? '')
                if (!(node instanceof Element)) return false
                if (shouldSkipPageTranslationElement(node)) return false
                return hasTranslatableTextDeep(node)
            })
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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !getPageDeps().isRuntimeValid()) return
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
    const translated = pageTranslationCache.get(value)
    if (!translated) return false

    applyPageTranslation(node, sourceText, translated)
    return true
}

function isPageTranslationKnownSkipped(value: string): boolean {
    return pageTranslationSkipCache.has(value)
}

function translatePageValue(value: string): Promise<string | null> {
    if (isPageTranslationKnownSkipped(value)) return Promise.resolve(null)

    const cached = pageTranslationCache.get(value)
    if (cached) return Promise.resolve(cached)

    const inflight = pageTranslationInflight.get(value)
    if (inflight) return inflight

    const request = getPageDeps().translateWithResponse(value, 'page', pageTranslationSourceOverride ?? undefined)
        .then(response => {
            if (!response.ok) {
                pageTranslationDebug.failedTranslations++
                markPageTranslationError(response.error ?? 'Page translation failed')
                return null
            }
            if (response.skipped) {
                pageTranslationDebug.skippedTranslations++
                pageTranslationSkipCache.add(value)
                return null
            }
            const translated = response.ok && !response.skipped && typeof response.translatedText === 'string'
                ? response.translatedText
                : null
            if (translated) pageTranslationCache.set(value, translated)
            return translated
        })
        .finally(() => {
            pageTranslationInflight.delete(value)
        })

    pageTranslationInflight.set(value, request)
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

    return Array.from(element.getClientRects()).some(rect => (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth
    ))
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
    const translated = pageTranslationCache.get(value)
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

    for (const [target, nodes] of Array.from(pageTranslationObserved)) {
        for (const node of Array.from(nodes)) {
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
    scheduleObservedPageTextNodeCheck()
}

function checkObservedPagePlaceholders() {
    if (!pageTranslationEnabled) return

    for (const element of Array.from(pageTranslationObservedPlaceholders)) {
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
    if (!pageTranslationEnabled || pageTranslationQueued.has(node) || !isPageTranslationCandidate(node)) return
    if (requireVisible && !isTextNodeVisible(node)) {
        observePageTextNode(node)
        return
    }
    if (reusePageTranslationIfUnchanged(node)) return
    if (applyCachedPageTranslationIfAvailable(node)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(node.nodeValue ?? '').value)) return

    unobservePageTextNode(node)
    pageTranslationQueued.add(node)
    pageTranslationQueue.push(node)
    pageTranslationDebug.queuedText++
    updatePageTranslationStatus()
    void drainPageTranslationQueue()
}

function enqueuePagePlaceholderElement(element: PagePlaceholderElement, requireVisible = true) {
    if (
        !pageTranslationEnabled ||
        pageTranslationPlaceholderQueued.has(element) ||
        !isPageTranslationPlaceholderCandidate(element)
    ) {
        return
    }
    if (requireVisible && !isPagePlaceholderVisible(element)) {
        observePagePlaceholderElement(element)
        return
    }
    if (reusePagePlaceholderTranslationIfUnchanged(element)) return
    if (applyCachedPagePlaceholderTranslationIfAvailable(element)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(element.getAttribute('placeholder') ?? '').value)) return

    pageTranslationObservedPlaceholders.delete(element)
    pageTranslationVisibilityObserver?.unobserve(element)
    pageTranslationPlaceholderQueued.add(element)
    pageTranslationPlaceholderQueue.push(element)
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

    walkTextNodesDeep(root, node => {
        if (isPageTranslationCandidate(node)) enqueuePageTextNode(node)
    })
}

function collectPagePlaceholderElements(root: Node) {
    if (!pageTranslationEnabled) return
    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

    if (root instanceof Element && isPageTranslationPlaceholderCandidate(root)) {
        enqueuePagePlaceholderElement(root)
    }

    if (root instanceof Element && shouldSkipPageTranslationPlaceholderElement(root)) return

    root.querySelectorAll?.('input[placeholder], textarea[placeholder]').forEach(element => {
        if (isPageTranslationPlaceholderCandidate(element)) enqueuePagePlaceholderElement(element)
    })
}

function collectCurrentPageTranslationTargets() {
    if (!pageTranslationEnabled) return

    const root = document.body ?? document.documentElement
    if (!root) return

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

        if (document.visibilityState === 'visible') {
            pageTranslationDebug.activeRescansRun++
            collectCurrentPageTranslationTargets()
        }

        schedulePageTranslationActiveRescan()
    }, PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS)
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
            shouldRescan = true
            continue
        }

        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
            if (mutation.attributeName === 'hidden' || mutation.attributeName === 'aria-hidden') {
                collectPageTextNodes(mutation.target)
            }
            if (
                mutation.attributeName === 'placeholder' ||
                mutation.attributeName === 'type' ||
                mutation.attributeName === 'class' ||
                mutation.attributeName === 'style' ||
                mutation.attributeName === 'hidden' ||
                mutation.attributeName === 'aria-hidden'
            ) {
                collectPagePlaceholderElements(mutation.target)
            }
            scheduleObservedPageTextNodeCheck()
            shouldRescan = true
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
    const cached = pageTranslationCache.get(value)
    if (cached) {
        applyPageTranslation(node, sourceText, cached)
        return
    }

    const existingRequest = pageTranslationInflight.get(value)
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
    const cached = pageTranslationCache.get(value)
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
    const pendingCount = pageTranslationQueue.length +
        pageTranslationActiveCount +
        pageTranslationPlaceholderQueue.length +
        pageTranslationPlaceholderActiveCount
    getPageDeps().hideStatus('page')
    if (!pageTranslationEnabled || pendingCount === 0) {
        hidePageTextTranslationStatus()
    }
}

async function drainPageTranslationQueue() {
    while (pageTranslationEnabled && pageTranslationActiveCount < PAGE_TRANSLATION_CONCURRENCY && pageTranslationQueue.length > 0) {
        const node = pageTranslationQueue.shift()
        if (!node) continue

        pageTranslationQueued.delete(node)
        pageTranslationActiveCount++
        updatePageTranslationStatus()
        void translatePageTextNode(node, pageTranslationRunId).finally(() => {
            pageTranslationActiveCount = Math.max(0, pageTranslationActiveCount - 1)
            void drainPageTranslationQueue()
            updatePageTranslationStatus()
        })
    }

    while (
        pageTranslationEnabled &&
        pageTranslationPlaceholderActiveCount < PAGE_TRANSLATION_CONCURRENCY &&
        pageTranslationPlaceholderQueue.length > 0
    ) {
        const element = pageTranslationPlaceholderQueue.shift()
        if (!element) continue

        pageTranslationPlaceholderQueued.delete(element)
        pageTranslationPlaceholderActiveCount++
        updatePageTranslationStatus()
        void translatePagePlaceholderElement(element, pageTranslationRunId).finally(() => {
            pageTranslationPlaceholderActiveCount = Math.max(0, pageTranslationPlaceholderActiveCount - 1)
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
    pageTranslationCache.clear()
    pageTranslationSkipCache.clear()
    pageTranslationInflight.clear()

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
    pageTranslationSourceOverride = null
    pageTranslationQueue.length = 0
    pageTranslationPlaceholderQueue.length = 0
    pageTranslationInflight.clear()
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
