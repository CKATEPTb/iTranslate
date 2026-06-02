import type {PagePlaceholderElement} from './pageTranslationContracts'

type PageTranslationVisibilityTrackerOptions = {
    isEnabled(): boolean
    isTextCandidate(node: Text): boolean
    isTextVisible(node: Text): boolean
    walkTextNodesDeep(root: Node, visitText: (node: Text) => boolean | void): boolean
    enqueueText(node: Text): void
    isPlaceholderElement(element: Element): element is PagePlaceholderElement
    isPlaceholderCandidate(element: Element): element is PagePlaceholderElement
    isPlaceholderVisible(element: PagePlaceholderElement): boolean
    enqueuePlaceholder(element: PagePlaceholderElement): void
}

export class PageTranslationVisibilityTracker {
    private readonly options: PageTranslationVisibilityTrackerOptions
    private observer: IntersectionObserver | null = null
    private frame: number | null = null
    private readonly textNodesByTarget = new Map<Element, Set<Text>>()
    private readonly placeholders = new Set<PagePlaceholderElement>()

    constructor(options: PageTranslationVisibilityTrackerOptions) {
        this.options = options
    }

    get isActive(): boolean {
        return !!this.observer
    }

    get observedTextTargetCount(): number {
        return this.textNodesByTarget.size
    }

    get observedPlaceholderCount(): number {
        return this.placeholders.size
    }

    observeTextNode(node: Text) {
        if (!this.options.isEnabled() || !this.options.isTextCandidate(node)) return

        const target = this.getTextObserverTarget(node)
        if (!target) return

        const nodes = this.textNodesByTarget.get(target) ?? new Set<Text>()
        nodes.add(node)
        this.textNodesByTarget.set(target, nodes)
        this.ensureObserver().observe(target)
    }

    unobserveTextNode(node: Text) {
        for (const [target, nodes] of this.textNodesByTarget) {
            if (!nodes.delete(node)) continue

            if (nodes.size === 0) {
                this.textNodesByTarget.delete(target)
                this.observer?.unobserve(target)
            }
            return
        }
    }

    observePlaceholderElement(element: PagePlaceholderElement) {
        if (!this.options.isEnabled() || !this.options.isPlaceholderCandidate(element)) return

        this.placeholders.add(element)
        this.ensureObserver().observe(element)
    }

    unobservePlaceholderElement(element: PagePlaceholderElement) {
        this.placeholders.delete(element)
        this.observer?.unobserve(element)
    }

    forgetTextNodes(root: Node) {
        if (root.nodeType === Node.TEXT_NODE) {
            this.unobserveTextNode(root as Text)
            return
        }

        if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

        this.options.walkTextNodesDeep(root, node => this.unobserveTextNode(node))
    }

    forgetPlaceholders(root: Node) {
        if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return

        const elements = root instanceof Element && this.options.isPlaceholderElement(root)
            ? [root]
            : []

        root.querySelectorAll?.('input[placeholder], textarea[placeholder]').forEach(element => {
            if (this.options.isPlaceholderElement(element)) elements.push(element)
        })

        for (const element of elements) {
            this.unobservePlaceholderElement(element)
        }
    }

    scheduleCheck() {
        if (!this.options.isEnabled() || this.frame !== null) return

        this.frame = window.requestAnimationFrame(() => {
            this.frame = null
            this.checkTextNodes()
            this.checkPlaceholders()
        })
    }

    clear() {
        this.observer?.disconnect()
        this.observer = null
        this.textNodesByTarget.clear()
        this.placeholders.clear()

        if (this.frame !== null) {
            cancelAnimationFrame(this.frame)
            this.frame = null
        }
    }

    private ensureObserver(): IntersectionObserver {
        if (this.observer) return this.observer

        this.observer = new IntersectionObserver((entries) => {
            if (!this.options.isEnabled()) return

            if (entries.some(entry => entry.isIntersecting)) {
                this.scheduleCheck()
            }
        })

        return this.observer
    }

    private getTextObserverTarget(node: Text): Element | null {
        let element: Element | null = node.parentElement
        const fallback = element

        while (element && element !== document.documentElement) {
            if (element.getClientRects().length > 0) return element
            element = element.parentElement
        }

        return fallback
    }

    private checkTextNodes() {
        if (!this.options.isEnabled()) return

        for (const [target, nodes] of this.textNodesByTarget) {
            for (const node of nodes) {
                if (!node.isConnected || !this.options.isTextCandidate(node)) {
                    nodes.delete(node)
                    continue
                }

                if (this.options.isTextVisible(node)) {
                    nodes.delete(node)
                    this.options.enqueueText(node)
                }
            }

            if (nodes.size === 0) {
                this.textNodesByTarget.delete(target)
                this.observer?.unobserve(target)
            }
        }
    }

    private checkPlaceholders() {
        if (!this.options.isEnabled()) return

        for (const element of this.placeholders) {
            if (!element.isConnected || !this.options.isPlaceholderCandidate(element)) {
                this.unobservePlaceholderElement(element)
                continue
            }

            if (this.options.isPlaceholderVisible(element)) {
                this.unobservePlaceholderElement(element)
                this.options.enqueuePlaceholder(element)
            }
        }
    }
}
