import {autoUpdate, computePosition, flip, offset, shift, type VirtualElement} from '@floating-ui/dom'

type TranslateMode = 'selection' | 'input' | 'page'
type DetectableLanguage = 'en' | 'ru' | 'ua' | 'de' | 'fr'
type TranslateResponse = { ok: true; translatedText: string; skipped?: boolean } | { ok: false; error?: string }
type TranslatePrecheckResponse = { ok: true; skipped: boolean } | { ok: false; error?: string }
type PageTranslationStateResponse = { ok: boolean; enabled?: boolean; error?: string }
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
type TooltipOwner = 'selection' | 'page-original'
type TooltipController = {
    show(text: string, getRect: () => DOMRect, owner?: TooltipOwner): void
    showLoading(getRect: () => DOMRect, owner?: TooltipOwner): void
    showError(message: string, getRect: () => DOMRect, owner?: TooltipOwner): void
    hide(owner?: TooltipOwner): void
    isVisible(): boolean
    isOwnedBy(owner: TooltipOwner): boolean
}
type RuntimeMessageResult<T> = {response?: T; error?: string; contextInvalidated?: boolean}

const TOOLTIP_ID = 'itranslate-tooltip'
const STATUS_ID = 'itranslate-status'
const STATUS_STYLE_ID = 'itranslate-status-style'
const PAGE_TRANSLATION_TABS_KEY = 'itranslate-page-translation-tabs'
const PAGE_TRANSLATION_PROMPT_ID = 'itranslate-page-translation-prompt'
const PAGE_TRANSLATION_PROMPT_STYLE_ID = 'itranslate-page-translation-prompt-style'
const PAGE_STATUS_CLASS = 'itranslate-page-status'
const PAGE_STATUS_STYLE_ID = 'itranslate-page-status-style'
const DELAY_MS = 400
const MAX_GAP_PX = 96
const PAGE_TRANSLATION_CONCURRENCY = 3
const PAGE_ORIGINAL_TOOLTIP_DELAY_MS = 1250
const PAGE_TRANSLATION_SUGGESTION_THRESHOLD = 0.05
const PAGE_TRANSLATION_SUGGESTION_MAX_NODES = 140
const PAGE_TRANSLATION_SUGGESTION_MAX_VISIBLE_TEXT_NODES = 800
const PAGE_TRANSLATION_SUGGESTION_MAX_SCANNED_TEXT_NODES = 5000
const PAGE_TRANSLATION_SUGGESTION_MAX_CHARS = 9000
const PAGE_TRANSLATION_SUGGESTION_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000]
const PAGE_TRANSLATION_PROMPT_TIMEOUT_MS = 12000
const INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password'])
const MIDDLEWARE = [offset(10), flip({padding: 8}), shift({padding: 8})]
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
const SELECTION_TRANSLATION_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_STATUS_CLASS}`,
].join(',')

let extensionContextValid = true
let pageTranslationSourceOverride: DetectableLanguage | null = null

function isExtensionContextInvalidatedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    return /extension context invalidated/i.test(message)
}

function deactivateExtensionContext() {
    if (!extensionContextValid) return

    extensionContextValid = false
    try {
        stopPageTranslation()
        stopPageTranslationSuggestionObserver()
        hideTranslationStatus('input')
        hideTranslationStatus('page')
        hidePageTextTranslationStatus()
        hidePageOriginalTooltip()
    } catch {
        // The old content script is being detached; keep teardown best-effort.
    }
}

function handleExtensionContextError(error: unknown): boolean {
    if (!isExtensionContextInvalidatedError(error)) return false

    deactivateExtensionContext()
    return true
}

function hasExtensionContext(): boolean {
    try {
        return extensionContextValid && typeof chrome !== 'undefined' && !!chrome.runtime?.id
    } catch (error) {
        handleExtensionContextError(error)
        return false
    }
}

function sendRuntimeMessage<T>(message: unknown): Promise<RuntimeMessageResult<T>> {
    return new Promise(resolve => {
        if (!hasExtensionContext()) {
            deactivateExtensionContext()
            resolve({contextInvalidated: true, error: 'Extension context invalidated'})
            return
        }

        try {
            chrome.runtime.sendMessage(message, (response: T | undefined) => {
                try {
                    const lastError = chrome.runtime.lastError
                    if (lastError) {
                        const error = lastError.message
                        resolve({
                            error,
                            contextInvalidated: handleExtensionContextError(error),
                        })
                        return
                    }
                } catch (error) {
                    resolve({
                        error: error instanceof Error ? error.message : String(error),
                        contextInvalidated: handleExtensionContextError(error),
                    })
                    return
                }

                resolve({response})
            })
        } catch (error) {
            resolve({
                error: error instanceof Error ? error.message : String(error),
                contextInvalidated: handleExtensionContextError(error),
            })
        }
    })
}

const translateWithResponse = async (text: string, mode: TranslateMode): Promise<TranslateResponse> => {
    const fromOverride = mode === 'page' ? pageTranslationSourceOverride ?? undefined : undefined
    const result = await sendRuntimeMessage<TranslateResponse>({type: 'TRANSLATE_TEXT', text, mode, fromOverride})
    if (result.contextInvalidated) return {ok: false, error: 'Extension context invalidated'}
    if (result.error) return {ok: false, error: result.error}
    return result.response ?? {ok: false, error: 'Translation failed'}
}

const precheckTranslateWithResponse = async (text: string, mode: TranslateMode): Promise<TranslatePrecheckResponse> => {
    const result = await sendRuntimeMessage<TranslatePrecheckResponse>({type: 'TRANSLATE_TEXT_PRECHECK', text, mode})
    if (result.contextInvalidated) return {ok: false, error: 'Extension context invalidated'}
    if (result.error) return {ok: false, error: result.error}
    return result.response ?? {ok: false, error: 'Translation precheck failed'}
}

const translate = async (text: string, mode: TranslateMode): Promise<string | null> => {
    const response = await translateWithResponse(text, mode)
    return response.ok && !response.skipped && typeof response.translatedText === 'string' ? response.translatedText : null
}

type TranslationStatusKey = 'input' | 'page'

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

type VisibleSelectionExtract = {
    text: string
    rects: DOMRect[]
}

type SelectionPoint = {
    x: number
    y: number
    timestamp: number
}

type VisibleSelectionCandidate = {
    text: string
    node: Text
    container: Element | null
    block: Element | null
    rects: DOMRect[]
}

let pageTranslationEnabled = false
let pageTranslationObserver: MutationObserver | null = null
let pageTranslationSuggestionObserver: MutationObserver | null = null
let pageTranslationVisibilityObserver: IntersectionObserver | null = null
let pageTranslationRunId = 0
let pageTranslationActiveCount = 0

const pageTranslationQueue: Text[] = []
const pageTranslationQueued = new WeakSet<Text>()
const pageTranslationMeta = new WeakMap<Text, PageTextMeta>()
const pageTranslationNodes = new Set<Text>()
const pageTranslationObserved = new Map<Element, Set<Text>>()
const pageTranslationCache = new Map<string, string>()
const pageTranslationInflight = new Map<string, Promise<string | null>>()
const pageTranslationShadowRoots = new Set<ShadowRoot>()
const pageTranslationSuggestionShadowRoots = new Set<ShadowRoot>()
const pageTranslationStatuses = new WeakMap<Text, PageTranslationStatus>()
const pageTranslationStatusNodes = new Set<Text>()
const translationStatuses = new Map<TranslationStatusKey, string>()

let translationStatusEl: HTMLElement | null = null
let translationStatusTextEl: HTMLElement | null = null
let translationStatusHideTimer: number | null = null
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
let sharedTooltip: TooltipController | null = null

function ensureTranslationStatus() {
    if (!document.getElementById(STATUS_STYLE_ID)) {
        const style = document.createElement('style')
        style.id = STATUS_STYLE_ID
        style.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}#${STATUS_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none;align-items:center;gap:8px;max-width:min(320px,calc(100vw - 32px));padding:9px 12px;border-radius:12px;background:rgba(15,23,42,.88);color:#f8fafc;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 32px rgba(15,23,42,.32);font:13px/1.35 -apple-system,"Segoe UI",sans-serif;pointer-events:none;backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%)}#${STATUS_ID} .itranslate-status-spinner{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}#${STATUS_ID} .itranslate-status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`
        document.documentElement.appendChild(style)
    }

    if (translationStatusEl?.isConnected && translationStatusTextEl?.isConnected) return

    const el = document.createElement('div')
    el.id = STATUS_ID
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')

    const spinner = document.createElement('span')
    spinner.className = 'itranslate-status-spinner'

    const text = document.createElement('span')
    text.className = 'itranslate-status-text'

    el.append(spinner, text)
    document.documentElement.appendChild(el)
    translationStatusEl = el
    translationStatusTextEl = text
}

function renderTranslationStatus() {
    if (translationStatuses.size === 0) {
        if (translationStatusHideTimer !== null) clearTimeout(translationStatusHideTimer)
        translationStatusHideTimer = window.setTimeout(() => {
            if (translationStatusEl) translationStatusEl.style.display = 'none'
        }, 150)
        return
    }

    ensureTranslationStatus()
    if (translationStatusHideTimer !== null) {
        clearTimeout(translationStatusHideTimer)
        translationStatusHideTimer = null
    }

    const messages = Array.from(translationStatuses.values())
    if (translationStatusTextEl) {
        translationStatusTextEl.textContent = messages.length > 1 ? 'Please wait, translating...' : messages[0]
    }
    if (translationStatusEl) {
        translationStatusEl.style.display = 'flex'
    }
}

function showTranslationStatus(key: TranslationStatusKey, message: string) {
    translationStatuses.set(key, message)
    renderTranslationStatus()
}

function hideTranslationStatus(key: TranslationStatusKey) {
    translationStatuses.delete(key)
    renderTranslationStatus()
}

function getViewportSize() {
    const doc = document.documentElement
    return {
        width: window.innerWidth || doc.clientWidth,
        height: window.innerHeight || doc.clientHeight,
    }
}

function rectIntersectsViewport(rect: DOMRect | DOMRectReadOnly): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false

    const {width, height} = getViewportSize()
    return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width
}

function getOpenShadowRoot(node: Node): ShadowRoot | null {
    if (!(node instanceof Element)) return null

    try {
        return node.shadowRoot
    } catch {
        return null
    }
}

function getShadowHostForNode(node: Node): Element | null {
    const root = node.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
}

function getShadowIncludingParentElement(element: Element): Element | null {
    return element.parentElement ?? getShadowHostForNode(element)
}

function closestElementDeep(element: Element, selector: string): Element | null {
    let current: Element | null = element

    while (current) {
        const match = current.closest(selector)
        if (match) return match

        current = getShadowHostForNode(current)
    }

    return null
}

function getTextNodeElement(node: Text): HTMLElement | null {
    const parent = node.parentElement ?? getShadowHostForNode(node)
    return parent instanceof HTMLElement ? parent : null
}

function isElementStyleVisible(element: Element): boolean {
    let current: Element | null = element
    while (current) {
        if (current instanceof HTMLElement) {
            if (current.hidden) return false

            const style = window.getComputedStyle(current)
            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.visibility === 'collapse' ||
                style.getPropertyValue('content-visibility') === 'hidden' ||
                Number(style.opacity) === 0
            ) {
                return false
            }
        }

        if (current === document.documentElement) break
        current = getShadowIncludingParentElement(current)
    }

    return true
}

function isElementVisibleForSelection(element: Element): boolean {
    if (closestElementDeep(element, SELECTION_TRANSLATION_SKIP_SELECTOR)) return false

    let current: Element | null = element
    while (current) {
        if (current instanceof HTMLElement) {
            if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false

            const style = window.getComputedStyle(current)
            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.visibility === 'collapse' ||
                style.getPropertyValue('content-visibility') === 'hidden' ||
                Number(style.opacity) === 0
            ) {
                return false
            }
        }

        if (current === document.documentElement) break
        current = getShadowIncludingParentElement(current)
    }

    return true
}

function getVisibleSelectionRangeRects(range: Range): DOMRect[] {
    return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function rectIntersectsAny(rect: DOMRect, rects: DOMRect[]): boolean {
    return rects.some(selectionRect => rectsOverlap(rect, selectionRect))
}

function selectionRangeIntersectsNode(range: Range, node: Node): boolean {
    try {
        return range.intersectsNode(node)
    } catch {
        return false
    }
}

function getTextNodesInSelectionRange(range: Range): Text[] {
    const root = range.commonAncestorContainer
    if (root.nodeType === Node.TEXT_NODE) return [root as Text].filter(node => selectionRangeIntersectsNode(range, node))

    const nodes: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return selectionRangeIntersectsNode(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        }
    })

    while (walker.nextNode()) {
        nodes.push(walker.currentNode as Text)
    }

    return nodes
}

function getSelectedTextNodeRange(range: Range, node: Text): Range | null {
    const text = node.nodeValue ?? ''
    let start = 0
    let end = text.length

    if (range.startContainer === node) start = Math.min(Math.max(range.startOffset, 0), text.length)
    if (range.endContainer === node) end = Math.min(Math.max(range.endOffset, 0), text.length)
    if (start >= end) return null

    const selectedRange = document.createRange()
    selectedRange.setStart(node, start)
    selectedRange.setEnd(node, end)
    return selectedRange
}

function getElementForNode(node: Node): Element | null {
    return node instanceof Element ? node : node.parentElement
}

function walkTextNodesDeep(root: Node, visitText: (node: Text) => boolean | void): boolean {
    const visitRoot = (currentRoot: Node): boolean => {
        if (currentRoot.nodeType === Node.TEXT_NODE) {
            return visitText(currentRoot as Text) !== false
        }

        if (currentRoot instanceof Element && shouldSkipPageTranslationElement(currentRoot)) {
            return true
        }

        if (
            !(currentRoot instanceof Element) &&
            !(currentRoot instanceof DocumentFragment) &&
            !(currentRoot instanceof Document)
        ) {
            return true
        }

        const rootShadow = getOpenShadowRoot(currentRoot)
        if (rootShadow && !visitRoot(rootShadow)) return false

        const walker = document.createTreeWalker(currentRoot, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
                if (node instanceof Element && shouldSkipPageTranslationElement(node)) return NodeFilter.FILTER_REJECT
                return NodeFilter.FILTER_ACCEPT
            }
        })

        while (walker.nextNode()) {
            const node = walker.currentNode
            if (node.nodeType === Node.TEXT_NODE) {
                if (visitText(node as Text) === false) return false
                continue
            }

            const shadow = getOpenShadowRoot(node)
            if (shadow && !visitRoot(shadow)) return false
        }

        return true
    }

    return visitRoot(root)
}

function walkOpenShadowRootsDeep(root: Node, visitShadowRoot: (root: ShadowRoot) => void) {
    const visitRoot = (currentRoot: Node) => {
        if (currentRoot instanceof Element && shouldSkipPageTranslationElement(currentRoot)) return
        if (
            !(currentRoot instanceof Element) &&
            !(currentRoot instanceof DocumentFragment) &&
            !(currentRoot instanceof Document)
        ) {
            return
        }

        const rootShadow = getOpenShadowRoot(currentRoot)
        if (rootShadow) {
            visitShadowRoot(rootShadow)
            visitRoot(rootShadow)
        }

        const walker = document.createTreeWalker(currentRoot, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                return node instanceof Element && shouldSkipPageTranslationElement(node)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT
            }
        })

        while (walker.nextNode()) {
            const shadow = getOpenShadowRoot(walker.currentNode)
            if (!shadow) continue

            visitShadowRoot(shadow)
            visitRoot(shadow)
        }
    }

    visitRoot(root)
}

function hasTranslatableTextDeep(root: Node): boolean {
    let found = false
    walkTextNodesDeep(root, node => {
        if (hasTranslatableText(node.textContent ?? '')) {
            found = true
            return false
        }
    })
    return found
}

function isDocumentScopeElement(element: Element): boolean {
    return element === document.documentElement || element === document.body
}

function isBlockLikeDisplay(display: string): boolean {
    return [
        'block',
        'flow-root',
        'flex',
        'grid',
        'list-item',
        'table',
        'table-caption',
        'table-cell',
        'table-row',
        'table-row-group',
        'table-header-group',
        'table-footer-group',
    ].includes(display)
}

function getSelectionBlockForNode(node: Node): Element | null {
    let element = getElementForNode(node)
    const fallback = element

    while (element && !isDocumentScopeElement(element)) {
        if (isBlockLikeDisplay(window.getComputedStyle(element).display)) return element
        element = element.parentElement
    }

    return fallback
}

function getSelectionTextContainerForNode(node: Node): Element | null {
    let element = getElementForNode(node)
    const fallback = element

    while (element && !isDocumentScopeElement(element)) {
        const parent = element.parentElement
        if (!parent || isDocumentScopeElement(parent)) return element

        const display = window.getComputedStyle(element).display
        const parentDisplay = window.getComputedStyle(parent).display
        if (isBlockLikeDisplay(display) || isBlockLikeDisplay(parentDisplay)) return element

        element = parent
    }

    return fallback
}

function getCaretNodeFromPoint(point: SelectionPoint): Node | null {
    const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node | null } | null
    }

    const range = doc.caretRangeFromPoint?.(point.x, point.y)
    if (range?.startContainer) return range.startContainer

    return doc.caretPositionFromPoint?.(point.x, point.y)?.offsetNode ?? null
}

function areElementsRelated(a: Element, b: Element): boolean {
    return a === b || a.contains(b) || b.contains(a)
}

function getRectArea(rect: DOMRect): number {
    return rect.width * rect.height
}

function getCandidateArea(candidate: VisibleSelectionCandidate): number {
    return candidate.rects.reduce((area, rect) => area + getRectArea(rect), 0)
}

function getPointDistanceToRect(point: SelectionPoint, rect: DOMRect): number {
    const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0
    const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0
    return Math.hypot(dx, dy)
}

function getCandidateDistanceToPoint(candidate: VisibleSelectionCandidate, point: SelectionPoint): number {
    return Math.min(...candidate.rects.map(rect => getPointDistanceToRect(point, rect)))
}

function getPrimarySelectionContainer(candidates: VisibleSelectionCandidate[], point: SelectionPoint | null): Element | null {
    const candidatesWithContainer = candidates.filter(candidate => candidate.container)
    if (candidatesWithContainer.length === 0) return null

    if (point) {
        const caretNode = getCaretNodeFromPoint(point)
        const caretElement = caretNode ? getElementForNode(caretNode) : null
        const caretCandidate = candidatesWithContainer.find(candidate => {
            if (caretNode && candidate.node === caretNode) return true
            return !!caretElement && !!candidate.container && areElementsRelated(candidate.container, caretElement)
        })

        if (caretCandidate?.container) return caretCandidate.container

        return candidatesWithContainer
            .map(candidate => ({candidate, distance: getCandidateDistanceToPoint(candidate, point)}))
            .sort((a, b) => a.distance - b.distance || getCandidateArea(b.candidate) - getCandidateArea(a.candidate))[0]
            .candidate.container
    }

    const areaByContainer = new Map<Element, number>()
    for (const candidate of candidatesWithContainer) {
        const container = candidate.container
        if (!container) continue
        areaByContainer.set(container, (areaByContainer.get(container) ?? 0) + getCandidateArea(candidate))
    }

    return Array.from(areaByContainer.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function filterSelectionCandidates(candidates: VisibleSelectionCandidate[], primaryContainer: Element | null): VisibleSelectionCandidate[] {
    if (!primaryContainer) return candidates

    const relatedCandidates = candidates.filter(candidate => candidate.container && areElementsRelated(candidate.container, primaryContainer))
    return relatedCandidates.length > 0 ? relatedCandidates : candidates
}

function getSelectionTextBlock(node: Text): Element | null {
    return getSelectionBlockForNode(node)
}

function normalizeVisibleSelectionText(text: string): string {
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\f\v]+\n/g, '\n')
        .replace(/\n[ \t\f\v]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function getVisibleSelectionExtract(selection: Selection, point: SelectionPoint | null = null): VisibleSelectionExtract {
    const candidates: VisibleSelectionCandidate[] = []

    for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i)
        const selectionRects = getVisibleSelectionRangeRects(range)
        if (selectionRects.length === 0) continue

        for (const node of getTextNodesInSelectionRange(range)) {
            const parent = node.parentElement
            if (!parent || !isElementVisibleForSelection(parent)) continue

            const selectedRange = getSelectedTextNodeRange(range, node)
            if (!selectedRange) continue

            const selectedRects = getVisibleSelectionRangeRects(selectedRange)
                .filter(rect => rectIntersectsAny(rect, selectionRects))
            if (selectedRects.length > 0) {
                candidates.push({
                    text: selectedRange.toString(),
                    node,
                    container: getSelectionTextContainerForNode(node),
                    block: getSelectionTextBlock(node),
                    rects: selectedRects,
                })
            }

            selectedRange.detach()
        }
    }

    const primaryContainer = getPrimarySelectionContainer(candidates, point)
    const selectedCandidates = filterSelectionCandidates(candidates, primaryContainer)
    const parts: string[] = []
    const rects: DOMRect[] = []
    let lastBlock: Element | null = null

    const appendText = (text: string, block: Element | null) => {
        if (!text) return

        const previous = parts.at(-1)
        if (
            previous !== undefined &&
            lastBlock &&
            block &&
            lastBlock !== block &&
            !previous.endsWith('\n')
        ) {
            parts.push('\n')
        }

        parts.push(text)
        lastBlock = block
    }

    for (const candidate of selectedCandidates) {
        appendText(candidate.text, candidate.block)
        rects.push(...candidate.rects)
    }

    return {text: normalizeVisibleSelectionText(parts.join('')), rects}
}

function getTextNodeVisibleRect(node: Text): DOMRect | null {
    const parent = getTextNodeElement(node)
    if (!parent || shouldSkipPageTranslationElement(parent) || !isElementStyleVisible(parent)) return null

    const range = document.createRange()
    try {
        range.selectNodeContents(node)
        return Array.from(range.getClientRects()).find(rectIntersectsViewport) ?? null
    } catch {
        const rect = parent.getBoundingClientRect()
        return rectIntersectsViewport(rect) ? rect : null
    } finally {
        range.detach()
    }
}

function isTextNodeVisible(node: Text): boolean {
    return getTextNodeVisibleRect(node) !== null
}

function getTextNodeAnchorRect(node: Text): DOMRect {
    const visibleRect = getTextNodeVisibleRect(node)
    if (visibleRect) return visibleRect

    const parent = getTextNodeElement(node)
    return parent?.getBoundingClientRect() ?? new DOMRect()
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

function getSharedTooltip(): TooltipController {
    sharedTooltip ??= createTooltip()
    return sharedTooltip
}

function hidePageOriginalTooltip() {
    clearPageOriginalTooltipTimer()
    clearPageOriginalTooltipHideTimer()
    pageOriginalTooltipPendingNode = null
    pageOriginalTooltipVisibleNode = null
    pageOriginalTooltipPendingText = ''
    getSharedTooltip().hide('page-original')
}

function schedulePageOriginalTooltipHide() {
    clearPageOriginalTooltipTimer()
    if (!getSharedTooltip().isOwnedBy('page-original')) {
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
    getSharedTooltip().show(text, rect, 'page-original')
}

function schedulePageOriginalTooltip(node: Text, text: string) {
    clearPageOriginalTooltipHideTimer()
    if (pageOriginalTooltipVisibleNode === node && getSharedTooltip().isOwnedBy('page-original')) {
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
    getSharedTooltip().hide('page-original')

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
        getSharedTooltip().isOwnedBy('page-original') &&
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

    const {response, contextInvalidated} = await sendRuntimeMessage<PageTranslationAnalyzeSamplesResponse>(request)
    if (contextInvalidated || !extensionContextValid) return null
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

    if (!hasExtensionContext()) return

    try {
        chrome.storage.local.get(['popup_theme'], (data) => {
            try {
                if (chrome.runtime.lastError) {
                    handleExtensionContextError(chrome.runtime.lastError.message)
                    return
                }
            } catch (error) {
                handleExtensionContextError(error)
                return
            }

            applyPageTranslationPromptTheme(data['popup_theme'])
        })
    } catch (error) {
        handleExtensionContextError(error)
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
        handleExtensionContextError(error)
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
    pageTranslationSourceOverride = sourceLanguage
    void sendRuntimeMessage<PageTranslationStateResponse>({type: 'PAGE_TRANSLATION_SET_ACTIVE', enabled: true})
        .then(({response, contextInvalidated}) => {
            if (contextInvalidated) return
            if (!response?.ok) {
                pageTranslationSourceOverride = null
            }
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
        void sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
            type: 'PAGE_TRANSLATION_SET_SITE_PREFERENCE',
            hostname,
            action: 'never',
        })
    })

    alwaysButton.addEventListener('click', () => {
        pageTranslationSuggestionDismissed = true
        hidePageTranslationPrompt()
        void sendRuntimeMessage<PageTranslationSetSitePreferenceResponse>({
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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !extensionContextValid) return
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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !extensionContextValid) return

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
    if (pageTranslationSuggestionObserver || pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !extensionContextValid) return

    const root = document.body ?? document.documentElement
    if (!root) {
        schedulePageTranslationSuggestion(800, true)
        return
    }

    pageTranslationSuggestionObserver = new MutationObserver((mutations) => {
        if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !extensionContextValid) {
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
    if (pageTranslationEnabled || pageTranslationSuggestionDismissed || pageTranslationPromptEl || !extensionContextValid) return
    if (!document.body) {
        schedulePageTranslationSuggestion(800)
        startPageTranslationSuggestionObserver()
        return
    }
    if (document.visibilityState === 'hidden') return

    const hostname = normalizeSiteHostname(location.hostname)
    if (!hostname) return

    const {response, contextInvalidated} = await sendRuntimeMessage<PageTranslationSuggestSettingsResponse>({
        type: 'PAGE_TRANSLATION_SUGGEST_SETTINGS',
        hostname,
    })
    if (contextInvalidated || !extensionContextValid) return
    if (!response?.ok || !response.supported || response.never) {
        hidePageTranslationPrompt()
        return
    }

    const targetLanguage = normalizePromptLanguage(response.target)
    const analysis = await analyzeVisiblePageLanguage(targetLanguage)
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

function translatePageValue(value: string): Promise<string | null> {
    const cached = pageTranslationCache.get(value)
    if (cached) return Promise.resolve(cached)

    const inflight = pageTranslationInflight.get(value)
    if (inflight) return inflight

    const request = translate(value, 'page')
        .then(translated => {
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

function forgetObservedPageTextNodes(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
        unobservePageTextNode(root as Text)
        return
    }

    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

    walkTextNodesDeep(root, node => unobservePageTextNode(node))
}

function clearPageTranslationVisibilityObserver() {
    pageTranslationVisibilityObserver?.disconnect()
    pageTranslationVisibilityObserver = null
    pageTranslationObserved.clear()

    if (pageTranslationVisibilityFrame !== null) {
        cancelAnimationFrame(pageTranslationVisibilityFrame)
        pageTranslationVisibilityFrame = null
    }
}

function handlePageTranslationViewportChange() {
    scheduleObservedPageTextNodeCheck()
}

function enqueuePageTextNode(node: Text, requireVisible = true) {
    if (!pageTranslationEnabled || pageTranslationQueued.has(node) || !isPageTranslationCandidate(node)) return
    if (requireVisible && !isTextNodeVisible(node)) {
        observePageTextNode(node)
        return
    }
    if (reusePageTranslationIfUnchanged(node)) return
    if (applyCachedPageTranslationIfAvailable(node)) return

    unobservePageTextNode(node)
    pageTranslationQueued.add(node)
    pageTranslationQueue.push(node)
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
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        })
    })
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

function updatePageTranslationStatus() {
    const pendingCount = pageTranslationQueue.length + pageTranslationActiveCount
    hideTranslationStatus('page')
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
}

function startPageTranslation() {
    if (pageTranslationEnabled && pageTranslationObserver) return

    pageTranslationEnabled = true
    pageTranslationSuggestionDismissed = true
    clearPageTranslationSuggestionTimer()
    stopPageTranslationSuggestionObserver()
    hidePageTranslationPrompt()
    pageTranslationRunId++
    pageTranslationCache.clear()
    pageTranslationInflight.clear()

    pageTranslationObserver?.disconnect()
    pageTranslationShadowRoots.clear()
    pageTranslationObserver = new MutationObserver((mutations) => {
        if (!pageTranslationEnabled) return

        for (const mutation of mutations) {
            if (mutation.type === 'characterData' && mutation.target instanceof Text) {
                enqueuePageTextNode(mutation.target)
                continue
            }

            if (mutation.type === 'attributes' && mutation.target instanceof Element) {
                if (mutation.attributeName === 'hidden' || mutation.attributeName === 'aria-hidden') {
                    collectPageTextNodes(mutation.target)
                }
                scheduleObservedPageTextNodeCheck()
                continue
            }

            mutation.addedNodes.forEach(node => {
                observePageTranslationShadowRoots(node)
                collectPageTextNodes(node)
            })
            mutation.removedNodes.forEach(node => forgetObservedPageTextNodes(node))
        }
    })
    pageTranslationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    })
    if (document.body) {
        observePageTranslationShadowRoots(document.body)
        collectPageTextNodes(document.body)
    }
    updatePageTranslationStatus()
    document.addEventListener('scroll', handlePageTranslationViewportChange, true)
    window.addEventListener('resize', handlePageTranslationViewportChange)
    startPageOriginalTooltipListeners()
}

function stopPageTranslation() {
    if (!pageTranslationEnabled && !pageTranslationObserver) return

    pageTranslationEnabled = false
    pageTranslationRunId++
    pageTranslationObserver?.disconnect()
    pageTranslationObserver = null
    pageTranslationShadowRoots.clear()
    pageTranslationSourceOverride = null
    pageTranslationQueue.length = 0
    pageTranslationInflight.clear()
    document.removeEventListener('scroll', handlePageTranslationViewportChange, true)
    window.removeEventListener('resize', handlePageTranslationViewportChange)
    stopPageOriginalTooltipListeners()
    clearPageTranslationVisibilityObserver()
    hideTranslationStatus('page')
    hidePageTextTranslationStatus()
    restorePageTranslation()
}

const fireInput = (el: HTMLElement) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value)
    }
    el.dispatchEvent(new InputEvent('input', {bubbles: true, cancelable: true, inputType: 'insertText'}))
    el.dispatchEvent(new Event('change', {bubbles: true}))
}

function getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
    const active = root.activeElement
    if (!active) return null
    return active.shadowRoot ? getDeepActiveElement(active.shadowRoot) : active
}

const getEditable = (): HTMLElement | null => {
    const el = getDeepActiveElement()
    if (!(el instanceof HTMLElement)) return null
    if (el instanceof HTMLTextAreaElement) return el
    if (el instanceof HTMLInputElement && !el.disabled && !el.readOnly && INPUT_TYPES.has(el.type)) return el
    if (el.isContentEditable) return el
    if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return el
    return null
}

async function transformInput(el: HTMLInputElement | HTMLTextAreaElement) {
    const {value} = el, s = el.selectionStart ?? 0, e = el.selectionEnd ?? s, hasSel = e > s
    const text = (hasSel ? value.slice(s, e) : value).trim()
    if (!text) return
    const out = await translate(text, 'input')
    if (out === null) return
    el.value = hasSel ? value.slice(0, s) + out + value.slice(e) : out
    el.setSelectionRange(s + out.length, s + out.length)
    fireInput(el)
}

async function transformContentEditable(el: HTMLElement) {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const hasSel = !sel.isCollapsed && el.contains(sel.anchorNode)
    const text = (hasSel ? sel.toString() : el.textContent ?? '').trim()
    if (!text) return

    const savedRange = sel.getRangeAt(0).cloneRange()

    const out = await translate(text, 'input')
    if (out === null) return

    el.focus()
    sel.removeAllRanges()

    if (hasSel) {
        sel.addRange(savedRange)
    } else {
        const fullRange = document.createRange()
        fullRange.selectNodeContents(el)
        sel.addRange(fullRange)
    }

    const beforeInputFired = el.dispatchEvent(
        new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: out,
        })
    )

    if (beforeInputFired) {
        const inserted = document.execCommand('insertText', false, out)
        if (!inserted) {
            const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : savedRange
            range.deleteContents()
            const node = document.createTextNode(out)
            range.insertNode(node)
            range.selectNodeContents(node)
            range.collapse(false)
            sel.removeAllRanges()
            sel.addRange(range)
            fireInput(el)
        }
    }
}

async function transformFocused() {
    const el = getEditable()
    if (!el) return
    showTranslationStatus('input', 'Please wait, translating input...')
    try {
        await (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? transformInput(el) : transformContentEditable(el))
    } finally {
        hideTranslationStatus('input')
    }
}

function registerBackgroundMessageHandler() {
    try {
        chrome.runtime.onMessage.addListener((msg: unknown) => {
            const typed = msg as { type?: string; enabled?: boolean }
            if (typed.type === 'APPLY_TRANSFORM_TO_FOCUS') void transformFocused()
            if (typed.type === 'SET_PAGE_TRANSLATION' && typeof typed.enabled === 'boolean') {
                typed.enabled ? startPageTranslation() : stopPageTranslation()
            }
        })
    } catch (error) {
        handleExtensionContextError(error)
    }
}

function syncPageTranslationState() {
    void sendRuntimeMessage<PageTranslationStateResponse>({type: 'PAGE_TRANSLATION_GET_STATE'})
        .then(({response, contextInvalidated}) => {
            if (contextInvalidated || !extensionContextValid || !response?.ok) return
            if (response.enabled) {
                startPageTranslation()
            } else if (pageTranslationEnabled) {
                stopPageTranslation()
            }
        })
}

function registerPageTranslationStateSync() {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[PAGE_TRANSLATION_TABS_KEY]) {
                syncPageTranslationState()
            }
        })
    } catch (error) {
        handleExtensionContextError(error)
    }
}

const TOOLTIP_THEMES = {
    dark: {
        background: 'rgba(10, 12, 28, 0.72)',
        color: '#f1f5f9',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
        backdropFilter: 'blur(24px) saturate(180%)',
        scrollbarColor: 'rgba(255,255,255,0.18) transparent',
    },
    light: {
        background: 'rgba(255,255,255,0.58)',
        color: '#1e293b',
        border: '1px solid rgba(255,255,255,0.72)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.8)',
        backdropFilter: 'blur(24px) saturate(180%)',
        scrollbarColor: 'rgba(100,116,139,0.32) transparent',
    },
}

function applyTooltipTheme(el: HTMLElement, theme: 'dark' | 'light') {
    const t = TOOLTIP_THEMES[theme]
    el.style.background = t.background
    el.style.color = t.color
    el.style.border = t.border
    el.style.boxShadow = t.boxShadow
    el.style.backdropFilter = t.backdropFilter
    ;(el.style as any).webkitBackdropFilter = t.backdropFilter
    el.style.scrollbarColor = t.scrollbarColor
}

function applyTooltipErrorTheme(el: HTMLElement) {
    el.style.background = 'rgba(127, 29, 29, 0.9)'
    el.style.color = '#fee2e2'
    el.style.border = '1px solid rgba(248,113,113,0.72)'
    el.style.boxShadow = '0 12px 34px rgba(127,29,29,0.38), inset 0 1px 0 rgba(255,255,255,0.12)'
    el.style.backdropFilter = 'blur(22px) saturate(170%)'
    ;(el.style as any).webkitBackdropFilter = 'blur(22px) saturate(170%)'
    el.style.scrollbarColor = 'rgba(254,202,202,0.45) transparent'
}

function createTooltip(): TooltipController {
    if (!document.getElementById(`${TOOLTIP_ID}-style`)) {
        const s = document.createElement('style')
        s.id = `${TOOLTIP_ID}-style`
        s.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}#${TOOLTIP_ID}::-webkit-scrollbar{width:4px}#${TOOLTIP_ID}::-webkit-scrollbar-track{background:transparent}#${TOOLTIP_ID}::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35);border-radius:4px}#${TOOLTIP_ID}::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,.6)}#${TOOLTIP_ID} .itranslate-tooltip-loading{display:flex;align-items:center;justify-content:center}#${TOOLTIP_ID} .itranslate-tooltip-spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}#${TOOLTIP_ID} .itranslate-tooltip-error{display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;border:1.5px solid currentColor;font:700 10px/1 -apple-system,"Segoe UI",sans-serif;cursor:help}`
        document.documentElement.appendChild(s)
    }

    const el = document.createElement('div')
    el.id = TOOLTIP_ID
    Object.assign(el.style, {
        position: 'fixed', zIndex: '2147483647', maxWidth: '340px',
        padding: '10px 14px', borderRadius: '16px',
        font: '13px/1.5 -apple-system,"Segoe UI",sans-serif',
        display: 'none', whiteSpace: 'pre-wrap', pointerEvents: 'auto',
        userSelect: 'text', wordBreak: 'break-word', maxHeight: '50vh',
        overflowY: 'auto', scrollbarWidth: 'thin',
        transition: 'opacity 0.15s ease',
    })
    let currentTheme: 'dark' | 'light' = 'dark'
    let activeErrorMessage = ''
    applyTooltipTheme(el, currentTheme)
    document.documentElement.appendChild(el)

    const applyCurrentTheme = () => {
        if (activeErrorMessage) {
            applyTooltipErrorTheme(el)
            return
        }

        applyTooltipTheme(el, currentTheme)
    }

    const setTextShape = () => {
        el.style.maxWidth = '340px'
        el.style.padding = '10px 14px'
        el.style.borderRadius = '16px'
        el.style.whiteSpace = 'pre-wrap'
        el.style.overflowY = 'auto'
        el.style.userSelect = 'text'
    }

    const setIndicatorShape = () => {
        el.style.maxWidth = 'none'
        el.style.padding = '7px'
        el.style.borderRadius = '999px'
        el.style.whiteSpace = 'normal'
        el.style.overflowY = 'visible'
        el.style.userSelect = 'none'
    }

    const showErrorDetails = () => {
        if (!activeErrorMessage) return

        setTextShape()
        applyTooltipErrorTheme(el)
        el.textContent = activeErrorMessage
    }

    el.addEventListener('mouseenter', showErrorDetails)
    el.addEventListener('focusin', showErrorDetails)

    // Read stored theme and update tooltip; listen for future changes.
    try {
        chrome.storage.local.get(['popup_theme'], (data) => {
            try {
                if (chrome.runtime.lastError) {
                    handleExtensionContextError(chrome.runtime.lastError.message)
                    return
                }
            } catch (error) {
                handleExtensionContextError(error)
                return
            }

            currentTheme = (data['popup_theme'] as string) === 'light' ? 'light' : 'dark'
            applyCurrentTheme()
        })
    } catch (error) {
        handleExtensionContextError(error)
    }

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes['popup_theme']) {
                currentTheme = changes['popup_theme'].newValue === 'light' ? 'light' : 'dark'
                applyCurrentTheme()
            }
        })
    } catch (error) {
        handleExtensionContextError(error)
    }

    let cleanup: (() => void) | null = null
    let currentOwner: TooltipOwner | null = null
    const stop = () => {
        cleanup?.();
        cleanup = null
    }
    const startPositioning = (getRect: () => DOMRect) => {
        el.style.display = 'block'
        stop()
        const ref: VirtualElement = {getBoundingClientRect: getRect, contextElement: document.documentElement}
        cleanup = autoUpdate(ref, el, async () => {
            const {x, y} = await computePosition(ref, el, {
                strategy: 'fixed',
                placement: 'top',
                middleware: MIDDLEWARE
            })
            el.style.left = `${x}px`
            el.style.top = `${y}px`
        })
    }

    return {
        show(text, getRect, owner = 'selection') {
            currentOwner = owner
            activeErrorMessage = ''
            setTextShape()
            applyCurrentTheme()
            el.removeAttribute('title')
            el.removeAttribute('aria-label')
            el.textContent = text
            startPositioning(getRect)
        },
        showLoading(getRect, owner = 'selection') {
            currentOwner = owner
            activeErrorMessage = ''
            setIndicatorShape()
            applyCurrentTheme()
            el.setAttribute('aria-label', 'Translating')
            el.removeAttribute('title')
            const wrapper = document.createElement('span')
            wrapper.className = 'itranslate-tooltip-loading'

            const spinner = document.createElement('span')
            spinner.className = 'itranslate-tooltip-spinner'

            wrapper.append(spinner)
            el.replaceChildren(wrapper)
            startPositioning(getRect)
        },
        showError(message, getRect, owner = 'selection') {
            currentOwner = owner
            activeErrorMessage = message
            setIndicatorShape()
            applyTooltipErrorTheme(el)
            el.removeAttribute('title')
            el.setAttribute('aria-label', message)
            const indicator = document.createElement('span')
            indicator.className = 'itranslate-tooltip-error'
            indicator.textContent = '!'

            el.replaceChildren(indicator)
            startPositioning(getRect)
        },
        hide(owner) {
            if (owner && currentOwner !== owner) return

            currentOwner = null
            activeErrorMessage = ''
            stop();
            el.style.display = 'none'
        },
        isVisible() {
            return el.style.display !== 'none'
        },
        isOwnedBy(owner) {
            return currentOwner === owner && el.style.display !== 'none'
        },
    }
}

function registerSelectionTranslation(tooltip: TooltipController) {
    let timer: number | null = null, reqId = 0
    let pointerDownCount = 0
    let lastSelectionPoint: SelectionPoint | null = null

    const tooltipNode = () => document.getElementById(TOOLTIP_ID)
    const inTooltip = (t: EventTarget | null) => {
        const n = tooltipNode();
        return !!n && t instanceof Node && n.contains(t)
    }
    const isTooltipSel = (s: Selection) => {
        const n = tooltipNode();
        return !!n && (n.contains(s.anchorNode) || n.contains(s.focusNode))
    }
    const isEditable = (node: Node | null) => {
        const el = node instanceof Element ? node : node?.parentElement
        return !!el && (!!el.closest('input,textarea') || !!(el.closest('[contenteditable]') as HTMLElement)?.isContentEditable)
    }

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null
        }
    }
    const hide = () => {
        clearTimer();
        tooltip.hide()
    }
    const getRecentSelectionPoint = () => {
        if (!lastSelectionPoint || Date.now() - lastSelectionPoint.timestamp > 2000) return null
        return lastSelectionPoint
    }

    const run = async () => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            tooltip.hide();
            return
        }
        if (isTooltipSel(sel)) return
        if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) {
            tooltip.hide();
            return
        }

        const selectionExtract = getVisibleSelectionExtract(sel, getRecentSelectionPoint())
        const text = selectionExtract.text
        if (!text) {
            tooltip.hide();
            return
        }

        const range = sel.getRangeAt(0).cloneRange()
        const rects = selectionExtract.rects

        if (rects.length > 1) {
            const sorted = [...rects].sort((a, b) => a.top === b.top ? a.left - b.left : a.top - b.top)
            for (let i = 1; i < sorted.length; i++)
                if (sorted[i].top - sorted[i - 1].bottom > MAX_GAP_PX) {
                    tooltip.hide();
                    return
                }
        }

        const getRect = (): DOMRect => rects.at(-1) ?? range.getBoundingClientRect()
        const rect = getRect()
        if (!rect.width && !rect.height) {
            tooltip.hide();
            return
        }

        const id = ++reqId
        tooltip.hide()
        const precheckResponse = await precheckTranslateWithResponse(text, 'selection')
        if (!extensionContextValid) {
            tooltip.hide()
            return
        }
        if (id !== reqId) return
        if (precheckResponse.ok && precheckResponse.skipped) {
            tooltip.hide()
            return
        }
        if (!precheckResponse.ok) {
            tooltip.showError(precheckResponse.error ?? 'Failed to check translation', getRect)
            return
        }

        tooltip.showLoading(getRect)
        const response = await translateWithResponse(text, 'selection')
        if (!extensionContextValid) {
            tooltip.hide()
            return
        }
        if (id === reqId) {
            if (response.ok && response.skipped) {
                tooltip.hide()
                return
            }
            if (response.ok) {
                tooltip.show(response.translatedText, getRect)
                return
            }

            tooltip.showError(response.error ?? 'Failed to translate', getRect)
        }
    }

    const schedule = () => {
        if (pointerDownCount > 0) return
        clearTimer()
        timer = window.setTimeout(run, DELAY_MS)
    }

    document.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') {
            pointerDownCount++
            clearTimer() // прерываем предыдущий запуск пока мышь зажата
        }
    })
    document.addEventListener('pointerup', e => {
        if (e.pointerType === 'mouse') {
            lastSelectionPoint = {x: e.clientX, y: e.clientY, timestamp: Date.now()}
            pointerDownCount = Math.max(0, pointerDownCount - 1)
            setTimeout(schedule, 0)
        }
    })
    document.addEventListener('pointercancel', e => {
        if (e.pointerType === 'mouse') pointerDownCount = Math.max(0, pointerDownCount - 1)
    })
    document.addEventListener('keyup', e => e.key === 'Escape' ? hide() : schedule())
    document.addEventListener('scroll', e => {
        if (tooltip.isVisible() && !inTooltip(e.target)) hide()
    }, true)
    document.addEventListener('click', e => {
        if (tooltip.isVisible() && !inTooltip(e.target)) hide()
    }, true)
}

registerSelectionTranslation(getSharedTooltip())
registerBackgroundMessageHandler()
registerPageTranslationStateSync()
syncPageTranslationState()
startPageTranslationSuggestionObserver()
schedulePageTranslationSuggestion(1200, true)
window.addEventListener('load', () => {
    startPageTranslationSuggestionObserver()
    schedulePageTranslationSuggestion(800, true)
}, {once: true})
window.addEventListener('pageshow', () => {
    startPageTranslationSuggestionObserver()
    schedulePageTranslationSuggestion(700, true)
})
window.addEventListener('focus', () => {
    startPageTranslationSuggestionObserver()
    schedulePageTranslationSuggestion(900, true)
})
window.setTimeout(() => schedulePageTranslationSuggestion(0, true), 3500)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        startPageTranslationSuggestionObserver()
        schedulePageTranslationSuggestion(700, true)
    }
})
