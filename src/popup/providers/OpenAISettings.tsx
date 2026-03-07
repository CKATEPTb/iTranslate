import {Component} from "nano-jsx";
import {OpenAIKeyStore, OpenAIModelStore, OpenAIPromptStore, OpenAIURLStore} from "../../store.ts";

export class OpenAISettings extends Component {
    openAIUrl = OpenAIURLStore.use()
    openAIModel = OpenAIModelStore.use()
    openAIKey = OpenAIKeyStore.use()
    openAIPrompt = OpenAIPromptStore.use()

    onChangeUrl(event: Event) {
        this.openAIUrl.setState((event.target as HTMLInputElement).value)
    }

    onChangeModel(event: Event) {
        this.openAIModel.setState((event.target as HTMLInputElement).value)
    }

    onChangeKey(event: Event) {
        this.openAIKey.setState((event.target as HTMLInputElement).value)
    }

    onChangePrompt(event: Event) {
        this.openAIPrompt.setState((event.target as HTMLTextAreaElement).value)
    }

    render(_update?: any): HTMLElement | void {
        return <>
            <label class="grid gap-1">
                <span class="text-slate-300">URL</span>
                <input value={this.openAIUrl.state} oninput={this.onChangeUrl.bind(this)} type="text"
                       class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
            </label>

            <label class="grid gap-1">
                <span class="text-slate-300">Model</span>
                <input value={this.openAIModel.state} oninput={this.onChangeModel.bind(this)} type="text"
                       class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
            </label>

            <label class="grid gap-1">
                <span class="text-slate-300">API key (optional)</span>
                <input value={this.openAIKey.state} oninput={this.onChangeKey.bind(this)} type="password"
                       class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"/>
            </label>

            <label class="grid gap-1">
                <span class="text-slate-300">System prompt</span>
                <textarea oninput={this.onChangePrompt.bind(this)} rows="4"
                          class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2">{this.openAIPrompt.state}</textarea>
                <span class="text-[11px] text-slate-400">Use placeholders: {'{FROM}'} and {'{TO}'}</span>
            </label>
        </>
    }
}
