/**
 * vue-template-compiler 未随包提供 TS 类型，这里按需声明最小类型面。
 * 字段以 Vue 2.6.14 实际行为为准（已用探针脚本逐项验证）。
 */
declare module 'vue-template-compiler' {
  export interface SFCBlock {
    type: string
    content: string
    start: number
    end: number
    attrs: Record<string, string>
  }

  export interface SFCDescriptor {
    template: SFCBlock | null
    script: SFCBlock | null
    styles: SFCBlock[]
  }

  /** 原始属性（名字保留前缀写法，如 ':class'；start/end 含引号，end 指向闭引号之后） */
  export interface RawAttr {
    name: string
    value: string
    start: number
    end: number
  }

  export interface AstElement {
    type: number
    tag?: string
    /** 节点在模板内的偏移（outputSourceRange 时存在），start 指向 '<' */
    start?: number
    end?: number
    children?: AstElement[]
    /** v-if/v-else-if/v-else 链：首元素是自身，其后是各 else 分支（独立节点，不在 children 里） */
    ifConditions?: Array<{ exp?: string; block: AstElement }>
    /** <component :is="..."> 的表达式；undefined 表示非动态组件 */
    component?: string
    attrs?: Array<{ name: string; value: string; dynamic?: boolean; start?: number; end?: number }>
    attrsList?: RawAttr[]
    rawAttrsMap?: Record<string, RawAttr>
    staticClass?: string
    classBinding?: string
    for?: string
    key?: string
    if?: string
  }

  export interface CompiledResult {
    ast?: AstElement
    render?: string
    staticRenderFns?: string[]
    errors?: Array<string | Error>
    tips?: string[]
  }

  export function parseComponent(
    source: string,
    options?: { deindent?: boolean },
  ): SFCDescriptor

  export function compile(
    template: string,
    options?: {
      outputSourceRange?: boolean
      warn?: (msg: string) => void
      [key: string]: unknown
    },
  ): CompiledResult
}
