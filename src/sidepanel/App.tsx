import {Component, Store} from '#mini-jsx'
import {SidePanelFromStore, SidePanelProviderStore, SidePanelThemeStore, SidePanelToStore} from '../store.ts'
import {DEFAULT_PROVIDER, isKnownProvider, normalizeProvider, TRANSLATION_PROVIDERS} from '../providers.ts'

const TARGET_LANGS = ['en', 'ru', 'ua', 'de', 'fr'] as const
const SOURCE_LANGS = ['auto', ...TARGET_LANGS] as const
type TargetLangCode = typeof TARGET_LANGS[number]
type SourceLangCode = typeof SOURCE_LANGS[number]
type LangCode = SourceLangCode | TargetLangCode

const LANG_LABELS: Record<LangCode, string> = {
    auto: 'Auto detect',
    en: 'English',
    ru: 'Russian',
    ua: 'Ukrainian',
    de: 'German',
    fr: 'French',
}

const HISTORY_KEY = 'sidepanel_history'
const HISTORY_LIMIT = 100

function getFallbackTargetLanguage(excluded: string): TargetLangCode {
    return TARGET_LANGS.find(language => language !== excluded) ?? TARGET_LANGS[0]
}

interface HistoryEntry {
    id: string
    provider: string
    from: string
    to: string
    source: string
    result: string
    timestamp: number
}

// Local reactive stores — not persisted to chrome.storage.sync
const resultStore = new Store('', 'sp-result', 'local')
const loadingStore = new Store(false, 'sp-loading', 'local')
const errorStore = new Store('', 'sp-error', 'local')
const showHistoryStore = new Store(false, 'sp-showhistory', 'local')
const historyStore = new Store<HistoryEntry[]>([], 'sp-history-ui', 'local')
const copiedStore = new Store(false, 'sp-copied', 'local')

export class App extends Component {
    // Persisted stores
    provider = SidePanelProviderStore.use()
    from = SidePanelFromStore.use()
    to = SidePanelToStore.use()
    theme = SidePanelThemeStore.use()

    // Local stores
    result = resultStore.use()
    loading = loadingStore.use()
    error = errorStore.use()
    showHistory = showHistoryStore.use()
    history = historyStore.use()
    copied = copiedStore.use()

    // Plain property — no need to trigger re-render on every keystroke
    private inputText = ''
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    // Track focused element to restore focus after re-render
    private focusedId: string | null = null
    // Sequence counter — incremented on each new translate call to cancel stale responses
    private translateSeq = 0

    update() {
        // Capture focus before re-render
        const active = document.activeElement as HTMLElement | null
        this.focusedId = active?.id ?? null

        super.update()

        // Restore textarea value and focus after re-render
        requestAnimationFrame(() => {
            const ta = document.getElementById('sp-input') as HTMLTextAreaElement | null
            if (ta) ta.value = this.inputText

            if (this.focusedId) {
                const el = document.getElementById(this.focusedId)
                if (el) el.focus()
            }

            // Apply theme class to document root
            this.applyTheme(this.theme.state as string)
        })
    }

    private applyTheme(theme: string) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }

    private ensureKnownProvider() {
        if (!isKnownProvider(this.provider.state)) {
            this.provider.setState(DEFAULT_PROVIDER)
        }
    }

    didMount(): void {
        const update = (newState: unknown, prevState: unknown) => {
            if (newState !== prevState) this.update()
        }
        this.provider.subscribe(update)
        this.from.subscribe(update)
        this.to.subscribe(update)
        this.result.subscribe(update)
        this.loading.subscribe(update)
        this.error.subscribe(update)
        this.showHistory.subscribe(update)
        this.history.subscribe(update)
        this.theme.subscribe(update)
        this.copied.subscribe(update)
        this.ensureKnownProvider()
        void this.loadHistory()
        // Apply initial theme
        this.applyTheme(this.theme.state as string)
    }

    didUnmount(): void {
        this.provider.cancel()
        this.from.cancel()
        this.to.cancel()
        this.result.cancel()
        this.loading.cancel()
        this.error.cancel()
        this.showHistory.cancel()
        this.history.cancel()
        this.theme.cancel()
        this.copied.cancel()
        this.cancelTranslate()
    }

    private async loadHistory() {
        const data = await chrome.storage.local.get([HISTORY_KEY])
        historyStore.setState((data[HISTORY_KEY] as HistoryEntry[]) ?? [])
    }

    private async saveHistory(list: HistoryEntry[]) {
        await chrome.storage.local.set({[HISTORY_KEY]: list})
    }

    private cancelTranslate() {
        this.translateSeq++
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        loadingStore.setState(false)
    }

    private onInput(value: string) {
        this.inputText = value
        // Cancel in-flight translation immediately
        this.cancelTranslate()
        if (!value.trim()) {
            resultStore.setState('')
            errorStore.setState('')
            return
        }
        this.debounceTimer = setTimeout(() => void this.doTranslate(), 1500)
    }

    private async doTranslate() {
        const text = this.inputText.trim()
        if (!text) {
            resultStore.setState('')
            errorStore.setState('')
            return
        }
        const seq = ++this.translateSeq
        loadingStore.setState(true)
        errorStore.setState('')
        const provider = normalizeProvider(this.provider.state)
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'SIDEPANEL_TRANSLATE',
                text,
                provider,
                from: this.from.state,
                to: this.to.state,
            }) as {ok: boolean; translatedText?: string; error?: string}

            if (seq !== this.translateSeq) return

            if (response.ok && response.translatedText) {
                const entry: HistoryEntry = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    provider,
                    from: this.from.state,
                    to: this.to.state,
                    source: text,
                    result: response.translatedText,
                    timestamp: Date.now(),
                }
                // Remove duplicates (same provider + language pair + source text)
                const deduplicated = this.history.state.filter(
                    e => !(e.provider === entry.provider && e.from === entry.from && e.to === entry.to && e.source === entry.source)
                )
                const newHistory = [entry, ...deduplicated].slice(0, HISTORY_LIMIT)
                await this.saveHistory(newHistory)
                historyStore.setState(newHistory)
                resultStore.setState(response.translatedText)
            } else {
                errorStore.setState(response.error ?? 'Translation failed')
            }
        } catch (e) {
            if (seq !== this.translateSeq) return
            errorStore.setState(e instanceof Error ? e.message : String(e))
        } finally {
            if (seq === this.translateSeq) loadingStore.setState(false)
        }
    }

    private swapLanguages() {
        const prevFrom = this.from.state
        const prevTo = this.to.state
        this.from.setState(prevTo)
        this.to.setState(prevFrom === 'auto' ? getFallbackTargetLanguage(prevTo) : prevFrom)
        void this.doTranslate()
    }

    private onChangeFrom(event: Event) {
        const nextFrom = (event.target as HTMLSelectElement).value
        const prevFrom = this.from.state
        const prevTo = this.to.state
        this.from.setState(nextFrom)
        if (nextFrom === prevTo) {
            this.to.setState(prevFrom === 'auto' ? getFallbackTargetLanguage(nextFrom) : prevFrom)
        }
        void this.doTranslate()
    }

    private onChangeTo(event: Event) {
        const nextTo = (event.target as HTMLSelectElement).value
        const prevFrom = this.from.state
        const prevTo = this.to.state
        this.to.setState(nextTo)
        if (nextTo === prevFrom) this.from.setState(prevTo)
        void this.doTranslate()
    }

    private translateNow() {
        this.cancelTranslate()
        void this.doTranslate()
    }

    private copyResult() {
        if (!this.result.state) return
        void navigator.clipboard.writeText(this.result.state).then(() => {
            copiedStore.setState(true)
            setTimeout(() => copiedStore.setState(false), 1500)
        })
    }

    private clear() {
        this.cancelTranslate()
        this.inputText = ''
        resultStore.setState('')
        errorStore.setState('')
        const ta = document.querySelector<HTMLTextAreaElement>('#sp-input')
        if (ta) ta.value = ''
    }

    private clearHistory() {
        void chrome.storage.local.remove(HISTORY_KEY).then(() => historyStore.setState([]))
    }

    private deleteEntry(id: string) {
        const newHistory = (this.history.state as HistoryEntry[]).filter(e => e.id !== id)
        void this.saveHistory(newHistory)
        historyStore.setState(newHistory)
    }

    private toggleTheme() {
        const next = (this.theme.state as string) === 'dark' ? 'light' : 'dark'
        SidePanelThemeStore.setState(next)
        this.applyTheme(next)
    }

    private formatTime(ts: number): string {
        const d = new Date(ts)
        return d.toLocaleDateString([], {month: 'short', day: 'numeric'}) + ' ' +
            d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
    }

    private loadEntry(entry: HistoryEntry) {
        this.inputText = entry.source
        const ta = document.querySelector<HTMLTextAreaElement>('#sp-input')
        if (ta) ta.value = entry.source
        resultStore.setState(entry.result)
        errorStore.setState('')
    }

    render() {
        const from = this.from.state as SourceLangCode
        const to = this.to.state as TargetLangCode
        const result = this.result.state as string
        const loading = this.loading.state as boolean
        const error = this.error.state as string
        const showHistory = this.showHistory.state as boolean
        const history = this.history.state as HistoryEntry[]
        const isDark = (this.theme.state as string) === 'dark'
        const copied = this.copied.state as boolean
        const provider = normalizeProvider(this.provider.state)

        const selectClass = 'flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-6 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50'
        const btnSecondary = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-40'
        const spinnerClass = 'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent'

        return (
            <div class="h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 flex flex-col gap-3 text-sm overflow-hidden">

                {/* Provider + languages + theme toggle */}
                <section class="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 flex flex-col gap-2 flex-shrink-0">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide flex-1">Translator</span>
                        <button
                            onclick={() => this.toggleTheme()}
                            class="h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition"
                            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                        >
                            {isDark
                                ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                                : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            }
                        </button>
                    </div>

                    <select
                        class={selectClass}
                        onchange={({target}: {target: HTMLSelectElement}) => this.provider.setState(target.value)}
                    >
                        {TRANSLATION_PROVIDERS.map(p =>
                            p === provider
                                ? <option value={p} selected>{p}</option>
                                : <option value={p}>{p}</option>
                        )}
                    </select>

                    <div class="flex items-center gap-2">
                        <select class={selectClass} onchange={this.onChangeFrom.bind(this)}>
                            {SOURCE_LANGS.map(l =>
                                l === from
                                    ? <option value={l} selected>{LANG_LABELS[l]}</option>
                                    : <option value={l}>{LANG_LABELS[l]}</option>
                            )}
                        </select>

                        <button
                            onclick={() => this.swapLanguages()}
                            class="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition"
                            title="Swap languages"
                        >
                            ⇄
                        </button>

                        <select class={selectClass} onchange={this.onChangeTo.bind(this)}>
                            {TARGET_LANGS.map(l =>
                                l === to
                                    ? <option value={l} selected>{LANG_LABELS[l]}</option>
                                    : <option value={l}>{LANG_LABELS[l]}</option>
                            )}
                        </select>
                    </div>
                </section>

                {/* Input — grows to fill half the remaining space */}
                <textarea
                    id="sp-input"
                    class="flex-1 min-h-0 w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 overflow-y-auto"
                    placeholder="Enter text to translate..."
                    oninput={({target}: {target: HTMLTextAreaElement}) => this.onInput(target.value)}
                />

                {/* Buttons */}
                <div class="flex gap-2 flex-shrink-0">
                    <button
                        onclick={() => loading ? this.cancelTranslate() : this.translateNow()}
                        class={`flex-1 rounded-lg text-white px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${loading ? 'bg-red-500 hover:bg-red-400' : 'bg-blue-600 hover:bg-blue-500'}`}
                    >
                        {loading ? 'Cancel' : 'Translate'}
                    </button>
                    <button
                        onclick={() => this.copyResult()}
                        class={`${btnSecondary} ${!result ? 'opacity-40 cursor-not-allowed' : ''} ${copied ? 'text-green-500 dark:text-green-400 border-green-400 dark:border-green-500' : ''}`}
                    >
                        {copied ? '✓ Copied' : 'Copy'}
                    </button>
                    <button onclick={() => this.clear()} class={btnSecondary}>
                        Clear
                    </button>
                </div>

                {/* Output — grows to fill remaining space */}
                <div class="flex-1 min-h-0 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm whitespace-pre-wrap overflow-y-auto">
                    {error
                        ? <span class="text-red-500 dark:text-red-400">{error}</span>
                        : loading
                            ? <span class="inline-flex items-center gap-2 text-blue-500 dark:text-blue-400">
                                <span class={spinnerClass}></span>
                                <span>Please wait, translating...</span>
                            </span>
                        : result
                            ? <span class="text-slate-800 dark:text-slate-200">{result}</span>
                            : <span class="text-slate-400 dark:text-slate-500">Translation will appear here…</span>
                    }
                </div>

                {/* History header */}
                <div class="flex items-center gap-2 flex-shrink-0">
                    <button
                        onclick={() => showHistoryStore.setState(!showHistory)}
                        class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                    >
                        <span>{showHistory ? '▾' : '▸'}</span>
                        <span>History ({history.length})</span>
                    </button>
                    {history.length > 0 && (
                        <button
                            onclick={() => this.clearHistory()}
                            class="text-xs text-red-400 hover:text-red-500 transition ml-1"
                            title="Clear history"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {/* History list */}
                {showHistory && (
                    <div class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1 flex-shrink-0">
                        {history.length === 0
                            ? <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No history yet</p>
                            : history.map(entry => (
                                <div
                                    class="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-2.5 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition"
                                    onclick={() => this.loadEntry(entry)}
                                >
                                    <div class="flex items-center gap-2 mb-1.5">
                                        <span class="text-xs font-semibold text-blue-500 dark:text-blue-400">{entry.provider}</span>
                                        <span class="text-xs text-slate-400 dark:text-slate-500">
                                            {LANG_LABELS[entry.from as LangCode] ?? entry.from} → {LANG_LABELS[entry.to as LangCode] ?? entry.to}
                                        </span>
                                        <span class="text-xs text-slate-400 dark:text-slate-500 flex-1 text-right">{this.formatTime(entry.timestamp)}</span>
                                        <button
                                            onclick={(e: MouseEvent) => { e.stopPropagation(); this.deleteEntry(entry.id) }}
                                            class="flex-shrink-0 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-400 transition leading-none"
                                            title="Delete"
                                        >×</button>
                                    </div>
                                    <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{entry.source}</p>
                                    <p class="text-xs text-slate-800 dark:text-slate-200 truncate font-medium">{entry.result}</p>
                                </div>
                            ))
                        }
                    </div>
                )}
            </div>
        )
    }
}
