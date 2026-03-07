import {autoUpdate, computePosition, flip, offset, shift, type VirtualElement} from '@floating-ui/dom'

type TranslateMode = 'selection' | 'input'
type TranslateResponse = { ok: true; translatedText: string } | { ok: false; error?: string }
type TooltipController = { show(text: string, getRect: () => DOMRect): void; hide(): void; isVisible(): boolean }

const TOOLTIP_ID = 'itranslate-tooltip'
const DELAY_MS = 400
const MAX_GAP_PX = 96
const INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password'])
const MIDDLEWARE = [offset(10), flip({padding: 8}), shift({padding: 8})]

const translate = (text: string, mode: TranslateMode): Promise<string | null> =>
    new Promise(resolve =>
        chrome.runtime.sendMessage({type: 'TRANSLATE_TEXT', text, mode}, (r: TranslateResponse | undefined) =>
            resolve(!chrome.runtime.lastError && r?.ok && typeof r.translatedText === 'string' ? r.translatedText : null)
        )
    )

const fireInput = (el: HTMLElement) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value)
    }
    el.dispatchEvent(new InputEvent('input', {bubbles: true, cancelable: true, inputType: 'insertText'}))
    el.dispatchEvent(new Event('change', {bubbles: true}))
}

const getEditable = (): HTMLElement | null => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return null
    if (el instanceof HTMLTextAreaElement) return el
    if (el instanceof HTMLInputElement && !el.disabled && !el.readOnly && INPUT_TYPES.has(el.type)) return el
    if (el.isContentEditable) return el
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
    await (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? transformInput(el) : transformContentEditable(el))
}

function registerBackgroundMessageHandler() {
    chrome.runtime.onMessage.addListener((msg: unknown) => {
        if ((msg as { type?: string })?.type === 'APPLY_TRANSFORM_TO_FOCUS') void transformFocused()
    })
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
        padding: '10px 12px', borderRadius: '10px', background: '#0f172a',
        color: '#fff', border: '1px solid rgba(148,163,184,0.24)',
        font: '13px/1.4 "Segoe UI",Tahoma,sans-serif',
        boxShadow: '0 10px 28px rgba(2,6,23,0.45)', display: 'none',
        whiteSpace: 'pre-wrap', pointerEvents: 'auto', userSelect: 'text',
        wordBreak: 'break-word', maxHeight: '50vh', overflowY: 'auto',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(148,163,184,0.35) transparent',
    })
    document.documentElement.appendChild(el)

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
    let timer: number | null = null, reqId = 0, mouseDown = false

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

        tooltip.show('Translating...', getRect)
        const id = ++reqId
        const out = await translate(text, 'selection')
        if (id === reqId) tooltip.show(out ?? 'Failed to translate', getRect)
    }

    const schedule = () => {
        if (mouseDown) return;
        clearTimer();
        timer = window.setTimeout(run, DELAY_MS)
    }

    document.addEventListener('mousedown', () => {
        mouseDown = true
    })
    document.addEventListener('mouseup', () => {
        mouseDown = false;
        schedule()
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