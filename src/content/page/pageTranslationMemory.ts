import type {DetectableLanguage} from '../../languageDetection'

export class PageTranslationMemory {
    private sourceOverride: DetectableLanguage | null = null
    private readonly cache = new Map<string, string>()
    private readonly skipped = new Set<string>()
    private readonly inflight = new Map<string, Promise<string | null>>()

    get sourceLanguageOverride(): DetectableLanguage | null {
        return this.sourceOverride
    }

    get cacheSize(): number {
        return this.cache.size
    }

    get skipCacheSize(): number {
        return this.skipped.size
    }

    get inflightCount(): number {
        return this.inflight.size
    }

    hasActiveRequests(): boolean {
        return this.inflight.size > 0
    }

    setSourceOverride(sourceLanguage?: DetectableLanguage | null): boolean {
        if (!sourceLanguage || this.sourceOverride === sourceLanguage) return false

        this.sourceOverride = sourceLanguage
        this.clearTranslations()
        return true
    }

    clearSourceOverride(): void {
        this.sourceOverride = null
    }

    clearTranslations(): void {
        this.cache.clear()
        this.skipped.clear()
        this.inflight.clear()
    }

    clearActiveRequests(): void {
        this.inflight.clear()
    }

    getCached(value: string): string | null {
        return this.cache.get(value) ?? null
    }

    setCached(value: string, translated: string): void {
        this.cache.set(value, translated)
    }

    isSkipped(value: string): boolean {
        return this.skipped.has(value)
    }

    markSkipped(value: string): void {
        this.skipped.add(value)
    }

    getActiveRequest(value: string): Promise<string | null> | null {
        return this.inflight.get(value) ?? null
    }

    setActiveRequest(value: string, request: Promise<string | null>): void {
        this.inflight.set(value, request)
    }

    deleteActiveRequest(value: string): void {
        this.inflight.delete(value)
    }
}
