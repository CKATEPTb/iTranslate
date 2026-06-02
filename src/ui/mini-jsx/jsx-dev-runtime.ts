import type {JsxElement} from './runtime.ts'
import {jsx} from './runtime.ts'
export {Fragment} from './runtime.ts'

export function jsxDEV(type: unknown, props: Record<string, unknown> | null): JsxElement {
  return jsx(type, props)
}

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
