import {Component, Store} from '#mini-jsx'
import {SidePanelFromStore, SidePanelProviderStore, SidePanelThemeStore, SidePanelToStore} from '../store.ts'
import {DEFAULT_PROVIDER, isKnownProvider, normalizeProvider, TRANSLATION_PROVIDERS} from '../providers.ts'
import {MoonIcon, SunIcon, SwapIcon} from './sidepanelIcons.tsx'
import {HistoryPanel} from './sidepanelHistory.tsx'
import {TranslationOutput} from './sidepanelOutput.tsx'
import {ICON_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SELECT_CLASS} from './sidepanelStyles.ts'
import {
    getFallbackTargetLanguage,
    HISTORY_KEY,
    HISTORY_LIMIT,
    LANG_LABELS,
    SOURCE_LANGS,
    TARGET_LANGS,
    type HistoryEntry,
    type SourceLangCode,
    type TargetLangCode,
} from './sidepanelModel.ts'

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

        return (
            <div class="h-screen min-w-0 max-w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 flex flex-col gap-3 text-sm overflow-hidden">

                {/* Provider + languages + theme toggle */}
                <section class="min-w-0 max-w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 flex flex-col gap-2 flex-shrink-0 overflow-hidden">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide flex-1">Translator</span>
                        <button
                            onclick={() => this.toggleTheme()}
                            class={ICON_BUTTON_CLASS}
                            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                        >
                            {isDark ? <SunIcon/> : <MoonIcon/>}
                        </button>
                    </div>

                    <select
                        class={SELECT_CLASS}
                        onchange={({target}: {target: HTMLSelectElement}) => this.provider.setState(target.value)}
                    >
                        {TRANSLATION_PROVIDERS.map(p =>
                            p === provider
                                ? <option value={p} selected>{p}</option>
                                : <option value={p}>{p}</option>
                        )}
                    </select>

                    <div class="flex min-w-0 items-center gap-2">
                        <select class={SELECT_CLASS} onchange={this.onChangeFrom.bind(this)}>
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
                            <SwapIcon/>
                        </button>

                        <select class={SELECT_CLASS} onchange={this.onChangeTo.bind(this)}>
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
                    class="itranslate-wrap-text flex-1 min-h-0 w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 overflow-y-auto overflow-x-hidden"
                    placeholder="Enter text to translate..."
                    wrap="soft"
                    oninput={({target}: {target: HTMLTextAreaElement}) => this.onInput(target.value)}
                />

                {/* Buttons */}
                <div class="flex min-w-0 gap-2 flex-shrink-0">
                    <button
                        onclick={() => loading ? this.cancelTranslate() : this.translateNow()}
                        class={`flex-1 rounded-lg text-white px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${loading ? 'bg-red-500 hover:bg-red-400' : 'bg-blue-600 hover:bg-blue-500'}`}
                    >
                        {loading ? 'Cancel' : 'Translate'}
                    </button>
                    <button
                        onclick={() => this.copyResult()}
                        class={`${SECONDARY_BUTTON_CLASS} ${!result ? 'opacity-40 cursor-not-allowed' : ''} ${copied ? 'text-green-500 dark:text-green-400 border-green-400 dark:border-green-500' : ''}`}
                    >
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button onclick={() => this.clear()} class={SECONDARY_BUTTON_CLASS}>
                        Clear
                    </button>
                </div>

                <TranslationOutput error={error} loading={loading} result={result}/>

                <HistoryPanel
                    entries={history}
                    show={showHistory}
                    formatTime={this.formatTime.bind(this)}
                    onClear={() => this.clearHistory()}
                    onDelete={id => this.deleteEntry(id)}
                    onLoad={entry => this.loadEntry(entry)}
                    onToggle={() => showHistoryStore.setState(!showHistory)}
                />
            </div>
        )
    }
}
