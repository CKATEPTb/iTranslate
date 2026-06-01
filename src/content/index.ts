import {autoUpdate, computePosition, flip, offset, shift, type VirtualElement} from '@floating-ui/dom'

type TranslateMode = 'selection' | 'input'
type TranslateResponse = { ok: true; translatedText: string } | { ok: false; error?: string }
type PageTranslationStateResponse = { ok: boolean; enabled?: boolean; error?: string }
type TooltipController = { show(text: string, getRect: () => DOMRect): void; hide(): void; isVisible(): boolean }

const TOOLTIP_ID = 'itranslate-tooltip'
const STATUS_ID = 'itranslate-status'
const STATUS_STYLE_ID = 'itranslate-status-style'
const DELAY_MS = 400
const MAX_GAP_PX = 96
const PAGE_TRANSLATION_CONCURRENCY = 2
const INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password'])
const MIDDLEWARE = [offset(10), flip({padding: 8}), shift({padding: 8})]
const PAGE_TRANSLATION_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
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

const translate = (text: string, mode: TranslateMode): Promise<string | null> =>
    new Promise(resolve =>
        chrome.runtime.sendMessage({type: 'TRANSLATE_TEXT', text, mode}, (r: TranslateResponse | undefined) =>
            resolve(!chrome.runtime.lastError && r?.ok && typeof r.translatedText === 'string' ? r.translatedText : null)
        )
    )

type TranslationStatusKey = 'input' | 'page'

type PageTextMeta = {
    sourceText: string
    translatedText: string
}

let pageTranslationEnabled = false
let pageTranslationObserver: MutationObserver | null = null
let pageTranslationRunId = 0
let pageTranslationActiveCount = 0

const pageTranslationQueue: Text[] = []
const pageTranslationQueued = new WeakSet<Text>()
const pageTranslationMeta = new WeakMap<Text, PageTextMeta>()
const pageTranslationNodes = new Set<Text>()
const pageTranslationCache = new Map<string, string>()
const translationStatuses = new Map<TranslationStatusKey, string>()

let translationStatusEl: HTMLElement | null = null
let translationStatusTextEl: HTMLElement | null = null
let translationStatusHideTimer: number | null = null

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

function shouldSkipPageTranslationElement(element: Element): boolean {
    return element.isContentEditable || !!element.closest(PAGE_TRANSLATION_SKIP_SELECTOR)
}

function isPageTranslationCandidate(node: Text): boolean {
    const text = node.nodeValue ?? ''
    const {value} = splitPreservingWhitespace(text)
    if (!value || !hasTranslatableText(value)) return false

    const meta = pageTranslationMeta.get(node)
    if (meta && text === meta.translatedText) return false

    const parent = node.parentElement
    if (!parent || shouldSkipPageTranslationElement(parent)) return false

    return true
}

function enqueuePageTextNode(node: Text) {
    if (!pageTranslationEnabled || pageTranslationQueued.has(node) || !isPageTranslationCandidate(node)) return

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

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return isPageTranslationCandidate(node as Text)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT
        }
    })

    while (walker.nextNode()) {
        enqueuePageTextNode(walker.currentNode as Text)
    }
}

async function translatePageTextNode(node: Text, runId: number) {
    if (!pageTranslationEnabled || runId !== pageTranslationRunId || !node.isConnected || !isPageTranslationCandidate(node)) return

    const sourceText = node.nodeValue ?? ''
    const {leading, value, trailing} = splitPreservingWhitespace(sourceText)
    let translated = pageTranslationCache.get(value)

    if (!translated) {
        translated = await translate(value, 'selection') ?? undefined
        if (!translated) return
        pageTranslationCache.set(value, translated)
    }

    if (!pageTranslationEnabled || runId !== pageTranslationRunId || !node.isConnected) return
    if ((node.nodeValue ?? '') !== sourceText) return

    const translatedText = `${leading}${translated}${trailing}`
    pageTranslationMeta.set(node, {sourceText, translatedText})
    pageTranslationNodes.add(node)
    node.nodeValue = translatedText
}

function updatePageTranslationStatus() {
    const pendingCount = pageTranslationQueue.length + pageTranslationActiveCount
    if (!pageTranslationEnabled || pendingCount === 0) {
        hideTranslationStatus('page')
        return
    }

    showTranslationStatus('page', `Please wait, translating page (${pendingCount} left)...`)
}

async function drainPageTranslationQueue() {
    while (pageTranslationEnabled && pageTranslationActiveCount < PAGE_TRANSLATION_CONCURRENCY && pageTranslationQueue.length > 0) {
        const node = pageTranslationQueue.shift()
        if (!node) continue

        pageTranslationQueued.delete(node)
        pageTranslationActiveCount++
        updatePageTranslationStatus()
        void translatePageTextNode(node, pageTranslationRunId).finally(() => {
            pageTranslationActiveCount--
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
    pageTranslationRunId++
    pageTranslationCache.clear()

    if (document.body) {
        collectPageTextNodes(document.body)
    }
    updatePageTranslationStatus()

    pageTranslationObserver?.disconnect()
    pageTranslationObserver = new MutationObserver((mutations) => {
        if (!pageTranslationEnabled) return

        for (const mutation of mutations) {
            if (mutation.type === 'characterData' && mutation.target instanceof Text) {
                enqueuePageTextNode(mutation.target)
                continue
            }

            mutation.addedNodes.forEach(node => collectPageTextNodes(node))
        }
    })
    pageTranslationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
    })
}

function stopPageTranslation() {
    if (!pageTranslationEnabled && !pageTranslationObserver) return

    pageTranslationEnabled = false
    pageTranslationRunId++
    pageTranslationObserver?.disconnect()
    pageTranslationObserver = null
    pageTranslationQueue.length = 0
    hideTranslationStatus('page')
    restorePageTranslation()
}

function syncInitialPageTranslationState() {
    chrome.runtime.sendMessage({type: 'PAGE_TRANSLATION_GET_STATE'}, (response: PageTranslationStateResponse | undefined) => {
        if (!chrome.runtime.lastError && response?.ok && response.enabled) {
            startPageTranslation()
        }
    })
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
    chrome.runtime.onMessage.addListener((msg: unknown) => {
        const typed = msg as { type?: string; enabled?: boolean }
        if (typed.type === 'APPLY_TRANSFORM_TO_FOCUS') void transformFocused()
        if (typed.type === 'SET_PAGE_TRANSLATION' && typeof typed.enabled === 'boolean') {
            typed.enabled ? startPageTranslation() : stopPageTranslation()
        }
    })
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

function createTooltip(): TooltipController {
    if (!document.getElementById(`${TOOLTIP_ID}-style`)) {
        const s = document.createElement('style')
        s.id = `${TOOLTIP_ID}-style`
        s.textContent = `#${TOOLTIP_ID}::-webkit-scrollbar{width:4px}#${TOOLTIP_ID}::-webkit-scrollbar-track{background:transparent}#${TOOLTIP_ID}::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35);border-radius:4px}#${TOOLTIP_ID}::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,.6)}`
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
    applyTooltipTheme(el, 'dark')
    document.documentElement.appendChild(el)

    // Read stored theme and update tooltip; listen for future changes
    chrome.storage.local.get(['popup_theme'], (data) => {
        const theme = (data['popup_theme'] as string) === 'light' ? 'light' : 'dark'
        applyTooltipTheme(el, theme)
    })
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes['popup_theme']) {
            const theme = changes['popup_theme'].newValue === 'light' ? 'light' : 'dark'
            applyTooltipTheme(el, theme)
        }
    })

    let cleanup: (() => void) | null = null
    const stop = () => {
        cleanup?.();
        cleanup = null
    }

    return {
        show(text, getRect) {
            el.textContent = text
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
        },
        hide() {
            stop();
            el.style.display = 'none'
        },
        isVisible() {
            return el.style.display !== 'none'
        },
    }
}

function registerSelectionTranslation(tooltip: TooltipController) {
    let timer: number | null = null, reqId = 0
    let pointerDownCount = 0

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

        const range = sel.getRangeAt(0).cloneRange()
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)

        if (rects.length > 1) {
            const sorted = [...rects].sort((a, b) => a.top === b.top ? a.left - b.left : a.top - b.top)
            for (let i = 1; i < sorted.length; i++)
                if (sorted[i].top - sorted[i - 1].bottom > MAX_GAP_PX) {
                    tooltip.hide();
                    return
                }
        }

        const text = sel.toString().trim()
        if (!text) {
            tooltip.hide();
            return
        }

        const getRect = (): DOMRect => Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect()
        const rect = getRect()
        if (!rect.width && !rect.height) {
            tooltip.hide();
            return
        }

        tooltip.show('Please wait, translating...', getRect)
        const id = ++reqId
        const out = await translate(text, 'selection')
        if (id === reqId) tooltip.show(out ?? 'Failed to translate', getRect)
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

registerSelectionTranslation(createTooltip())
registerBackgroundMessageHandler()
syncInitialPageTranslationState()
