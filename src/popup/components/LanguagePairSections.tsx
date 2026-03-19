import {Component} from 'nano-jsx'

type Store = {
    readonly state: any
    setState: (newState: any) => void
    subscribe: (fnc: (newState: any, prevState: any) => void) => void
    cancel: () => void
}

type LanguagePairSectionProps = {
    title: string
    fromStore: Store,
    toStore: Store
}

const languages = ['en', 'ru', 'ua', 'de', 'fr']

export class LanguagePairSection extends Component<LanguagePairSectionProps> {
    onChangeFrom(event: Event) {
        const nextFrom = (event.target as HTMLSelectElement).value
        const prevFrom = this.props.fromStore.state
        const prevTo = this.props.toStore.state

        this.props.fromStore.setState(nextFrom)
        if (nextFrom == prevTo) {
            this.props.toStore.setState(prevFrom)
            this.update()
        }
    }

    onChangeTo(event: Event) {
        const nextTo = (event.target as HTMLSelectElement).value
        const prevFrom = this.props.fromStore.state
        const prevTo = this.props.toStore.state

        this.props.toStore.setState(nextTo)
        if (nextTo == prevFrom) {
            this.props.fromStore.setState(prevTo)
            this.update()
        }
    }

    render(): HTMLElement | void {
        const {title, fromStore, toStore} = this.props

        return (
            <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 p-3">
                <p class="mb-2 text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-400">{title}</p>
                <div class="grid grid-cols-2 gap-2">
                    <select onchange={this.onChangeFrom.bind(this)}
                            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100">
                        {languages.map(language => {
                            if (language == fromStore.state) {
                                return <option value={language} selected>{language}</option>
                            }
                            return <option value={language}>{language}</option>
                        })}
                    </select>
                    <select onchange={this.onChangeTo.bind(this)}
                            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-slate-900 dark:text-slate-100">
                        {languages.map(language => {
                            if (language == toStore.state) {
                                return <option value={language} selected>{language}</option>
                            }
                            return <option value={language}>{language}</option>
                        })}
                    </select>
                </div>
            </div>
        )
    }
}
