import {
    PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS,
    PAGE_TRANSLATION_ACTIVE_RESCAN_MAX_INTERVAL_MS,
    PAGE_TRANSLATION_ACTIVE_RESCAN_RECENT_COLLECT_MS,
    PAGE_TRANSLATION_MUTATION_RESCAN_DELAY_MS,
} from './pageTranslationConfig'

type PageTranslationRescanSchedulerOptions = {
    isEnabled: () => boolean
    hasPendingWork: () => boolean
    getQueuedWorkCount: () => number
    collectTargets: () => void
    onCollectRun: () => void
    onMutationScheduled: () => void
    onMutationRun: () => void
    onActiveRun: () => void
}

export class PageTranslationRescanScheduler {
    private mutationTimer: number | null = null
    private activeTimer: number | null = null
    private activeDelay = PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS
    private collectedAt = 0
    private readonly options: PageTranslationRescanSchedulerOptions

    constructor(options: PageTranslationRescanSchedulerOptions) {
        this.options = options
    }

    get activeRescanDelay(): number {
        return this.activeDelay
    }

    get lastCollectAt(): number {
        return this.collectedAt
    }

    markCollected(): void {
        this.collectedAt = Date.now()
        this.options.onCollectRun()
    }

    resetActiveDelay(): void {
        this.activeDelay = PAGE_TRANSLATION_ACTIVE_RESCAN_INTERVAL_MS
    }

    resetCollectionTime(): void {
        this.collectedAt = 0
    }

    scheduleMutation(): void {
        if (!this.options.isEnabled()) return

        this.resetActiveDelay()
        this.clearMutation()
        this.options.onMutationScheduled()

        this.mutationTimer = window.setTimeout(() => {
            this.mutationTimer = null
            if (!this.options.isEnabled()) return

            this.options.onMutationRun()
            this.options.collectTargets()
        }, PAGE_TRANSLATION_MUTATION_RESCAN_DELAY_MS)
    }

    scheduleActive(): void {
        if (!this.options.isEnabled() || this.activeTimer !== null) return

        this.activeTimer = window.setTimeout(() => {
            this.activeTimer = null
            if (!this.options.isEnabled()) return

            this.runActiveRescanStep()
            this.scheduleActive()
        }, this.activeDelay)
    }

    clearMutation(): void {
        if (this.mutationTimer === null) return

        clearTimeout(this.mutationTimer)
        this.mutationTimer = null
    }

    clearActive(): void {
        if (this.activeTimer === null) return

        clearTimeout(this.activeTimer)
        this.activeTimer = null
    }

    clearAll(): void {
        this.clearMutation()
        this.clearActive()
    }

    private runActiveRescanStep(): void {
        const hasPendingWork = this.options.hasPendingWork()
        const recentlyCollected = Date.now() - this.collectedAt < PAGE_TRANSLATION_ACTIVE_RESCAN_RECENT_COLLECT_MS

        if (document.visibilityState === 'visible' && !hasPendingWork && !recentlyCollected) {
            const queuedBefore = this.options.getQueuedWorkCount()
            this.options.onActiveRun()
            this.options.collectTargets()
            const queuedAfter = this.options.getQueuedWorkCount()

            if (queuedAfter === queuedBefore && !this.options.hasPendingWork()) {
                this.activeDelay = Math.min(
                    Math.ceil(this.activeDelay * 1.5),
                    PAGE_TRANSLATION_ACTIVE_RESCAN_MAX_INTERVAL_MS
                )
            } else {
                this.resetActiveDelay()
            }
            return
        }

        if (hasPendingWork) {
            this.resetActiveDelay()
        }
    }
}
