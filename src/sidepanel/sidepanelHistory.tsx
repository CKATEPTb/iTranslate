import {LANG_LABELS, type HistoryEntry, type LangCode} from './sidepanelModel.ts'
import {ChevronDownIcon, ChevronRightIcon, TrashIcon} from './sidepanelIcons.tsx'

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
            <div class="flex items-center justify-between gap-2 flex-shrink-0">
                <button
                    onclick={() => onToggle()}
                    class="group inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
                    title={show ? 'Hide history' : 'Show history'}
                    aria-label={show ? 'Hide history' : 'Show history'}
                >
                    <span class="flex h-4 w-4 items-center justify-center text-slate-400 transition group-hover:text-blue-500 dark:group-hover:text-blue-400">
                        {show ? <ChevronDownIcon size={13}/> : <ChevronRightIcon size={13}/>}
                    </span>
                    <span class="truncate">History</span>
                    <span class="min-w-4 rounded-full bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {entries.length}
                    </span>
                </button>
                {entries.length > 0 && (
                    <button
                        onclick={() => onClear()}
                        class="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-red-300 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-red-500/60 dark:hover:text-red-400"
                        title="Clear history"
                        aria-label="Clear history"
                    >
                        <TrashIcon size={14}/>
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
                    class="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-transparent text-slate-300 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:text-slate-600 dark:hover:border-red-500/40 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    title="Delete"
                    aria-label="Delete history entry"
                >
                    <TrashIcon size={12}/>
                </button>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{entry.source}</p>
            <p class="text-xs text-slate-800 dark:text-slate-200 truncate font-medium">{entry.result}</p>
        </div>
    )
}
