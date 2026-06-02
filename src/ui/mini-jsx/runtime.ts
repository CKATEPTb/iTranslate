export type JsxChild = void | Node | string | number | boolean | null | undefined | JsxChild[]
export type JsxElement = Node | Node[]

type Props = Record<string, unknown> & {
  children?: JsxChild
}

type StoreListener<T> = (newState: T, prevState: T) => void
type StorageKind = 'local' | 'session' | 'memory'
type ComponentConstructor = new (props: Props) => Component
type FunctionComponent = (props: Props) => JsxChild

export type StoreBinding<T> = {
  readonly state: T
  setState(newState: T): void
  subscribe(listener: StoreListener<T>): void
  cancel(): void
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set(['circle', 'path', 'rect', 'svg'])

export const Fragment = Symbol('mini-jsx.fragment')

export class Store<T = unknown> {
  state: T
  private readonly listeners = new Set<StoreListener<T>>()
  private readonly storage: Storage | null
  private readonly key: string

  constructor(defaultState: T, key = '', storage: StorageKind = 'memory') {
    this.key = key
    this.storage = getStorage(storage)
    this.state = this.readStoredState(defaultState)
  }

  setState(newState: T): void {
    const prevState = this.state
    if (Object.is(newState, prevState)) return

    this.state = newState
    this.writeStoredState(newState)
    for (const listener of this.listeners) {
      listener(newState, prevState)
    }
  }

  subscribe(listener: StoreListener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  use(): StoreBinding<T> {
    const store = this
    const subscriptions = new Set<StoreListener<T>>()

    return {
      get state() {
        return store.state
      },
      setState(newState: T) {
        store.setState(newState)
      },
      subscribe(listener: StoreListener<T>) {
        subscriptions.add(listener)
        store.subscribe(listener)
      },
      cancel() {
        for (const listener of subscriptions) {
          store.listeners.delete(listener)
        }
        subscriptions.clear()
      },
    }
  }

  private readStoredState(defaultState: T): T {
    if (!this.storage || !this.key) return defaultState

    try {
      const raw = this.storage.getItem(this.key)
      if (raw == null) return defaultState

      try {
        return JSON.parse(raw) as T
      } catch {
        return raw as T
      }
    } catch {
      return defaultState
    }
  }

  private writeStoredState(state: T): void {
    if (!this.storage || !this.key) return

    try {
      this.storage.setItem(this.key, JSON.stringify(state))
    } catch {
      // Storage quota/security errors should not break UI state updates.
    }
  }
}

export class Component<ComponentProps extends Record<string, unknown> = Record<string, unknown>> {
  props: ComponentProps
  elements: Node[] = []

  constructor(props?: ComponentProps) {
    this.props = props ?? ({} as ComponentProps)
  }

  willMount(): void {}

  didMount(): void {}

  willUpdate(): void {}

  didUpdate(): void {}

  didUnmount(): void {}

  render(): JsxChild {
    return null
  }

  update(): void {
    const firstElement = this.elements[0]
    const parent = firstElement?.parentNode
    if (!parent) return

    this.willUpdate()
    const nextElements = toNodes(this.render())
    parent.insertBefore(toFragment(nextElements), firstElement)
    for (const element of this.elements) {
      element.parentNode?.removeChild(element)
    }
    this.elements = nextElements
    queueMicrotask(() => this.didUpdate())
  }
}

export function jsx(type: unknown, rawProps: Props | null): JsxElement {
  const props = rawProps ?? {}

  if (type === Fragment) {
    return toNodes(props.children)
  }

  if (typeof type === 'function') {
    return createComponent(type as ComponentConstructor | FunctionComponent, props)
  }

  if (typeof type === 'string') {
    return createDomElement(type, props)
  }

  return []
}

export const jsxs = jsx

export function render(view: unknown, container: HTMLElement): void {
  const nodes = toNodes(typeof view === 'function' ? jsx(view, null) : view)
  container.replaceChildren(toFragment(nodes))
}

function getStorage(kind: StorageKind): Storage | null {
  try {
    if (kind === 'local') return window.localStorage
    if (kind === 'session') return window.sessionStorage
  } catch {
    return null
  }

  return null
}

function createComponent(type: ComponentConstructor | FunctionComponent, props: Props): JsxElement {
  if (isComponentConstructor(type)) {
    const component = new type(props)
    component.willMount()
    component.elements = toNodes(component.render())
    queueMicrotask(() => component.didMount())
    return component.elements
  }

  return toNodes(type(props))
}

function isComponentConstructor(type: ComponentConstructor | FunctionComponent): type is ComponentConstructor {
  return typeof type.prototype?.render === 'function'
}

function createDomElement(tag: string, props: Props): Element {
  const element = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NAMESPACE, tag)
    : document.createElement(tag)

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children') continue
    setProp(element, name, value)
  }

  appendChildren(element, props.children)
  return element
}

function setProp(element: Element, name: string, value: unknown): void {
  if (value == null || value === false) return

  if (name === 'className') {
    element.setAttribute('class', String(value))
    return
  }

  if (name === 'class') {
    element.setAttribute('class', String(value))
    return
  }

  if (name === 'style' && value && typeof value === 'object') {
    Object.assign((element as HTMLElement).style, value)
    return
  }

  if (name.startsWith('on') && typeof value === 'function') {
    element.addEventListener(name.slice(2).toLowerCase(), value as EventListener)
    return
  }

  if (name in element && !name.includes('-')) {
    try {
      const writableElement = element as unknown as Record<string, unknown>
      writableElement[name] = value
    } catch {
      element.setAttribute(name, String(value))
    }
    return
  }

  element.setAttribute(name, value === true ? '' : String(value))
}

function appendChildren(parent: Node, children: JsxChild): void {
  for (const node of toNodes(children)) {
    parent.appendChild(node)
  }
}

function toNodes(value: unknown): Node[] {
  if (value == null || typeof value === 'boolean') return []
  if (value instanceof Node) return [value]
  if (Array.isArray(value)) return value.flatMap(toNodes)

  return [document.createTextNode(String(value))]
}

function toFragment(nodes: Node[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const node of nodes) {
    fragment.appendChild(node)
  }
  return fragment
}
