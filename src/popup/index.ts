import '../tailwind.css'
import {render} from 'nano-jsx'
import {App} from './App.tsx'

render(App, document.querySelector<HTMLElement>('#app')!)
