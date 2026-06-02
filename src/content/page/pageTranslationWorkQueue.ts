export class PageTranslationWorkQueue<T extends object> {
    private readonly queue: T[] = []
    private queued = new WeakSet<T>()
    private active = 0

    get length(): number {
        return this.queue.length
    }

    get activeCount(): number {
        return this.active
    }

    get pendingCount(): number {
        return this.queue.length + this.active
    }

    isQueued(item: T): boolean {
        return this.queued.has(item)
    }

    enqueue(item: T): void {
        this.queued.add(item)
        this.queue.push(item)
    }

    startNext(concurrency: number): T | null {
        if (this.active >= concurrency) return null

        const item = this.queue.shift()
        if (!item) return null

        this.queued.delete(item)
        this.active++
        return item
    }

    complete(): void {
        this.active = Math.max(0, this.active - 1)
    }

    hasPending(): boolean {
        return this.pendingCount > 0
    }

    clear(): void {
        this.queue.length = 0
        this.queued = new WeakSet<T>()
        this.active = 0
    }
}
