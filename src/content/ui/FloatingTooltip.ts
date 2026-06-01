import {autoUpdate, computePosition, flip, offset, shift, type VirtualElement} from '@floating-ui/dom'

export type TooltipOwner = 'selection' | 'page-original'

export type TooltipController = {
    show(text: string, getRect: () => DOMRect, owner?: TooltipOwner): void
    showLoading(getRect: () => DOMRect, owner?: TooltipOwner): void
    showError(message: string, getRect: () => DOMRect, owner?: TooltipOwner): void
    hide(owner?: TooltipOwner): void
    isVisible(): boolean
    isOwnedBy(owner: TooltipOwner): boolean
}

const TOOLTIP_ID = 'itranslate-tooltip'
const MIDDLEWARE = [offset(10), flip({padding: 8}), shift({padding: 8})]

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
    ;(el.style as CSSStyleDeclaration & {webkitBackdropFilter?: string}).webkitBackdropFilter = t.backdropFilter
    el.style.scrollbarColor = t.scrollbarColor
}

function applyTooltipErrorTheme(el: HTMLElement) {
    el.style.background = 'rgba(127, 29, 29, 0.9)'
    el.style.color = '#fee2e2'
    el.style.border = '1px solid rgba(248,113,113,0.72)'
    el.style.boxShadow = '0 12px 34px rgba(127,29,29,0.38), inset 0 1px 0 rgba(255,255,255,0.12)'
    el.style.backdropFilter = 'blur(22px) saturate(170%)'
    ;(el.style as CSSStyleDeclaration & {webkitBackdropFilter?: string}).webkitBackdropFilter = 'blur(22px) saturate(170%)'
    el.style.scrollbarColor = 'rgba(254,202,202,0.45) transparent'
}

export class FloatingTooltip implements TooltipController {
    private readonly el: HTMLElement
    private readonly onRuntimeError: (error: unknown) => boolean
    private cleanup: (() => void) | null = null
    private currentOwner: TooltipOwner | null = null
    private currentTheme: 'dark' | 'light' = 'dark'
    private activeErrorMessage = ''

    constructor(onRuntimeError: (error: unknown) => boolean) {
        this.onRuntimeError = onRuntimeError
        this.installStyle()
        this.el = document.createElement('div')
        this.el.id = TOOLTIP_ID
        Object.assign(this.el.style, {
            position: 'fixed', zIndex: '2147483647', maxWidth: '340px',
            padding: '10px 14px', borderRadius: '16px',
            font: '13px/1.5 -apple-system,"Segoe UI",sans-serif',
            display: 'none', whiteSpace: 'pre-wrap', pointerEvents: 'auto',
            userSelect: 'text', wordBreak: 'break-word', maxHeight: '50vh',
            overflowY: 'auto', scrollbarWidth: 'thin',
            transition: 'opacity 0.15s ease',
        })
        applyTooltipTheme(this.el, this.currentTheme)
        document.documentElement.appendChild(this.el)
        this.registerErrorDetailsHandlers()
        this.syncTheme()
    }

    show(text: string, getRect: () => DOMRect, owner: TooltipOwner = 'selection') {
        this.currentOwner = owner
        this.activeErrorMessage = ''
        this.setTextShape()
        this.applyCurrentTheme()
        this.el.removeAttribute('title')
        this.el.removeAttribute('aria-label')
        this.el.textContent = text
        this.startPositioning(getRect)
    }

    showLoading(getRect: () => DOMRect, owner: TooltipOwner = 'selection') {
        this.currentOwner = owner
        this.activeErrorMessage = ''
        this.setIndicatorShape()
        this.applyCurrentTheme()
        this.el.setAttribute('aria-label', 'Translating')
        this.el.removeAttribute('title')

        const wrapper = document.createElement('span')
        wrapper.className = 'itranslate-tooltip-loading'

        const spinner = document.createElement('span')
        spinner.className = 'itranslate-tooltip-spinner'

        wrapper.append(spinner)
        this.el.replaceChildren(wrapper)
        this.startPositioning(getRect)
    }

    showError(message: string, getRect: () => DOMRect, owner: TooltipOwner = 'selection') {
        this.currentOwner = owner
        this.activeErrorMessage = message
        this.setIndicatorShape()
        applyTooltipErrorTheme(this.el)
        this.el.removeAttribute('title')
        this.el.setAttribute('aria-label', message)

        const indicator = document.createElement('span')
        indicator.className = 'itranslate-tooltip-error'
        indicator.textContent = '!'

        this.el.replaceChildren(indicator)
        this.startPositioning(getRect)
    }

    hide(owner?: TooltipOwner) {
        if (owner && this.currentOwner !== owner) return

        this.currentOwner = null
        this.activeErrorMessage = ''
        this.stop()
        this.el.style.display = 'none'
    }

    isVisible() {
        return this.el.style.display !== 'none'
    }

    isOwnedBy(owner: TooltipOwner) {
        return this.currentOwner === owner && this.el.style.display !== 'none'
    }

    private installStyle() {
        if (document.getElementById(`${TOOLTIP_ID}-style`)) return

        const s = document.createElement('style')
        s.id = `${TOOLTIP_ID}-style`
        s.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}#${TOOLTIP_ID}::-webkit-scrollbar{width:4px}#${TOOLTIP_ID}::-webkit-scrollbar-track{background:transparent}#${TOOLTIP_ID}::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35);border-radius:4px}#${TOOLTIP_ID}::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,.6)}#${TOOLTIP_ID} .itranslate-tooltip-loading{display:flex;align-items:center;justify-content:center}#${TOOLTIP_ID} .itranslate-tooltip-spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}#${TOOLTIP_ID} .itranslate-tooltip-error{display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;border:1.5px solid currentColor;font:700 10px/1 -apple-system,"Segoe UI",sans-serif;cursor:help}`
        document.documentElement.appendChild(s)
    }

    private registerErrorDetailsHandlers() {
        const showErrorDetails = () => {
            if (!this.activeErrorMessage) return

            this.setTextShape()
            applyTooltipErrorTheme(this.el)
            this.el.textContent = this.activeErrorMessage
        }

        this.el.addEventListener('mouseenter', showErrorDetails)
        this.el.addEventListener('focusin', showErrorDetails)
    }

    private syncTheme() {
        try {
            chrome.storage.local.get(['popup_theme'], (data) => {
                try {
                    if (chrome.runtime.lastError) {
                        this.onRuntimeError(chrome.runtime.lastError.message)
                        return
                    }
                } catch (error) {
                    this.onRuntimeError(error)
                    return
                }

                this.currentTheme = (data['popup_theme'] as string) === 'light' ? 'light' : 'dark'
                this.applyCurrentTheme()
            })
        } catch (error) {
            this.onRuntimeError(error)
        }

        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes['popup_theme']) {
                    this.currentTheme = changes['popup_theme'].newValue === 'light' ? 'light' : 'dark'
                    this.applyCurrentTheme()
                }
            })
        } catch (error) {
            this.onRuntimeError(error)
        }
    }

    private applyCurrentTheme() {
        if (this.activeErrorMessage) {
            applyTooltipErrorTheme(this.el)
            return
        }

        applyTooltipTheme(this.el, this.currentTheme)
    }

    private setTextShape() {
        this.el.style.maxWidth = '340px'
        this.el.style.padding = '10px 14px'
        this.el.style.borderRadius = '16px'
        this.el.style.whiteSpace = 'pre-wrap'
        this.el.style.overflowY = 'auto'
        this.el.style.userSelect = 'text'
    }

    private setIndicatorShape() {
        this.el.style.maxWidth = 'none'
        this.el.style.padding = '7px'
        this.el.style.borderRadius = '999px'
        this.el.style.whiteSpace = 'normal'
        this.el.style.overflowY = 'visible'
        this.el.style.userSelect = 'none'
    }

    private stop() {
        this.cleanup?.()
        this.cleanup = null
    }

    private startPositioning(getRect: () => DOMRect) {
        this.el.style.display = 'block'
        this.stop()

        const ref: VirtualElement = {getBoundingClientRect: getRect, contextElement: document.documentElement}
        this.cleanup = autoUpdate(ref, this.el, async () => {
            const {x, y} = await computePosition(ref, this.el, {
                strategy: 'fixed',
                placement: 'top',
                middleware: MIDDLEWARE
            })
            this.el.style.left = `${x}px`
            this.el.style.top = `${y}px`
        })
    }
}
