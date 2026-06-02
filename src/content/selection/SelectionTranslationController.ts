import type {TooltipController} from '../ui/FloatingTooltip'

type TranslateResponse = { ok: true; translatedText: string; skipped?: boolean } | { ok: false; error?: string }
type TranslatePrecheckResponse = { ok: true; skipped: boolean } | { ok: false; error?: string }
type SelectionPoint = { x: number; y: number; timestamp: number }
type VisibleSelectionExtract = { text: string; rects: DOMRect[] }

type SelectionTranslationControllerOptions = {
    tooltip: TooltipController
    getVisibleSelectionExtract(selection: Selection, point: SelectionPoint | null): VisibleSelectionExtract
    precheck(text: string): Promise<TranslatePrecheckResponse>
    translate(text: string): Promise<TranslateResponse>
    isRuntimeValid(): boolean
}

const TOOLTIP_ID = 'itranslate-tooltip'
const DELAY_MS = 400
const MAX_GAP_PX = 96

export class SelectionTranslationController {
    private readonly tooltip: TooltipController
    private readonly getVisibleSelectionExtract: SelectionTranslationControllerOptions['getVisibleSelectionExtract']
    private readonly precheck: SelectionTranslationControllerOptions['precheck']
    private readonly translate: SelectionTranslationControllerOptions['translate']
    private readonly isRuntimeValid: SelectionTranslationControllerOptions['isRuntimeValid']
    private timer: number | null = null
    private reqId = 0
    private pointerDownCount = 0
    private lastSelectionPoint: SelectionPoint | null = null
    private started = false

    constructor(options: SelectionTranslationControllerOptions) {
        this.tooltip = options.tooltip
        this.getVisibleSelectionExtract = options.getVisibleSelectionExtract
        this.precheck = options.precheck
        this.translate = options.translate
        this.isRuntimeValid = options.isRuntimeValid
    }

    start() {
        if (this.started) return

        this.started = true
        document.addEventListener('pointerdown', this.onPointerDown)
        document.addEventListener('pointerup', this.onPointerUp)
        document.addEventListener('pointercancel', this.onPointerCancel)
        document.addEventListener('keyup', this.onKeyUp)
        document.addEventListener('scroll', this.onScroll, true)
        document.addEventListener('click', this.onClick, true)
    }

    stop() {
        if (!this.started) return

        this.started = false
        document.removeEventListener('pointerdown', this.onPointerDown)
        document.removeEventListener('pointerup', this.onPointerUp)
        document.removeEventListener('pointercancel', this.onPointerCancel)
        document.removeEventListener('keyup', this.onKeyUp)
        document.removeEventListener('scroll', this.onScroll, true)
        document.removeEventListener('click', this.onClick, true)
        this.hide()
    }

    private readonly onPointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'mouse') {
            this.pointerDownCount++
            this.clearTimer()
        }
    }

    private readonly onPointerUp = (event: PointerEvent) => {
        if (event.pointerType === 'mouse') {
            this.lastSelectionPoint = {x: event.clientX, y: event.clientY, timestamp: Date.now()}
            this.pointerDownCount = Math.max(0, this.pointerDownCount - 1)
            setTimeout(this.schedule, 0)
        }
    }

    private readonly onPointerCancel = (event: PointerEvent) => {
        if (event.pointerType === 'mouse') {
            this.pointerDownCount = Math.max(0, this.pointerDownCount - 1)
        }
    }

    private readonly onKeyUp = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            this.hide()
            return
        }

        this.schedule()
    }

    private readonly onScroll = (event: Event) => {
        if (this.tooltip.isVisible() && !this.inTooltip(event.target)) this.hide()
    }

    private readonly onClick = (event: Event) => {
        if (this.tooltip.isVisible() && !this.inTooltip(event.target)) this.hide()
    }

    private tooltipNode() {
        return document.getElementById(TOOLTIP_ID)
    }

    private inTooltip(target: EventTarget | null) {
        const node = this.tooltipNode()
        return !!node && target instanceof Node && node.contains(target)
    }

    private isTooltipSelection(selection: Selection) {
        const node = this.tooltipNode()
        return !!node && (node.contains(selection.anchorNode) || node.contains(selection.focusNode))
    }

    private isEditable(node: Node | null) {
        const element = node instanceof Element ? node : node?.parentElement
        return !!element && (
            !!element.closest('input,textarea') ||
            !!(element.closest('[contenteditable]') as HTMLElement | null)?.isContentEditable
        )
    }

    private clearTimer() {
        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

    private hide() {
        this.clearTimer()
        this.tooltip.hide()
    }

    private getRecentSelectionPoint() {
        if (!this.lastSelectionPoint || Date.now() - this.lastSelectionPoint.timestamp > 2000) return null
        return this.lastSelectionPoint
    }

    private readonly schedule = () => {
        if (this.pointerDownCount > 0) return

        this.clearTimer()
        this.timer = window.setTimeout(() => {
            void this.run()
        }, DELAY_MS)
    }

    private async run() {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
            this.tooltip.hide()
            return
        }
        if (this.isTooltipSelection(selection)) return
        if (this.isEditable(selection.anchorNode) || this.isEditable(selection.focusNode)) {
            this.tooltip.hide()
            return
        }

        const selectionExtract = this.getVisibleSelectionExtract(selection, this.getRecentSelectionPoint())
        const text = selectionExtract.text
        if (!text) {
            this.tooltip.hide()
            return
        }

        const range = selection.getRangeAt(0).cloneRange()
        const rects = selectionExtract.rects

        if (rects.length > 1) {
            const sorted = [...rects].sort((a, b) => a.top === b.top ? a.left - b.left : a.top - b.top)
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i].top - sorted[i - 1].bottom > MAX_GAP_PX) {
                    this.tooltip.hide()
                    return
                }
            }
        }

        const getRect = (): DOMRect => rects.at(-1) ?? range.getBoundingClientRect()
        const rect = getRect()
        if (!rect.width && !rect.height) {
            this.tooltip.hide()
            return
        }

        const id = ++this.reqId
        this.tooltip.hide()
        const precheckResponse = await this.precheck(text)
        if (!this.isRuntimeValid()) {
            this.tooltip.hide()
            return
        }
        if (id !== this.reqId) return
        if (precheckResponse.ok && precheckResponse.skipped) {
            this.tooltip.hide()
            return
        }
        if (!precheckResponse.ok) {
            this.tooltip.showError(precheckResponse.error ?? 'Failed to check translation', getRect)
            return
        }

        this.tooltip.showLoading(getRect)
        const response = await this.translate(text)
        if (!this.isRuntimeValid()) {
            this.tooltip.hide()
            return
        }
        if (id !== this.reqId) return
        if (response.ok && response.skipped) {
            this.tooltip.hide()
            return
        }
        if (response.ok) {
            this.tooltip.show(response.translatedText, getRect)
            return
        }

        this.tooltip.showError(response.error ?? 'Failed to translate', getRect)
    }
}
