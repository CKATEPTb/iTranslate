type PageTranslationDebugWindow = Window & {
    __itranslatePageTranslationDebug?: () => Record<string, unknown>
}

function formatDebugTime(value: number): string | null {
    return value > 0 ? new Date(value).toISOString() : null
}

export class PageTranslationDiagnostics {
    observerCreatedAt = 0
    observerAttachedAt = 0
    observerDisconnectedAt = 0
    lastStartAt = 0
    lastStopAt = 0
    lastRuntimeInvalidatedAt = 0
    lastMutationAt = 0
    mutationBatches = 0
    mutationRecords = 0
    mutationRecordsWhileDisabled = 0
    collectRuns = 0
    mutationRescansScheduled = 0
    mutationRescansRun = 0
    activeRescansRun = 0
    queuedText = 0
    queuedPlaceholders = 0
    translatedText = 0
    translatedPlaceholders = 0
    skippedTranslations = 0
    failedTranslations = 0
    lastRuntimeState = 'init'
    lastError: string | null = null

    installHook(snapshot: () => Record<string, unknown>) {
        ;(window as PageTranslationDebugWindow).__itranslatePageTranslationDebug = snapshot
    }

    markRuntimeState(state: string) {
        this.lastRuntimeState = state
    }

    markError(error: unknown) {
        this.lastError = error instanceof Error
            ? error.message
            : typeof error === 'string'
                ? error
                : String(error)
    }

    markMutationBatch(recordCount: number, enabled: boolean) {
        this.mutationBatches++
        this.mutationRecords += recordCount
        this.lastMutationAt = Date.now()
        if (!enabled) this.mutationRecordsWhileDisabled += recordCount
    }

    get queuedWorkCount() {
        return this.queuedText + this.queuedPlaceholders
    }

    getSnapshotFields(activeRescanDelayMs: number, lastCollectAt: number): Record<string, unknown> {
        return {
            observerCreatedAt: formatDebugTime(this.observerCreatedAt),
            observerAttachedAt: formatDebugTime(this.observerAttachedAt),
            observerDisconnectedAt: formatDebugTime(this.observerDisconnectedAt),
            lastStartAt: formatDebugTime(this.lastStartAt),
            lastStopAt: formatDebugTime(this.lastStopAt),
            lastRuntimeInvalidatedAt: formatDebugTime(this.lastRuntimeInvalidatedAt),
            lastMutationAt: formatDebugTime(this.lastMutationAt),
            mutationBatches: this.mutationBatches,
            mutationRecords: this.mutationRecords,
            mutationRecordsWhileDisabled: this.mutationRecordsWhileDisabled,
            collectRuns: this.collectRuns,
            mutationRescansScheduled: this.mutationRescansScheduled,
            mutationRescansRun: this.mutationRescansRun,
            activeRescansRun: this.activeRescansRun,
            activeRescanDelayMs,
            lastCollectAt: formatDebugTime(lastCollectAt),
            queuedText: this.queuedText,
            queuedPlaceholders: this.queuedPlaceholders,
            translatedText: this.translatedText,
            translatedPlaceholders: this.translatedPlaceholders,
            skippedTranslations: this.skippedTranslations,
            failedTranslations: this.failedTranslations,
            lastRuntimeState: this.lastRuntimeState,
            lastError: this.lastError,
        }
    }
}
