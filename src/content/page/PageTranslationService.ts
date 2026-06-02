import {
    closestElementDeep,
} from '../dom/domUtils'
import type {DetectableLanguage} from '../../languageDetection'
import {
    normalizePromptLanguage,
} from './pagePromptCopy'
import {hasTranslatableText, splitPreservingWhitespace} from './pageTextUtils'
import {PageTranslationMemory} from './pageTranslationMemory'
import {PageTranslationWorkQueue} from './pageTranslationWorkQueue'
import {PageTranslationDiagnostics} from './pageTranslationDiagnostics'
import {PageTranslationStatusController} from './pageTranslationStatus'
import {PageOriginalTooltipController} from './pageOriginalTooltip'
import {PageTranslationPromptController} from './pageTranslationPrompt'
import {PageTranslationSuggestionWatcher} from './pageTranslationSuggestionWatcher'
import {
    PAGE_TRANSLATION_CONCURRENCY,
    PAGE_TRANSLATION_PLACEHOLDER_SKIP_SELECTOR,
    PAGE_TRANSLATION_SKIP_SELECTOR,
    PAGE_TRANSLATION_SUGGESTION_THRESHOLD,
    PAGE_TRANSLATION_TABS_KEY,
    TOOLTIP_ID,
} from './pageTranslationConfig'
import type {
    PageLanguageAnalysis,
    PagePlaceholderElement,
    PagePlaceholderMeta,
    PageTextMeta,
    PageTranslationAnalyzeSamplesRequest,
    PageTranslationAnalyzeSamplesResponse,
    PageTranslationServiceOptions,
    PageTranslationSetSitePreferenceResponse,
    PageTranslationStateResponse,
    PageTranslationSuggestSettingsResponse,
} from './pageTranslationContracts'
import {normalizeSiteHostname, PageTranslationDomAdapter} from './pageTranslationDom'
import {PageTranslationVisibilityTracker} from './pageTranslationVisibility'
import {PageTranslationRescanScheduler} from './pageTranslationRescanScheduler'

let pageDeps: PageTranslationServiceOptions | null = null

function getPageDeps(): PageTranslationServiceOptions {
    if (!pageDeps) throw new Error('PageTranslationService has not been initialized')
    return pageDeps
}

let pageTranslationEnabled = false
let pageTranslationObserver: MutationObserver | null = null
let pageTranslationRunId = 0

const pageTranslationTextQueue = new PageTranslationWorkQueue<Text>()
const pageTranslationPlaceholderQueue = new PageTranslationWorkQueue<PagePlaceholderElement>()
const pageTranslationMemory = new PageTranslationMemory()
const pageTranslationMeta = new WeakMap<Text, PageTextMeta>()
const pageTranslationPlaceholderMeta = new WeakMap<PagePlaceholderElement, PagePlaceholderMeta>()
const pageTranslationNodes = new Set<Text>()
const pageTranslationPlaceholderElements = new Set<PagePlaceholderElement>()
const pageTranslationShadowRoots = new Set<ShadowRoot>()
const pageTranslationDom = new PageTranslationDomAdapter(shouldSkipPageTranslationElement)
const pageTranslationVisibility = new PageTranslationVisibilityTracker({
    isEnabled: () => pageTranslationEnabled,
    isTextCandidate: isPageTranslationCandidate,
    isTextVisible: isTextNodeVisible,
    walkTextNodesDeep,
    enqueueText: node => enqueuePageTextNode(node, false),
    isPlaceholderElement: isPagePlaceholderElement,
    isPlaceholderCandidate: isPageTranslationPlaceholderCandidate,
    isPlaceholderVisible: isPagePlaceholderVisible,
    enqueuePlaceholder: element => enqueuePagePlaceholderElement(element, false),
})
const pageTranslationStatus = new PageTranslationStatusController({
    isEnabled: () => pageTranslationEnabled,
    isTextNodeVisible,
})
const pageOriginalTooltip = new PageOriginalTooltipController({
    tooltipId: TOOLTIP_ID,
    getTooltip: () => getPageDeps().getTooltip(),
    isEnabled: () => pageTranslationEnabled,
    getSourceText: node => {
        const meta = getActivePageTranslationMeta(node)
        return meta ? meta.sourceText.trim() || meta.sourceValue : null
    },
    walkTextNodesDeep,
})
const pageTranslationPrompt = new PageTranslationPromptController({
    isRuntimeValid: () => getPageDeps().isRuntimeValid(),
    handleRuntimeError: error => getPageDeps().handleRuntimeError(error),
    onDismiss: () => {
        pageTranslationSuggestionDismissed = true
    },
    onTranslate: sourceLanguage => {
        requestPageTranslationStart(sourceLanguage)
    },
    onNever: hostname => {
        void getPageDeps().sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
            type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE',
            hostname,
            action: 'never',
        })
    },
    onAlways: (hostname, sourceLanguage) => {
        void getPageDeps().sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
            type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE',
            hostname,
            action: 'always-from',
            language: sourceLanguage,
        }).then(({response}) => {
            if (response?.ok) requestPageTranslationStart(sourceLanguage)
        })
    },
})
const pageTranslationSuggestionWatcher = new PageTranslationSuggestionWatcher({
    isBlocked: isPageTranslationSuggestionBlocked,
    suggest: maybeSuggestPageTranslation,
    walkOpenShadowRootsDeep,
    shouldSkipElement: shouldSkipPageTranslationElement,
    hasTranslatableTextDeep,
})
let pageTranslationSuggestionDismissed = false
const pageTranslationDebug = new PageTranslationDiagnostics()
const pageTranslationRescanScheduler = new PageTranslationRescanScheduler({
    isEnabled: () => pageTranslationEnabled,
    hasPendingWork: hasPendingPageTranslationWork,
    getQueuedWorkCount: () => pageTranslationDebug.queuedWorkCount,
    collectTargets: collectCurrentPageTranslationTargets,
    onCollectRun: () => {
        pageTranslationDebug.collectRuns++
    },
    onMutationScheduled: () => {
        pageTranslationDebug.mutationRescansScheduled++
    },
    onMutationRun: () => {
        pageTranslationDebug.mutationRescansRun++
    },
    onActiveRun: () => {
        pageTranslationDebug.activeRescansRun++
    },
})

function markPageTranslationRuntimeState(state: string) {
    pageTranslationDebug.markRuntimeState(state)
}

function markPageTranslationError(error: unknown) {
    pageTranslationDebug.markError(error)
}

function getPageTranslationDebugSnapshot(): Record<string, unknown> {
    return {
        enabled: pageTranslationEnabled,
        observerActive: !!pageTranslationObserver,
        visibilityObserverActive: pageTranslationVisibility.isActive,
        runtimeValid: pageDeps?.isRuntimeValid() ?? false,
        runId: pageTranslationRunId,
        sourceOverride: pageTranslationMemory.sourceLanguageOverride,
        textQueueLength: pageTranslationTextQueue.length,
        textActiveCount: pageTranslationTextQueue.activeCount,
        placeholderQueueLength: pageTranslationPlaceholderQueue.length,
        placeholderActiveCount: pageTranslationPlaceholderQueue.activeCount,
        translatedTextNodeCount: pageTranslationNodes.size,
        translatedPlaceholderCount: pageTranslationPlaceholderElements.size,
        observedVisibilityTargets: pageTranslationVisibility.observedTextTargetCount,
        observedVisibilityPlaceholders: pageTranslationVisibility.observedPlaceholderCount,
        observedShadowRoots: pageTranslationShadowRoots.size,
        cacheSize: pageTranslationMemory.cacheSize,
        skipCacheSize: pageTranslationMemory.skipCacheSize,
        inflightCount: pageTranslationMemory.inflightCount,
        suggestionObserverActive: pageTranslationSuggestionWatcher.isObserverActive,
        suggestionDismissed: pageTranslationSuggestionDismissed,
        ...pageTranslationDebug.getSnapshotFields(
            pageTranslationRescanScheduler.activeRescanDelay,
            pageTranslationRescanScheduler.lastCollectAt,
        ),
    }
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

function getActivePageTranslationMeta(node: Text): PageTextMeta | null {
    const meta = pageTranslationMeta.get(node)
    if (!meta || meta.runId !== pageTranslationRunId) return null

    const text = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(text)
    if (text !== meta.translatedText && value !== meta.translatedValue) return null

    return meta
}

function walkTextNodesDeep(root: Node, visitText: (node: Text) => boolean | void): boolean {
    return pageTranslationDom.walkTextNodesDeep(root, visitText)
}

function walkOpenShadowRootsDeep(root: Node, visitShadowRoot: (root: ShadowRoot) => void) {
    pageTranslationDom.walkOpenShadowRootsDeep(root, visitShadowRoot)
}

function hasTranslatableTextDeep(root: Node): boolean {
    return pageTranslationDom.hasTranslatableTextDeep(root)
}

function isTextNodeVisible(node: Text): boolean {
    return pageTranslationDom.isTextNodeVisible(node)
}

async function analyzeVisiblePageLanguage(targetLanguage: DetectableLanguage): Promise<PageLanguageAnalysis | null> {
    const samples = pageTranslationDom.collectVisiblePageLanguageSamples()
    if (samples.length === 0) return null

    const request: PageTranslationAnalyzeSamplesRequest = {
        type: 'PAGE_TRANSLATION_ANALYZE_SAMPLES',
        target: targetLanguage,
        samples,
    }
    const documentLanguage = pageTranslationDom.getDocumentLanguageHint()
    if (documentLanguage) request.documentLanguage = documentLanguage

    const {response, contextInvalidated} = await getPageDeps().sendRuntimeMessage<PageTranslationAnalyzeSamplesResponse>(request)
    if (contextInvalidated || !getPageDeps().isRuntimeValid()) return null
    return response?.ok ? response.analysis ?? null : null
}

function requestPageTranslationStart(sourceLanguage: DetectableLanguage) {
    startPageTranslation(sourceLanguage)

    void getPageDeps().sendRuntimeMessage<PageTranslationStateResponse>({
        type: 'PAGE_TRANSLATION_SET_ACTIVE',
        enabled: true,
        sourceLanguage,
        persist: false,
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
    return pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPrompt.isVisible() || !getPageDeps().isRuntimeValid()
}

async function maybeSuggestPageTranslation() {
    if (isPageTranslationSuggestionBlocked()) return
    if (!document.body) {
        pageTranslationSuggestionWatcher.schedule(800)
        pageTranslationSuggestionWatcher.startObserver()
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
        pageTranslationPrompt.hide()
        return
    }

    const targetLanguage = normalizePromptLanguage(response.target)
    const fastAnalysis = pageTranslationDom.analyzeFastVisiblePageLanguage(targetLanguage)
    const analysis = fastAnalysis ?? await analyzeVisiblePageLanguage(targetLanguage)
    if (!analysis || analysis.mismatchRatio < PAGE_TRANSLATION_SUGGESTION_THRESHOLD) {
        pageTranslationPrompt.hide()
        pageTranslationSuggestionWatcher.startObserver()
        pageTranslationSuggestionWatcher.scheduleRetry()
        return
    }

    pageTranslationSuggestionWatcher.resetRetries()
    pageTranslationSuggestionWatcher.stopObserver()

    if (response.alwaysFrom?.includes(analysis.sourceLanguage)) {
        pageTranslationSuggestionDismissed = true
        pageTranslationPrompt.hide()
        requestPageTranslationStart(analysis.sourceLanguage)
        return
    }

    pageTranslationPrompt.show(response.hostname || hostname, targetLanguage, analysis.sourceLanguage)
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

function handlePageTranslationViewportChange() {
    pageTranslationRescanScheduler.resetActiveDelay()
    pageTranslationVisibility.scheduleCheck()
}

function enqueuePageTextNode(node: Text, requireVisible = true) {
    if (!pageTranslationEnabled || pageTranslationTextQueue.isQueued(node) || !isPageTranslationCandidate(node)) return
    if (requireVisible && !isTextNodeVisible(node)) {
        pageTranslationVisibility.observeTextNode(node)
        return
    }
    if (reusePageTranslationIfUnchanged(node)) return
    if (applyCachedPageTranslationIfAvailable(node)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(node.nodeValue ?? '').value)) return

    pageTranslationVisibility.unobserveTextNode(node)
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
        pageTranslationVisibility.observePlaceholderElement(element)
        return
    }
    if (reusePagePlaceholderTranslationIfUnchanged(element)) return
    if (applyCachedPagePlaceholderTranslationIfAvailable(element)) return
    if (isPageTranslationKnownSkipped(splitPreservingWhitespace(element.getAttribute('placeholder') ?? '').value)) return

    pageTranslationVisibility.unobservePlaceholderElement(element)
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

function hasPendingPageTranslationWork(): boolean {
    return pageTranslationTextQueue.hasPending() ||
        pageTranslationPlaceholderQueue.hasPending() ||
        pageTranslationMemory.hasActiveRequests()
}

function collectCurrentPageTranslationTargets() {
    if (!pageTranslationEnabled) return

    const root = document.body ?? document.documentElement
    if (!root) return

    pageTranslationRescanScheduler.markCollected()
    observePageTranslationShadowRoots(root)
    collectPageTextNodes(root)
    collectPagePlaceholderElements(root)
    pageTranslationVisibility.scheduleCheck()
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
    pageTranslationDebug.markMutationBatch(mutations.length, pageTranslationEnabled)

    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => observePageTranslationShadowRoots(node))
    }

    if (!pageTranslationEnabled) {
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
            pageTranslationVisibility.scheduleCheck()
            continue
        }

        mutation.addedNodes.forEach(node => {
            collectPageTextNodes(node)
            collectPagePlaceholderElements(node)
            shouldRescan = true
        })
        mutation.removedNodes.forEach(node => {
            pageTranslationVisibility.forgetTextNodes(node)
            pageTranslationVisibility.forgetPlaceholders(node)
        })
    }
    if (shouldRescan) pageTranslationRescanScheduler.scheduleMutation()
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
        pageTranslationVisibility.observeTextNode(node)
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
    if (!existingRequest) pageTranslationStatus.show(node, 'Translating...')
    try {
        const translated = await (existingRequest ?? translatePageValue(value))
        if (!translated) return

        if (!pageTranslationEnabled || runId !== pageTranslationRunId || !node.isConnected) return
        if (!isTextNodeVisible(node)) {
            pageTranslationVisibility.observeTextNode(node)
            return
        }
        if ((node.nodeValue ?? '') !== sourceText) return

        applyPageTranslation(node, sourceText, translated)
    } finally {
        if (!existingRequest) pageTranslationStatus.hide(node)
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
        pageTranslationVisibility.observePlaceholderElement(element)
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
        pageTranslationStatus.hide()
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
    pageTranslationRescanScheduler.resetActiveDelay()
    if (pageTranslationEnabled && pageTranslationObserver) {
        markPageTranslationRuntimeState('start-existing')
        pageTranslationRescanScheduler.scheduleActive()
        collectCurrentPageTranslationTargets()
        updatePageTranslationStatus()
        return
    }

    pageTranslationDebug.lastStartAt = Date.now()
    markPageTranslationRuntimeState('start')
    pageTranslationEnabled = true
    pageTranslationSuggestionDismissed = true
    pageTranslationSuggestionWatcher.clearTimer()
    pageTranslationSuggestionWatcher.stopObserver()
    pageTranslationPrompt.hide()
    pageTranslationRunId++
    pageTranslationMemory.clearTranslations()
    pageTranslationRescanScheduler.resetCollectionTime()

    collectCurrentPageTranslationTargets()
    pageTranslationRescanScheduler.scheduleActive()
    updatePageTranslationStatus()
    document.addEventListener('scroll', handlePageTranslationViewportChange, true)
    window.addEventListener('resize', handlePageTranslationViewportChange)
    pageOriginalTooltip.start()
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
    pageTranslationRescanScheduler.resetActiveDelay()
    pageTranslationRescanScheduler.resetCollectionTime()
    pageTranslationRescanScheduler.clearAll()
    document.removeEventListener('scroll', handlePageTranslationViewportChange, true)
    window.removeEventListener('resize', handlePageTranslationViewportChange)
    pageOriginalTooltip.stop()
    pageTranslationVisibility.clear()
    getPageDeps().hideStatus('page')
    pageTranslationStatus.hide()
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
        pageTranslationDebug.installHook(getPageTranslationDebugSnapshot)
        ensurePageTranslationMutationObserver()
    }

    handleRuntimeInvalidated() {
        pageTranslationDebug.lastRuntimeInvalidatedAt = Date.now()
        markPageTranslationRuntimeState('runtime-invalidated')
        stopPageTranslation()
        disconnectPageTranslationMutationObserver()
        pageTranslationSuggestionWatcher.stopObserver()
        pageTranslationPrompt.hide()
        pageTranslationStatus.hide()
        pageOriginalTooltip.hide()
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
        pageTranslationSuggestionWatcher.startObserver()
    }

    scheduleSuggestion(delay = 1200, resetRetries = false) {
        pageTranslationSuggestionWatcher.schedule(delay, resetRetries)
    }
}
