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
        const fieldClass = "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100"
        const labelClass = "text-slate-500 dark:text-slate-300"
        return <>
            <label class="grid gap-1">
                <span class={labelClass}>URL</span>
                <input value={this.openAIUrl.state} oninput={this.onChangeUrl.bind(this)} type="text" class={fieldClass}/>
            </label>

            <label class="grid gap-1">
                <span class={labelClass}>Model</span>
                <input value={this.openAIModel.state} oninput={this.onChangeModel.bind(this)} type="text" class={fieldClass}/>
            </label>

            <label class="grid gap-1">
                <span class={labelClass}>API key (optional)</span>
                <input value={this.openAIKey.state} oninput={this.onChangeKey.bind(this)} type="password" class={fieldClass}/>
            </label>

            <label class="grid gap-1">
                <span class={labelClass}>System prompt</span>
                <textarea oninput={this.onChangePrompt.bind(this)} rows="4" class={fieldClass}>{this.openAIPrompt.state}</textarea>
                <span class="text-[11px] text-slate-400">Use placeholders: {'{FROM}'} and {'{TO}'}</span>
            </label>
        </>
    }
}
