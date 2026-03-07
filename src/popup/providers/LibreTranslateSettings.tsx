import {Component} from "nano-jsx";
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

    render(_update?: any): HTMLElement | void {

        // "https://libretranslate.com/*",
        // "https://translate.argosopentech.com/*",
        return <>
            <label class="grid gap-1">
                <span class="text-slate-300">URL</span>
                <input value={this.libreUrl.state} oninput={this.onChangeUrl.bind(this)} type="text"
                       class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
            </label>
            <label class="grid gap-1">
                <span class="text-slate-300">API key (optional)</span>
                <input value={this.libreKey.state} oninput={this.onChangeKey.bind(this)} type="password"
                       class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
            </label>
        </>
    }
}