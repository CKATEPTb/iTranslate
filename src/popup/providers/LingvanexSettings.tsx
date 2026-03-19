import {Component} from "nano-jsx";
import {LingvanexKeyStore} from "../../store.ts";


export class LingvanexSettings extends Component {
    lingvanexKey = LingvanexKeyStore.use()

    onChange(event: Event) {
        this.lingvanexKey.setState((event.target as HTMLInputElement).value)
    }

    render(_update?: any): HTMLElement | void {
        return <label class="grid gap-1">
            <span class="text-slate-500 dark:text-slate-300">API key (optional)</span>
            <input value={this.lingvanexKey.state} oninput={this.onChange.bind(this)} type="password"
                   class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100"/>
        </label>
    }
}