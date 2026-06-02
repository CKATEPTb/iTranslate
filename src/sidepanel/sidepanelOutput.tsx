import {SPINNER_CLASS} from './sidepanelStyles.ts'

type TranslationOutputProps = {
    error: string
    loading: boolean
    result: string
}

export function TranslationOutput({error, loading, result}: TranslationOutputProps) {
    return (
        <div class="flex-1 min-h-0 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-3 text-sm whitespace-pre-wrap overflow-y-auto">
            {error
                ? <span class="text-red-500 dark:text-red-400">{error}</span>
                : loading
                    ? <span class="inline-flex items-center gap-2 text-blue-500 dark:text-blue-400">
                        <span class={SPINNER_CLASS}></span>
                    </span>
                    : result
                        ? <span class="text-slate-800 dark:text-slate-200">{result}</span>
                        : <span class="text-slate-400 dark:text-slate-500">Translation will appear here...</span>
            }
        </div>
    )
}
