export type FloatingReference = {
    getBoundingClientRect(): DOMRect | DOMRectReadOnly
    contextElement?: Element | null
}

export type FloatingPlacement = 'top' | 'top-start' | 'bottom' | 'bottom-start'

type FloatingPositionOptions = {
    placement?: FloatingPlacement
    offset?: number
    padding?: number
}

type FloatingAutoUpdateOptions = FloatingPositionOptions & {
    beforeUpdate?: () => boolean
}

const DEFAULT_PLACEMENT: FloatingPlacement = 'top'
const DEFAULT_OFFSET = 8
const DEFAULT_PADDING = 8

function clamp(value: number, min: number, max: number) {
    if (max < min) return min
    return Math.min(Math.max(value, min), max)
}

function getViewportRect() {
    const visualViewport = window.visualViewport
    const left = visualViewport?.offsetLeft ?? 0
    const top = visualViewport?.offsetTop ?? 0
    const width = visualViewport?.width ?? window.innerWidth
    const height = visualViewport?.height ?? window.innerHeight

    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
    }
}

export function updateFloatingPosition(
    reference: FloatingReference,
    floating: HTMLElement,
    {
        placement = DEFAULT_PLACEMENT,
        offset = DEFAULT_OFFSET,
        padding = DEFAULT_PADDING,
    }: FloatingPositionOptions = {},
) {
    const referenceRect = reference.getBoundingClientRect()
    const floatingRect = floating.getBoundingClientRect()
    const viewport = getViewportRect()
    const preferredSide = placement.startsWith('bottom') ? 'bottom' : 'top'
    const alignStart = placement.endsWith('-start')
    const topY = referenceRect.top - floatingRect.height - offset
    const bottomY = referenceRect.bottom + offset
    const fitsTop = topY >= viewport.top + padding
    const fitsBottom = bottomY + floatingRect.height <= viewport.bottom - padding
    const side = preferredSide === 'top'
        ? (!fitsTop && fitsBottom ? 'bottom' : 'top')
        : (!fitsBottom && fitsTop ? 'top' : 'bottom')
    const rawX = alignStart
        ? referenceRect.left
        : referenceRect.left + (referenceRect.width - floatingRect.width) / 2
    const rawY = side === 'top' ? topY : bottomY
    const x = clamp(rawX, viewport.left + padding, viewport.right - floatingRect.width - padding)
    const y = clamp(rawY, viewport.top + padding, viewport.bottom - floatingRect.height - padding)

    floating.style.left = `${Math.round(x)}px`
    floating.style.top = `${Math.round(y)}px`
}

export function autoUpdateFloatingPosition(
    reference: FloatingReference,
    floating: HTMLElement,
    options: FloatingAutoUpdateOptions = {},
) {
    let frame = 0
    let stopped = false
    const visualViewport = window.visualViewport

    const run = () => {
        frame = 0
        if (stopped || options.beforeUpdate?.() === false) return
        updateFloatingPosition(reference, floating, options)
    }

    const schedule = () => {
        if (stopped || frame !== 0) return
        frame = window.requestAnimationFrame(run)
    }

    const observeOptions = {capture: true, passive: true}
    const resizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule)

    window.addEventListener('scroll', schedule, observeOptions)
    window.addEventListener('resize', schedule, observeOptions)
    visualViewport?.addEventListener('scroll', schedule, observeOptions)
    visualViewport?.addEventListener('resize', schedule, observeOptions)
    resizeObserver?.observe(floating)
    if (reference.contextElement) resizeObserver?.observe(reference.contextElement)
    schedule()

    return () => {
        stopped = true
        if (frame !== 0) window.cancelAnimationFrame(frame)
        frame = 0
        window.removeEventListener('scroll', schedule, observeOptions)
        window.removeEventListener('resize', schedule, observeOptions)
        visualViewport?.removeEventListener('scroll', schedule, observeOptions)
        visualViewport?.removeEventListener('resize', schedule, observeOptions)
        resizeObserver?.disconnect()
    }
}
