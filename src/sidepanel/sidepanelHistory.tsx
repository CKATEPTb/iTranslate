import {LANG_LABELS, type HistoryEntry, type LangCode} from './sidepanelModel.ts'

type HistoryPanelProps = {
    entries: HistoryEntry[]
    show: boolean
    formatTime(timestamp: number): string
    onClear(): void
    onDelete(id: string): void
    onLoad(entry: HistoryEntry): void
    onToggle(): void
}

export function HistoryPanel({entries, show, formatTime, onClear, onDelete, onLoad, onToggle}: HistoryPanelProps) {
    return (
        <>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button
                    onclick={() => onToggle()}
                    class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                >
                    <span>{show ? 'v' : '>'}</span>
                    <span>History ({entries.length})</span>
                </button>
                {entries.length > 0 && (
                    <button
                        onclick={() => onClear()}
                        class="text-xs text-red-400 hover:text-red-500 transition ml-1"
                        title="Clear history"
                    >
                        Clear
                    </button>
                )}
            </div>

            {show && (
                <div class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1 flex-shrink-0">
                    {entries.length === 0
                        ? <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No history yet</p>
                        : entries.map(entry => (
                            <HistoryCard
                                entry={entry}
                                formatTime={formatTime}
                                onDelete={onDelete}
                                onLoad={onLoad}
                            />
                        ))
                    }
                </div>
            )}
        </>
    )
}

type HistoryCardProps = {
    entry: HistoryEntry
    formatTime(timestamp: number): string
    onDelete(id: string): void
    onLoad(entry: HistoryEntry): void
}

function HistoryCard({entry, formatTime, onDelete, onLoad}: HistoryCardProps) {
    return (
        <div
            class="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 p-2.5 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition"
            onclick={() => onLoad(entry)}
        >
            <div class="flex items-center gap-2 mb-1.5">
                <span class="text-xs font-semibold text-blue-500 dark:text-blue-400">{entry.provider}</span>
                <span class="text-xs text-slate-400 dark:text-slate-500">
                    {LANG_LABELS[entry.from as LangCode] ?? entry.from} {'->'} {LANG_LABELS[entry.to as LangCode] ?? entry.to}
                </span>
                <span class="text-xs text-slate-400 dark:text-slate-500 flex-1 text-right">{formatTime(entry.timestamp)}</span>
                <button
                    onclick={(event: MouseEvent) => {
                        event.stopPropagation()
                        onDelete(entry.id)
                    }}
                    class="flex-shrink-0 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-400 transition leading-none"
                    title="Delete"
                >
                    x
                </button>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{entry.source}</p>
            <p class="text-xs text-slate-800 dark:text-slate-200 truncate font-medium">{entry.result}</p>
        </div>
    )
}
