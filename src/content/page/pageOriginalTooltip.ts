import {getTextNodeAnchorRect} from '../dom/domUtils'
import type {TooltipController} from '../ui/FloatingTooltip'

const DEFAULT_SHOW_DELAY_MS = 1250
const DEFAULT_HIDE_DELAY_MS = 700

type PageOriginalTooltipControllerOptions = {
    tooltipId: string
    getTooltip: () => TooltipController
    isEnabled: () => boolean
    getSourceText: (node: Text) => string | null
    walkTextNodesDeep: (root: Node, visitText: (node: Text) => boolean | void) => boolean
    showDelayMs?: number
    hideDelayMs?: number
}

export class PageOriginalTooltipController {
    private readonly options: PageOriginalTooltipControllerOptions
    private readonly showDelayMs: number
    private readonly hideDelayMs: number
    private showTimer: number | null = null
    private hideTimer: number | null = null
    private pendingNode: Text | null = null
    private visibleNode: Text | null = null
    private pendingText = ''

    constructor(options: PageOriginalTooltipControllerOptions) {
        this.options = options
        this.showDelayMs = options.showDelayMs ?? DEFAULT_SHOW_DELAY_MS
        this.hideDelayMs = options.hideDelayMs ?? DEFAULT_HIDE_DELAY_MS
    }

    start() {
        document.addEventListener('mousemove', this.handlePointerMove, true)
        document.addEventListener('mouseleave', this.handlePointerLeave, true)
        document.addEventListener('scroll', this.handlePointerLeave, true)
    }

    stop() {
        document.removeEventListener('mousemove', this.handlePointerMove, true)
        document.removeEventListener('mouseleave', this.handlePointerLeave, true)
        document.removeEventListener('scroll', this.handlePointerLeave, true)
        this.hide()
    }

    hide() {
        this.clearShowTimer()
        this.clearHideTimer()
        this.pendingNode = null
        this.visibleNode = null
        this.pendingText = ''
        this.options.getTooltip().hide('page-original')
    }

    private clearShowTimer() {
        if (this.showTimer === null) return
        clearTimeout(this.showTimer)
        this.showTimer = null
    }

    private clearHideTimer() {
        if (this.hideTimer === null) return
        clearTimeout(this.hideTimer)
        this.hideTimer = null
    }

    private scheduleHide() {
        this.clearShowTimer()
        if (!this.options.getTooltip().isOwnedBy('page-original')) {
            this.hide()
            return
        }

        this.clearHideTimer()
        this.hideTimer = window.setTimeout(() => {
            this.hide()
        }, this.hideDelayMs)
    }

    private show(node: Text, text: string) {
        this.options.getTooltip().show(text, () => getTextNodeAnchorRect(node), 'page-original')
    }

    private schedule(node: Text, text: string) {
        this.clearHideTimer()
        if (this.visibleNode === node && this.options.getTooltip().isOwnedBy('page-original')) {
            this.show(node, text)
            return
        }

        if (this.pendingNode === node) {
            this.pendingText = text
            return
        }

        this.clearShowTimer()
        this.pendingNode = node
        this.visibleNode = null
        this.pendingText = text
        this.options.getTooltip().hide('page-original')

        this.showTimer = window.setTimeout(() => {
            this.showTimer = null
            if (!this.options.isEnabled() || this.pendingNode !== node || !node.isConnected) return
            if (!this.options.getSourceText(node)) {
                this.hide()
                return
            }

            this.visibleNode = node
            this.show(node, this.pendingText)
        }, this.showDelayMs)
    }

    private textNodeContainsPoint(node: Text, clientX: number, clientY: number): boolean {
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

    private getDeepElementFromPoint(clientX: number, clientY: number): Element | null {
        let element = document.elementFromPoint(clientX, clientY)

        while (element?.shadowRoot) {
            const nested = element.shadowRoot.elementFromPoint(clientX, clientY)
            if (!nested || nested === element) break
            element = nested
        }

        return element
    }

    private getTextNodeAtPoint(clientX: number, clientY: number): Text | null {
        const doc = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null
            caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node | null} | null
        }
        const range = doc.caretRangeFromPoint?.(clientX, clientY)
        const positionedNode = range?.startContainer ?? doc.caretPositionFromPoint?.(clientX, clientY)?.offsetNode
        if (positionedNode?.nodeType === Node.TEXT_NODE) {
            const textNode = positionedNode as Text
            if (this.options.getSourceText(textNode)) return textNode
        }

        const element = this.getDeepElementFromPoint(clientX, clientY)
        if (!element) return null

        let found: Text | null = null
        this.options.walkTextNodesDeep(element, node => {
            if (this.options.getSourceText(node) && this.textNodeContainsPoint(node, clientX, clientY)) {
                found = node
                return false
            }
        })

        return found
    }

    private readonly handlePointerMove = (event: MouseEvent) => {
        if (!this.options.isEnabled()) {
            this.hide()
            return
        }

        const tooltipEl = document.getElementById(this.options.tooltipId)
        if (
            this.options.getTooltip().isOwnedBy('page-original') &&
            tooltipEl &&
            event.target instanceof Node &&
            tooltipEl.contains(event.target)
        ) {
            this.clearHideTimer()
            return
        }

        const node = this.getTextNodeAtPoint(event.clientX, event.clientY)
        const sourceText = node ? this.options.getSourceText(node) : null
        if (!node || !sourceText) {
            this.scheduleHide()
            return
        }

        this.schedule(node, sourceText)
    }

    private readonly handlePointerLeave = () => {
        this.hide()
    }
}
