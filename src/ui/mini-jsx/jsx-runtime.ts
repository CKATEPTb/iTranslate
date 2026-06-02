import type {JsxElement} from './runtime.ts'
export {Fragment, jsx, jsxs} from './runtime.ts'

export namespace JSX {
  export type Element = JsxElement
  export interface ElementClass {
    render: () => unknown
  }
  export interface ElementChildrenAttribute {
    children: unknown
  }
  export interface IntrinsicAttributes {
    children?: unknown
    [key: string]: unknown
  }
  export interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>
  }
}
