import {Component} from "nano-jsx";
import {GoogleKeyStore} from "../../store.ts";


export class GoogleSettings extends Component {
    googleKey = GoogleKeyStore.use()

    onChange(event: Event) {
        this.googleKey.setState((event.target as HTMLInputElement).value)
    }

    render(_update?: any): HTMLElement | void {
        return <label class="grid gap-1">
            <span class="text-slate-300">API key (optional)</span>
            <input value={this.googleKey.state} oninput={this.onChange.bind(this)} type="password"
                   class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
        </label>
    }
}