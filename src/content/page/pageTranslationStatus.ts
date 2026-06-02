import {getTextNodeAnchorRect, getTextNodeElement} from '../dom/domUtils'
import {autoUpdateFloatingPosition, type FloatingReference} from '../ui/floatingPosition'

export const PAGE_TRANSLATION_STATUS_CLASS = 'itranslate-page-status'

const PAGE_TRANSLATION_STATUS_STYLE_ID = 'itranslate-page-status-style'

type PageTranslationStatus = {
    el: HTMLElement
    textEl: HTMLElement
    cleanup: (() => void) | null
    hideTimer: number | null
}

type PageTranslationStatusControllerOptions = {
    isEnabled: () => boolean
    isTextNodeVisible: (node: Text) => boolean
}

export class PageTranslationStatusController {
    private readonly options: PageTranslationStatusControllerOptions
    private readonly statuses = new WeakMap<Text, PageTranslationStatus>()
    private readonly activeNodes = new Set<Text>()

    constructor(options: PageTranslationStatusControllerOptions) {
        this.options = options
    }

    show(node: Text, message: string) {
        if (!this.options.isTextNodeVisible(node)) return

        const status = this.getOrCreate(node)
        if (status.hideTimer !== null) {
            clearTimeout(status.hideTimer)
            status.hideTimer = null
        }

        status.textEl.textContent = message
        status.el.setAttribute('aria-label', message)
        status.el.style.display = 'flex'
        this.stopAutoUpdate(status)

        const ref: FloatingReference = {
            getBoundingClientRect: () => getTextNodeAnchorRect(node),
            contextElement: getTextNodeElement(node) ?? document.documentElement,
        }

        status.cleanup = autoUpdateFloatingPosition(ref, status.el, {
            placement: 'top-start',
            offset: 3,
            padding: 6,
            beforeUpdate: () => {
                if (!this.options.isEnabled() || !node.isConnected || !this.options.isTextNodeVisible(node)) {
                    this.hide(node)
                    return false
                }

                return true
            },
        })
    }

    hide(node?: Text) {
        if (!node) {
            Array.from(this.activeNodes).forEach(activeNode => this.hide(activeNode))
            return
        }

        const status = this.statuses.get(node)
        if (!status) return

        this.stopAutoUpdate(status)
        if (status.hideTimer !== null) clearTimeout(status.hideTimer)
        status.hideTimer = window.setTimeout(() => {
            status.el.remove()
            this.statuses.delete(node)
            this.activeNodes.delete(node)
        }, 80)
    }

    private getOrCreate(node: Text): PageTranslationStatus {
        const existing = this.statuses.get(node)
        if (existing?.el.isConnected && existing.textEl.isConnected) return existing

        ensurePageTranslationStatusStyle()

        const el = document.createElement('div')
        el.className = PAGE_TRANSLATION_STATUS_CLASS
        el.setAttribute('role', 'status')
        el.setAttribute('aria-live', 'polite')
        el.setAttribute('aria-label', 'Translating...')

        const spinner = document.createElement('span')
        spinner.className = 'itranslate-page-status-spinner'

        const textEl = document.createElement('span')
        textEl.className = 'itranslate-page-status-text'

        el.append(spinner, textEl)
        document.documentElement.appendChild(el)

        const status: PageTranslationStatus = {el, textEl, cleanup: null, hideTimer: null}
        this.statuses.set(node, status)
        this.activeNodes.add(node)
        return status
    }

    private stopAutoUpdate(status: PageTranslationStatus) {
        status.cleanup?.()
        status.cleanup = null
    }
}

function ensurePageTranslationStatusStyle() {
    if (document.getElementById(PAGE_TRANSLATION_STATUS_STYLE_ID)) return

    const style = document.createElement('style')
    style.id = PAGE_TRANSLATION_STATUS_STYLE_ID
    style.textContent = `@keyframes itranslate-spin{to{transform:rotate(360deg)}}.${PAGE_TRANSLATION_STATUS_CLASS}{position:fixed;z-index:2147483647;display:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border-radius:999px;background:rgba(15,23,42,.72);color:#f8fafc;border:1px solid rgba(255,255,255,.14);box-shadow:0 5px 14px rgba(15,23,42,.2);font:10px/1 -apple-system,"Segoe UI",sans-serif;pointer-events:none;backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%)}.${PAGE_TRANSLATION_STATUS_CLASS} .itranslate-page-status-spinner{width:8px;height:8px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:999px;animation:itranslate-spin .75s linear infinite;flex:0 0 auto}.${PAGE_TRANSLATION_STATUS_CLASS} .itranslate-page-status-text{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`
    document.documentElement.appendChild(style)
}
