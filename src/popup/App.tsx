import {Component, type JsxElement} from '#mini-jsx'
import {DeepLSettings} from "./providers/DeepLSettings.tsx";
import {GoogleSettings} from "./providers/GoogleSettings.tsx";
import {LibreTranslateSettings} from "./providers/LibreTranslateSettings.tsx";
import {LingvanexSettings} from "./providers/LingvanexSettings.tsx";
import {LaraSettings} from "./providers/LaraSettings.tsx";
import {MyMemorySettings} from "./providers/MyMemorySettings.tsx";
import {OpenAISettings} from "./providers/OpenAISettings.tsx";
import {
    DeeplKeyStore,
    LibreKeyStore,
    PopupThemeStore,
    ProviderStore,
    TranslateInputFromStore,
    TranslateInputToStore,
    TranslateSelectFromStore,
    TranslateSelectToStore
} from "../store.ts";
import {LanguagePairSection} from "./components/LanguagePairSections.tsx";
import {
    hasPageTranslationRules,
    PageTranslationError,
    PageTranslationRulesPanel,
    PageTranslationSupportBadge,
    PageTranslationSupportText,
    type PageTranslationRuleAction,
} from './components/PageTranslationControls.tsx'
import {
    DEFAULT_PROVIDER,
    getPageTranslationSupport,
    isKnownProvider,
    normalizeProvider,
    TRANSLATION_PROVIDERS
} from '../providers.ts'

type ChromeWithSidePanel = typeof chrome & {
    sidePanel: {
        open: (options: {windowId: number}) => Promise<void>
    }
}

type PageTranslationResponse = {
    ok: boolean
    enabled?: boolean
    disabledBySite?: boolean
    hostname?: string
    never?: boolean
    alwaysFrom?: string[]
    error?: string
}

type PageTranslationMessage =
    | { type: 'PAGE_TRANSLATION_GET_ACTIVE' }
    | { type: 'PAGE_TRANSLATION_CLEAR_SITE_PREFERENCE'; hostname: string; action: 'never' | 'always-from'; language?: string }

const PAGE_TRANSLATION_RESPONSE_TIMEOUT_MS = 4000

const providerSettings = new Map<string, () => JsxElement>()
providerSettings.set('DeepL', () => <DeepLSettings/>)
providerSettings.set('Google', () => <GoogleSettings/>)
providerSettings.set('LibreTranslate', () => <LibreTranslateSettings/>)
providerSettings.set('Lingvanex', () => <LingvanexSettings/>)
providerSettings.set('Lara', () => <LaraSettings/>)
providerSettings.set('MyMemory', () => <MyMemorySettings/>)
providerSettings.set('OpenAI (Ollama)', () => <OpenAISettings/>)

export class App extends Component {
    provider = ProviderStore.use()
    translateSelectFrom = TranslateSelectFromStore.use()
    translateSelectTo = TranslateSelectToStore.use()
    translateInputFrom = TranslateInputFromStore.use()
    translateInputTo = TranslateInputToStore.use()
    theme = PopupThemeStore.use()
    deeplKey = DeeplKeyStore.use()
    libreKey = LibreKeyStore.use()
    private pageTranslationHostname = ''
    private pageTranslationNever = false
    private pageTranslationAlwaysFrom: string[] = []
    private pageTranslationRulesOpen = false
    private pageTranslationRulesBusy = false
    private pageTranslationError = ''

    private applyTheme(theme: string) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
        // Notify content scripts so tooltip can update
        void chrome.storage.local.set({popup_theme: theme})
    }

    private toggleTheme() {
        const next = (this.theme.state as string) === 'dark' ? 'light' : 'dark'
        PopupThemeStore.setState(next)
        this.applyTheme(next)
    }

    private togglePageTranslationRules() {
        this.pageTranslationRulesOpen = !this.pageTranslationRulesOpen
        if (this.pageTranslationRulesOpen) {
            void this.refreshPageTranslationState()
        }
        this.update()
    }

    private async openSidePanel() {
        const currentWindow = await chrome.windows.getCurrent()
        if (currentWindow.id == null) return

        await (chrome as ChromeWithSidePanel).sidePanel.open({windowId: currentWindow.id})
        window.close()
    }

    private sendPageTranslationMessage(message: PageTranslationMessage): Promise<PageTranslationResponse> {
        return new Promise(resolve => {
            let settled = false
            let timeoutId: number | undefined
            const finish = (response: PageTranslationResponse) => {
                if (settled) return
                settled = true
                if (timeoutId !== undefined) {
                    window.clearTimeout(timeoutId)
                }
                resolve(response)
            }
            timeoutId = window.setTimeout(() => {
                finish({ok: false, error: 'Timed out waiting for extension background'})
            }, PAGE_TRANSLATION_RESPONSE_TIMEOUT_MS)

            try {
                chrome.runtime.sendMessage(message, (response?: PageTranslationResponse) => {
                    const error = chrome.runtime.lastError
                    if (error) {
                        finish({ok: false, error: error.message})
                        return
                    }
                    finish(response ?? {ok: false, error: 'No response from extension background'})
                })
            } catch (error) {
                finish({
                    ok: false,
                    error: error instanceof Error ? error.message : 'Failed to contact extension background'
                })
            }
        })
    }

    private async refreshPageTranslationState() {
        const response = await this.sendPageTranslationMessage({type: 'PAGE_TRANSLATION_GET_ACTIVE'})
        if (response.ok) {
            this.pageTranslationHostname = response.hostname ?? ''
            this.pageTranslationNever = response.never === true
            this.pageTranslationAlwaysFrom = response.alwaysFrom ?? []
            this.pageTranslationError = ''
        }
        this.update()
    }

    private async clearPageTranslationRule(action: PageTranslationRuleAction, language?: string) {
        if (this.pageTranslationRulesBusy || (action === 'never' && !this.pageTranslationHostname)) return

        this.pageTranslationRulesBusy = true
        this.pageTranslationError = ''
        this.update()
        try {
            const response = await this.sendPageTranslationMessage({
                type: 'PAGE_TRANSLATION_CLEAR_SITE_PREFERENCE',
                hostname: this.pageTranslationHostname,
                action,
                language,
            })
            if (response.ok) {
                this.pageTranslationHostname = response.hostname ?? this.pageTranslationHostname
                this.pageTranslationNever = response.never === true
                this.pageTranslationAlwaysFrom = response.alwaysFrom ?? []
            } else {
                this.pageTranslationError = response.error ?? 'Failed to update page translation rules'
            }
        } finally {
            this.pageTranslationRulesBusy = false
            this.update()
        }
    }

    private setProvider(value: string) {
        const provider = normalizeProvider(value)
        this.provider.setState(provider)

        this.pageTranslationError = ''
        void this.refreshPageTranslationState()
    }

    private ensureKnownProvider() {
        if (!isKnownProvider(this.provider.state)) {
            this.provider.setState(DEFAULT_PROVIDER)
        }
    }

    private getPageTranslationSettings(): Record<string, unknown> {
        return {
            'deepl-key': this.deeplKey.state,
            'libre-key': this.libreKey.state,
        }
    }

    didMount(): void {
        const update = (newState: unknown, prevState: unknown) => {
            if (newState !== prevState) this.update()
        }
        this.provider.subscribe(update)
        this.theme.subscribe(update)
        this.deeplKey.subscribe(update)
        this.libreKey.subscribe(update)
        this.ensureKnownProvider()
        this.applyTheme(this.theme.state as string)
        void this.refreshPageTranslationState()
    }

    didUnmount(): void {
        this.provider.cancel()
        this.theme.cancel()
        this.deeplKey.cancel()
        this.libreKey.cancel()
    }

    render() {
        const isDark = (this.theme.state as string) === 'dark'
        const provider = normalizeProvider(this.provider.state)
        const pageTranslationSupport = getPageTranslationSupport(provider, this.getPageTranslationSettings())
        const pageTranslationHasRules = hasPageTranslationRules(
            this.pageTranslationHostname,
            this.pageTranslationNever,
            this.pageTranslationAlwaysFrom,
        )
        const clearPageTranslationRule = (action: PageTranslationRuleAction, language?: string) => {
            void this.clearPageTranslationRule(action, language)
        }

        const iconBtn = 'relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-200 transition hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500/60'
        const activeIconBtn = `${iconBtn} border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40`

        return (
            <main class="w-95 p-4 text-slate-900 dark:text-slate-100 bg-linear-to-br from-slate-100 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
                <div class="rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/70 p-4 shadow-xl shadow-black/10 dark:shadow-black/40">
                    <div class="flex items-center justify-between gap-2">
                        <h1 class="text-lg font-bold tracking-tight">iTranslate</h1>
                        <div class="flex items-center gap-2">
                            <button
                                onclick={() => void this.openSidePanel()}
                                class={iconBtn}
                                title="Open side panel"
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                                    <path d="M15 4v16"></path>
                                    <path d="M7 8h4"></path>
                                    <path d="M7 12h4"></path>
                                </svg>
                            </button>
                            <button
                                onclick={() => this.togglePageTranslationRules()}
                                class={this.pageTranslationRulesOpen ? activeIconBtn : iconBtn}
                                title="Page translation rules"
                                aria-label="Page translation rules"
                                aria-expanded={this.pageTranslationRulesOpen ? 'true' : 'false'}
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                    <path d="M4 7h10"></path>
                                    <path d="M18 7h2"></path>
                                    <circle cx="16" cy="7" r="2"></circle>
                                    <path d="M4 17h2"></path>
                                    <path d="M10 17h10"></path>
                                    <circle cx="8" cy="17" r="2"></circle>
                                </svg>
                                {pageTranslationHasRules && (
                                    <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white dark:border-slate-950 bg-blue-500"></span>
                                )}
                            </button>
                            <button
                                onclick={() => this.toggleTheme()}
                                class={iconBtn}
                                title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                            >
                                {isDark
                                    ? <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                                    : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                                }
                            </button>
                            <a
                                href="https://github.com/CKATEPTb/iTranslate?tab=readme-ov-file#how-to-use"
                                target="_blank"
                                rel="noreferrer"
                                title="How to use"
                                class={iconBtn}
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="9"></circle>
                                    <path d="M12 17v-6"></path>
                                    <path d="M12 8h.01"></path>
                                </svg>
                            </a>
                            <a
                                href="https://github.com/CKATEPTb"
                                target="_blank"
                                rel="noreferrer"
                                title="Developer"
                                class={iconBtn}
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.1.82-.26.82-.58v-2.05c-3.34.73-4.04-1.41-4.04-1.41a3.18 3.18 0 0 0-1.34-1.76c-1.09-.75.08-.74.08-.74a2.52 2.52 0 0 1 1.84 1.24 2.57 2.57 0 0 0 3.51 1 2.57 2.57 0 0 1 .76-1.61c-2.67-.3-5.48-1.33-5.48-5.91a4.62 4.62 0 0 1 1.23-3.21 4.3 4.3 0 0 1 .12-3.16s1-.32 3.3 1.22a11.4 11.4 0 0 1 6 0c2.29-1.54 3.29-1.22 3.29-1.22a4.3 4.3 0 0 1 .12 3.16 4.62 4.62 0 0 1 1.23 3.21c0 4.59-2.81 5.61-5.49 5.9a2.88 2.88 0 0 1 .82 2.24v3.31c0 .32.21.69.83.58A12 12 0 0 0 12 .5Z"></path>
                                </svg>
                            </a>
                        </div>
                    </div>

                    <section class="mt-4 grid gap-3 text-xs">
                        {this.pageTranslationRulesOpen && (
                            <PageTranslationRulesPanel
                                hostname={this.pageTranslationHostname}
                                never={this.pageTranslationNever}
                                alwaysFrom={this.pageTranslationAlwaysFrom}
                                busy={this.pageTranslationRulesBusy}
                                onClearRule={clearPageTranslationRule}
                            />
                        )}

                        <label class="grid gap-1.5">
                            <span class="flex items-center justify-between gap-2">
                                <span class="text-slate-500 dark:text-slate-300">Translator</span>
                                <PageTranslationSupportBadge support={pageTranslationSupport}/>
                            </span>
                            <select
                                onchange={({target}: {target: HTMLSelectElement}) => this.setProvider(target.value)}
                                class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-2 pr-6 py-2 text-slate-900 dark:text-slate-100"
                            >
                                {TRANSLATION_PROVIDERS.map(value => {
                                    if (value == provider) {
                                        return <option value={value} selected>{value}</option>
                                    }
                                    return <option value={value}>{value}</option>
                                })}
                            </select>
                            <PageTranslationSupportText support={pageTranslationSupport}/>
                        </label>

                        <LanguagePairSection
                            title="Selected text"
                            fromStore={this.translateSelectFrom}
                            toStore={this.translateSelectTo}
                        />
                        <LanguagePairSection
                            title="Input text"
                            fromStore={this.translateInputFrom}
                            toStore={this.translateInputTo}
                        />

                        <PageTranslationError error={this.pageTranslationError}/>

                        {providerSettings.get(provider)?.()}
                    </section>
                </div>
            </main>
        )
    }
}
