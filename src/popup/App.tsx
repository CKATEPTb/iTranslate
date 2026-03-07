import {Component} from 'nano-jsx'
import {DeepLSettings} from "./providers/DeepLSettings.tsx";
import {GoogleSettings} from "./providers/GoogleSettings.tsx";
import {LibreTranslateSettings} from "./providers/LibreTranslateSettings.tsx";
import {LingvanexSettings} from "./providers/LingvanexSettings.tsx";
import {LaraSettings} from "./providers/LaraSettings.tsx";
import {MyMemorySettings} from "./providers/MyMemorySettings.tsx";
import {OpenAISettings} from "./providers/OpenAISettings.tsx";
import {
    ProviderStore,
    TranslateInputFromStore,
    TranslateInputToStore,
    TranslateSelectFromStore,
    TranslateSelectToStore
} from "../store.ts";
import {LanguagePairSection} from "./components/LanguagePairSections.tsx";

const providers = new Map<string, () => Component>()
providers.set('DeepL', () => <DeepLSettings/>)
providers.set('Google', () => <GoogleSettings/>)
providers.set('LibreTranslate', () => <LibreTranslateSettings/>)
providers.set('Lingvanex', () => <LingvanexSettings/>)
providers.set('Lara', () => <LaraSettings/>)
providers.set('MyMemory', () => <MyMemorySettings/>)
providers.set('OpenAI (Ollama)', () => <OpenAISettings/>)

export class App extends Component {
    provider = ProviderStore.use()
    translateSelectFrom = TranslateSelectFromStore.use()
    translateSelectTo = TranslateSelectToStore.use()
    translateInputFrom = TranslateInputFromStore.use()
    translateInputTo = TranslateInputToStore.use()

    didMount(): any {
        this.provider.subscribe((newState: any, prevState: any) => {
            if (newState !== prevState) this.update()
        })
    }

    didUnmount(): any {
        this.provider.cancel()
    }

    render() {
        return (
            <main class="w-95 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 p-4 text-slate-100">
                <div class="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-xl shadow-black/40">
                    <div class="flex items-center justify-between gap-2">
                        <h1 class="text-lg font-bold tracking-tight">iTranslate</h1>
                        <div class="flex items-center gap-2">
                            <a
                                href="https://github.com/CKATEPTb/iTranslate?tab=readme-ov-file#how-to-use"
                                target="_blank"
                                rel="noreferrer"
                                title="How to use"
                                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200 transition hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500/60"
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
                                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200 transition hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500/60"
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.1.82-.26.82-.58v-2.05c-3.34.73-4.04-1.41-4.04-1.41a3.18 3.18 0 0 0-1.34-1.76c-1.09-.75.08-.74.08-.74a2.52 2.52 0 0 1 1.84 1.24 2.57 2.57 0 0 0 3.51 1 2.57 2.57 0 0 1 .76-1.61c-2.67-.3-5.48-1.33-5.48-5.91a4.62 4.62 0 0 1 1.23-3.21 4.3 4.3 0 0 1 .12-3.16s1-.32 3.3 1.22a11.4 11.4 0 0 1 6 0c2.29-1.54 3.29-1.22 3.29-1.22a4.3 4.3 0 0 1 .12 3.16 4.62 4.62 0 0 1 1.23 3.21c0 4.59-2.81 5.61-5.49 5.9a2.88 2.88 0 0 1 .82 2.24v3.31c0 .32.21.69.83.58A12 12 0 0 0 12 .5Z"></path>
                                </svg>
                            </a>
                        </div>
                    </div>

                    <section class="mt-4 grid gap-3 text-xs">
                        <label class="grid gap-1">
                            <span class="text-slate-300">Translator</span>
                            <select onchange={({target}: {
                                    target: HTMLSelectElement
                                }) => this.provider.setState(target.value)}
                                class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2">
                                {Array.from(providers.keys()).map(value => {
                                    if (value == this.provider.state) {
                                        return <option value={value} selected>{value}</option>
                                    }
                                    return <option value={value}>{value}</option>
                                })}
                            </select>
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

                        {providers.get(this.provider.state)}
                    </section>
                </div>
            </main>
        )
    }
}
