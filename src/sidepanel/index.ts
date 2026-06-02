import '../tailwind.css'
import {render} from '#mini-jsx'
import {App} from './App.tsx'

render(App, document.querySelector<HTMLElement>('#app')!)
