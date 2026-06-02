import {Component, type JsxChild} from '#mini-jsx'
import {LibreKeyStore, LibreUrlStore} from "../../store.ts";



export class LibreTranslateSettings extends Component {
    libreUrl = LibreUrlStore.use()
    libreKey = LibreKeyStore.use()

    onChangeUrl(event: Event) {
        this.libreUrl.setState((event.target as HTMLInputElement).value)
    }

    onChangeKey(event: Event) {
        this.libreKey.setState((event.target as HTMLInputElement).value)
    }

    render(_update?: unknown): JsxChild {

        // "https://libretranslate.com/*",
        // "https://translate.argosopentech.com/*",
        return <>
            <label class="grid gap-1">
                <span class="text-slate-500 dark:text-slate-300">URL</span>
                <input value={this.libreUrl.state} oninput={this.onChangeUrl.bind(this)} type="text"
                       class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100"/>
            </label>
            <label class="grid gap-1">
                <span class="text-slate-500 dark:text-slate-300">API key (optional)</span>
                <input value={this.libreKey.state} oninput={this.onChangeKey.bind(this)} type="password"
                       class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100"/>
            </label>
        </>
    }
}
