const TOOLTIP_ID = 'itranslate-tooltip'
const STATUS_ID = 'itranslate-status'
const PAGE_TRANSLATION_PROMPT_ID = 'itranslate-page-translation-prompt'
const PAGE_STATUS_CLASS = 'itranslate-page-status'

const SELECTION_TRANSLATION_SKIP_SELECTOR = [
    `#${TOOLTIP_ID}`,
    `#${STATUS_ID}`,
    `#${PAGE_TRANSLATION_PROMPT_ID}`,
    `.${PAGE_STATUS_CLASS}`,
].join(',')

export type VisibleSelectionExtract = {
    text: string
    rects: DOMRect[]
}

export type SelectionPoint = {
    x: number
    y: number
    timestamp: number
}

export type VisibleSelectionCandidate = {
    text: string
    node: Text
    container: Element | null
    block: Element | null
    rects: DOMRect[]
}

export function getViewportSize() {
    const doc = document.documentElement
    return {
        width: window.innerWidth || doc.clientWidth,
        height: window.innerHeight || doc.clientHeight,
    }
}

export function rectIntersectsViewport(rect: DOMRect | DOMRectReadOnly): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false

    const {width, height} = getViewportSize()
    return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width
}

export function getOpenShadowRoot(node: Node): ShadowRoot | null {
    if (!(node instanceof Element)) return null

    try {
        return node.shadowRoot
    } catch {
        return null
    }
}

export function getShadowHostForNode(node: Node): Element | null {
    const root = node.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
}

export function getShadowIncludingParentElement(element: Element): Element | null {
    return element.parentElement ?? getShadowHostForNode(element)
}

export function closestElementDeep(element: Element, selector: string): Element | null {
    let current: Element | null = element

    while (current) {
        const match = current.closest(selector)
        if (match) return match

        current = getShadowHostForNode(current)
    }

    return null
}

export function getTextNodeElement(node: Text): HTMLElement | null {
    const parent = node.parentElement ?? getShadowHostForNode(node)
    return parent instanceof HTMLElement ? parent : null
}

export function isElementStyleVisible(element: Element): boolean {
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

export function isElementVisibleForSelection(element: Element): boolean {
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

export function getVisibleSelectionRangeRects(range: Range): DOMRect[] {
    return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
}

export function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function rectIntersectsAny(rect: DOMRect, rects: DOMRect[]): boolean {
    return rects.some(selectionRect => rectsOverlap(rect, selectionRect))
}

export function selectionRangeIntersectsNode(range: Range, node: Node): boolean {
    try {
        return range.intersectsNode(node)
    } catch {
        return false
    }
}

export function getTextNodesInSelectionRange(range: Range): Text[] {
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

export function getSelectedTextNodeRange(range: Range, node: Text): Range | null {
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

export function getElementForNode(node: Node): Element | null {
    return node instanceof Element ? node : node.parentElement
}

export function walkTextNodesDeep(
    root: Node,
    visitText: (node: Text) => boolean | void,
    shouldSkipElement: (element: Element) => boolean = () => false,
): boolean {
    const visitRoot = (currentRoot: Node): boolean => {
        if (currentRoot.nodeType === Node.TEXT_NODE) {
            return visitText(currentRoot as Text) !== false
        }

        if (currentRoot instanceof Element && shouldSkipElement(currentRoot)) {
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
                if (node instanceof Element && shouldSkipElement(node)) return NodeFilter.FILTER_REJECT
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

export function walkOpenShadowRootsDeep(
    root: Node,
    visitShadowRoot: (root: ShadowRoot) => void,
    shouldSkipElement: (element: Element) => boolean = () => false,
) {
    const visitRoot = (currentRoot: Node) => {
        if (currentRoot instanceof Element && shouldSkipElement(currentRoot)) return
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
                return node instanceof Element && shouldSkipElement(node)
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

export function hasTranslatableTextDeep(
    root: Node,
    hasTranslatableText: (text: string) => boolean,
    shouldSkipElement: (element: Element) => boolean = () => false,
): boolean {
    let found = false
    walkTextNodesDeep(root, node => {
        if (hasTranslatableText(node.textContent ?? '')) {
            found = true
            return false
        }
    }, shouldSkipElement)
    return found
}

export function isDocumentScopeElement(element: Element): boolean {
    return element === document.documentElement || element === document.body
}

export function isBlockLikeDisplay(display: string): boolean {
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

export function getSelectionBlockForNode(node: Node): Element | null {
    let element = getElementForNode(node)
    const fallback = element

    while (element && !isDocumentScopeElement(element)) {
        if (isBlockLikeDisplay(window.getComputedStyle(element).display)) return element
        element = element.parentElement
    }

    return fallback
}

export function getSelectionTextContainerForNode(node: Node): Element | null {
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

export function getCaretNodeFromPoint(point: SelectionPoint): Node | null {
    const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node | null } | null
    }

    const range = doc.caretRangeFromPoint?.(point.x, point.y)
    if (range?.startContainer) return range.startContainer

    return doc.caretPositionFromPoint?.(point.x, point.y)?.offsetNode ?? null
}

export function areElementsRelated(a: Element, b: Element): boolean {
    return a === b || a.contains(b) || b.contains(a)
}

export function getRectArea(rect: DOMRect): number {
    return rect.width * rect.height
}

export function getCandidateArea(candidate: VisibleSelectionCandidate): number {
    return candidate.rects.reduce((area, rect) => area + getRectArea(rect), 0)
}

export function getPointDistanceToRect(point: SelectionPoint, rect: DOMRect): number {
    const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0
    const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0
    return Math.hypot(dx, dy)
}

export function getCandidateDistanceToPoint(candidate: VisibleSelectionCandidate, point: SelectionPoint): number {
    return Math.min(...candidate.rects.map(rect => getPointDistanceToRect(point, rect)))
}

export function getPrimarySelectionContainer(candidates: VisibleSelectionCandidate[], point: SelectionPoint | null): Element | null {
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

export function filterSelectionCandidates(candidates: VisibleSelectionCandidate[], primaryContainer: Element | null): VisibleSelectionCandidate[] {
    if (!primaryContainer) return candidates

    const relatedCandidates = candidates.filter(candidate => candidate.container && areElementsRelated(candidate.container, primaryContainer))
    return relatedCandidates.length > 0 ? relatedCandidates : candidates
}

export function getSelectionTextBlock(node: Text): Element | null {
    return getSelectionBlockForNode(node)
}

export function normalizeVisibleSelectionText(text: string): string {
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\f\v]+\n/g, '\n')
        .replace(/\n[ \t\f\v]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export function getVisibleSelectionExtract(selection: Selection, point: SelectionPoint | null = null): VisibleSelectionExtract {
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

export function getTextNodeVisibleRect(
    node: Text,
    shouldSkipElement: (element: Element) => boolean = () => false,
): DOMRect | null {
    const parent = getTextNodeElement(node)
    if (!parent || shouldSkipElement(parent) || !isElementStyleVisible(parent)) return null

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

export function isTextNodeVisible(node: Text, shouldSkipElement: (element: Element) => boolean = () => false): boolean {
    return getTextNodeVisibleRect(node, shouldSkipElement) !== null
}

export function getTextNodeAnchorRect(node: Text): DOMRect {
    const visibleRect = getTextNodeVisibleRect(node)
    if (visibleRect) return visibleRect

    const parent = getTextNodeElement(node)
    return parent?.getBoundingClientRect() ?? new DOMRect()
}
