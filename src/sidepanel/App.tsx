import {Component, Store} from 'nano-jsx'
import {SidePanelFromStore, SidePanelProviderStore, SidePanelToStore} from '../store.ts'

const PROVIDERS = ['DeepL', 'Google', 'LibreTranslate', 'Lingvanex', 'Lara', 'MyMemory', 'OpenAI (Ollama)']

const LANGS = ['en', 'ru', 'ua', 'de', 'fr'] as const
type LangCode = typeof LANGS[number]

const LANG_LABELS: Record<LangCode, string> = {
    en: 'English',
    ru: 'Russian',
    ua: 'Ukrainian',
    de: 'German',
    fr: 'French',
}

const HISTORY_KEY = 'sidepanel_history'
const HISTORY_LIMIT = 100

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

export class App extends Component {
    // Persisted stores
    provider = SidePanelProviderStore.use()
    from = SidePanelFromStore.use()
    to = SidePanelToStore.use()

    // Local stores
    result = resultStore.use()
    loading = loadingStore.use()
    error = errorStore.use()
    showHistory = showHistoryStore.use()
    history = historyStore.use()

    // Plain property — no need to trigger re-render on every keystroke
    private inputText = ''
    private debounceTimer: ReturnType<typeof setTimeout> | null = null

    update() {
        super.update()
        // Restore textarea value after re-render since replacing the DOM node resets it
        requestAnimationFrame(() => {
            const ta = document.getElementById('sp-input') as HTMLTextAreaElement | null
            if (ta) ta.value = this.inputText
        })
    }

    didMount(): any {
        const update = (n: any, p: any) => { if (n !== p) this.update() }
        this.provider.subscribe(update)
        this.from.subscribe(update)
        this.to.subscribe(update)
        this.result.subscribe(update)
        this.loading.subscribe(update)
        this.error.subscribe(update)
        this.showHistory.subscribe(update)
        this.history.subscribe(update)
        void this.loadHistory()
    }

    didUnmount(): any {
        this.provider.cancel()
        this.from.cancel()
        this.to.cancel()
        this.result.cancel()
        this.loading.cancel()
        this.error.cancel()
        this.showHistory.cancel()
        this.history.cancel()
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
    }

    private async loadHistory() {
        const data = await chrome.storage.local.get([HISTORY_KEY])
        historyStore.setState((data[HISTORY_KEY] as HistoryEntry[]) ?? [])
    }

    private async saveHistory(list: HistoryEntry[]) {
        await chrome.storage.local.set({[HISTORY_KEY]: list})
    }

    private onInput(value: string) {
        this.inputText = value
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        if (!value.trim()) {
            resultStore.setState('')
            errorStore.setState('')
            return
        }
        this.debounceTimer = setTimeout(() => void this.doTranslate(), 500)
    }

    private async doTranslate() {
        const text = this.inputText
        if (!text.trim()) {
            resultStore.setState('')
            errorStore.setState('')
            return
        }
        loadingStore.setState(true)
        errorStore.setState('')
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'SIDEPANEL_TRANSLATE',
                text,
                provider: this.provider.state,
                from: this.from.state,
                to: this.to.state,
            }) as {ok: boolean; translatedText?: string; error?: string}

            if (response.ok && response.translatedText) {
                const entry: HistoryEntry = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    provider: this.provider.state,
                    from: this.from.state,
                    to: this.to.state,
                    source: text,
                    result: response.translatedText,
                    timestamp: Date.now(),
                }
                const newHistory = [entry, ...this.history.state].slice(0, HISTORY_LIMIT)
                await this.saveHistory(newHistory)
                historyStore.setState(newHistory)
                resultStore.setState(response.translatedText)
            } else {
                errorStore.setState(response.error ?? 'Translation failed')
            }
        } catch (e) {
            errorStore.setState(e instanceof Error ? e.message : String(e))
        } finally {
            loadingStore.setState(false)
        }
    }

    private swapLanguages() {
        const prevFrom = this.from.state
        this.from.setState(this.to.state)
        this.to.setState(prevFrom)
    }

    private onChangeFrom(event: Event) {
        const nextFrom = (event.target as HTMLSelectElement).value
        const prevFrom = this.from.state
        const prevTo = this.to.state
        this.from.setState(nextFrom)
        if (nextFrom === prevTo) this.to.setState(prevFrom)
    }

    private onChangeTo(event: Event) {
        const nextTo = (event.target as HTMLSelectElement).value
        const prevFrom = this.from.state
        const prevTo = this.to.state
        this.to.setState(nextTo)
        if (nextTo === prevFrom) this.from.setState(prevTo)
    }

    private translateNow() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        void this.doTranslate()
    }

    private copyResult() {
        if (this.result.state) void navigator.clipboard.writeText(this.result.state)
    }

    private clear() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.inputText = ''
        resultStore.setState('')
        errorStore.setState('')
        // clear the textarea DOM element directly
        const ta = document.querySelector<HTMLTextAreaElement>('#sp-input')
        if (ta) ta.value = ''
    }

    private clearHistory() {
        void chrome.storage.local.remove(HISTORY_KEY).then(() => historyStore.setState([]))
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
        const from = this.from.state as LangCode
        const to = this.to.state as LangCode
        const result = this.result.state as string
        const loading = this.loading.state as boolean
        const error = this.error.state as string
        const showHistory = this.showHistory.state as boolean
        const history = this.history.state as HistoryEntry[]

        const selectClass = 'flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50'
        const btnSecondary = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-40'

        return (
            <div class="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 flex flex-col gap-3 text-sm">

                {/* Provider + languages section */}
                <section class="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 flex flex-col gap-2">
                    <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Translator</span>

                    <select
                        class={selectClass}
                        onchange={({target}: {target: HTMLSelectElement}) => this.provider.setState(target.value)}
                    >
                        {PROVIDERS.map(p =>
                            p === this.provider.state
                                ? <option value={p} selected>{p}</option>
                                : <option value={p}>{p}</option>
                        )}
                    </select>

                    <div class="flex items-center gap-2">
                        <select class={selectClass} onchange={this.onChangeFrom.bind(this)}>
                            {LANGS.map(l =>
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
                            {LANGS.map(l =>
                                l === to
                                    ? <option value={l} selected>{LANG_LABELS[l]}</option>
                                    : <option value={l}>{LANG_LABELS[l]}</option>
                            )}
                        </select>
                    </div>
                </section>

                {/* Input */}
                <textarea
                    id="sp-input"
                    class="w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-32 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                    placeholder="Enter text to translate..."
                    oninput={({target}: {target: HTMLTextAreaElement}) => this.onInput(target.value)}
                />

                {/* Buttons */}
                <div class="flex gap-2">
                    <button
                        onclick={() => { if (!loading) this.translateNow() }}
                        class={`flex-1 rounded-lg text-white px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${loading ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
                    >
                        {loading ? 'Translating…' : 'Translate'}
                    </button>
                    <button
                        onclick={() => this.copyResult()}
                        class={`${btnSecondary} ${!result ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        Copy
                    </button>
                    <button onclick={() => this.clear()} class={btnSecondary}>
                        Clear
                    </button>
                </div>

                {/* Output */}
                <div class="min-h-32 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm whitespace-pre-wrap">
                    {error
                        ? <span class="text-red-500 dark:text-red-400">{error}</span>
                        : result
                            ? <span class="text-slate-800 dark:text-slate-200">{result}</span>
                            : <span class="text-slate-400 dark:text-slate-500">Translation will appear here…</span>
                    }
                </div>

                {/* History header */}
                <div class="flex items-center gap-2">
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
                    <div class="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                        {history.length === 0
                            ? <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No history yet</p>
                            : history.map(entry => (
                                <div
                                    class="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-2.5 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition"
                                    onclick={() => this.loadEntry(entry)}
                                >
                                    <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                        <span class="text-xs font-semibold text-blue-500 dark:text-blue-400">{entry.provider}</span>
                                        <span class="text-xs text-slate-400 dark:text-slate-500">
                                            {LANG_LABELS[entry.from as LangCode] ?? entry.from} → {LANG_LABELS[entry.to as LangCode] ?? entry.to}
                                        </span>
                                        <span class="text-xs text-slate-400 dark:text-slate-500">{this.formatTime(entry.timestamp)}</span>
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
