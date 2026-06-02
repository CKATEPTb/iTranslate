import {hasTranslatableText} from './pageTextUtils'

type PageTranslationSuggestionWatcherOptions = {
    isBlocked: () => boolean
    suggest: () => void | Promise<void>
    walkOpenShadowRootsDeep: (root: Node, visitShadowRoot: (root: ShadowRoot) => void) => void
    shouldSkipElement: (element: Element) => boolean
    hasTranslatableTextDeep: (root: Node) => boolean
    retryDelaysMs?: readonly number[]
}

const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000] as const

export class PageTranslationSuggestionWatcher {
    private readonly options: PageTranslationSuggestionWatcherOptions
    private readonly retryDelaysMs: readonly number[]
    private observer: MutationObserver | null = null
    private timer: number | null = null
    private retryCount = 0
    private readonly shadowRoots = new Set<ShadowRoot>()

    constructor(options: PageTranslationSuggestionWatcherOptions) {
        this.options = options
        this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    }

    get isObserverActive() {
        return !!this.observer
    }

    clearTimer() {
        if (this.timer === null) return

        clearTimeout(this.timer)
        this.timer = null
    }

    resetRetries() {
        this.retryCount = 0
    }

    stopObserver() {
        this.observer?.disconnect()
        this.observer = null
        this.shadowRoots.clear()
        document.removeEventListener('scroll', this.handleViewportChange, true)
        window.removeEventListener('resize', this.handleViewportChange)
    }

    schedule(delay = 1200, resetRetries = false) {
        if (this.options.isBlocked()) return
        if (resetRetries) this.resetRetries()

        this.clearTimer()
        this.timer = window.setTimeout(() => {
            this.timer = null
            void this.options.suggest()
        }, delay)
    }

    scheduleRetry() {
        if (this.options.isBlocked()) return

        const delay = this.retryDelaysMs[this.retryCount]
        if (delay == null) return

        this.retryCount++
        this.schedule(delay)
    }

    startObserver() {
        if (this.observer || this.options.isBlocked()) return

        const root = document.body ?? document.documentElement
        if (!root) {
            this.schedule(800, true)
            return
        }

        this.observer = new MutationObserver((mutations) => {
            if (this.options.isBlocked()) {
                this.stopObserver()
                return
            }

            if (this.hasTextChange(mutations)) this.schedule(1400, true)
        })

        this.observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
        })
        this.observeShadowRoots(root)
        document.addEventListener('scroll', this.handleViewportChange, true)
        window.addEventListener('resize', this.handleViewportChange)
    }

    private readonly handleViewportChange = () => {
        this.schedule(700, true)
    }

    private observeShadowRoots(root: Node) {
        const observer = this.observer
        if (!observer) return

        this.options.walkOpenShadowRootsDeep(root, shadowRoot => {
            if (this.shadowRoots.has(shadowRoot)) return

            this.shadowRoots.add(shadowRoot)
            observer.observe(shadowRoot, {
                childList: true,
                subtree: true,
                characterData: true,
            })
        })
    }

    private hasTextChange(mutations: MutationRecord[]) {
        return mutations.some((mutation) => {
            if (mutation.type === 'characterData') return true

            for (const node of mutation.addedNodes) {
                this.observeShadowRoots(node)
                if (node.nodeType === Node.TEXT_NODE) return hasTranslatableText(node.textContent ?? '')
                if (!(node instanceof Element) || this.options.shouldSkipElement(node)) continue
                if (this.options.hasTranslatableTextDeep(node)) return true
            }

            return false
        })
    }
}
