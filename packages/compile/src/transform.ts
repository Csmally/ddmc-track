/**
 * 核心转换：对 .vue 源码做两类模板注入（外科手术式字符串插入，其余字节不动）。
 *
 * 注入①：自定义组件标签（非 uni-app 原生组件）加 :componentIndex="N"
 *        ——同类标签从 0 计数（槽位级标识），每个文件独立计数；
 *          v-if/v-else 分支各自计数；动态组件 <component :is> 跳过；
 *          已注入过（幂等重跑）不再插入。
 * 注入②：组件根元素加 :class="currentTrackClass"（活的绑定，运行时包消费）
 *        ——页面模板根为 page-content 时跳过（该元素由页面路由标识）；
 *          已有动态 :class 时把原表达式包进 [原值, currentTrackClass]；
 *          否则在开标签末尾追加独立 :class（静态 class 与 :class 由 Vue 自动合并）。
 *
 * 定位方式：不依赖编译器的 outputSourceRange——生产构建（NODE_ENV=production）下
 * vue-template-compiler 不输出 range（实测 ast.start 为 undefined），会导致注入全挂。
 * 因此按 AST 遍历序（文档序）在模板文本里顺序扫描各标签位置，与编译环境无关。
 *
 * 已知边界：扫描按 `<tag` 字面匹配（跳过注释区），若模板文本节点/属性值里出现
 * 字面 `<tag` 形式的文本可能误匹配——正常业务模板不会这么写。
 */

import { createRequire } from 'module'
import { COMPONENT_INDEX_ATTR, TRACK_CLASS, TRACK_CLICK_METHOD } from '@ddmc/track-shared'
import type { AstElement, SFCBlock } from 'vue-template-compiler'
import { NATIVE_TAGS } from './native-tags'
import type { CompileOptions } from './options'

/**
 * 模板编译器的最小类型面（vue-template-compiler 或其 fork 均满足）。
 * 不在模块顶层 require 真实编译器：uni-app 会用 module-alias 把
 * 'vue-template-compiler' 全局重定向到 @dcloudio 的 fork，若从本包位置解析会失败；
 * 因此由 loader 在消费方文件位置解析后注入（详见 loader.ts），直接调用时回退本地解析。
 */
export interface TemplateCompiler {
  parseComponent(
    source: string,
    options?: { deindent?: boolean },
  ): { template: SFCBlock | null; script: SFCBlock | null }
  compile(
    template: string,
    options?: {
      outputSourceRange?: boolean
      warn?: (msg: string) => void
      [key: string]: unknown
    },
  ): { ast?: AstElement }
}

let localCompiler: TemplateCompiler | undefined

/** 直接调用 transformVueSource 时的兜底解析（loader 会显式注入消费方的编译器） */
function getLocalCompiler(): TemplateCompiler {
  if (!localCompiler) {
    const req = createRequire(import.meta.url)
    localCompiler = req('vue-template-compiler') as TemplateCompiler
  }
  return localCompiler
}

/** 注入②结果类型 */
export type RootClassStatus = 'applied' | 'merged' | 'skipped-page-content' | 'skipped-no-root'

export interface TransformReport {
  /** 处理的文件路径（loader 传入，直接调用可为空串） */
  file: string
  /** 注入①明细 */
  componentIndex: Array<{ tag: string; index: number }>
  /** 注入②结果 */
  rootClass: RootClassStatus
  /** 注入③明细（点击事件包装） */
  clicks: Array<{ tag: string; event: string }>
  /** 整次转换跳过时记录原因 */
  skipped?: string
}

export interface TransformResult {
  code: string
  report: TransformReport | null
}

/** 一次字符串编辑（插入时 start === end） */
interface Edit {
  start: number
  end: number
  text: string
}

/** 按文档序扫描模板文本中的 `<tag` 开标签位置 */
interface TagScanner {
  findTagOpen(tag: string): number
}

function createTagScanner(body: string): TagScanner {
  let cursor = 0
  const reCache = new Map<string, RegExp>()
  return {
    findTagOpen(tag: string): number {
      let re = reCache.get(tag)
      if (!re) {
        re = new RegExp(`<${escapeRegExp(tag)}(?![\\w-])`, 'g')
        reCache.set(tag, re)
      }
      re.lastIndex = cursor
      let m: RegExpExecArray | null
      while ((m = re.exec(body))) {
        // 跳过注释区里的伪匹配
        const commentStart = body.lastIndexOf('<!--', m.index)
        if (commentStart !== -1 && body.indexOf('-->', commentStart) > m.index) {
          re.lastIndex = body.indexOf('-->', commentStart) + 3
          continue
        }
        cursor = m.index + 1
        return m.index
      }
      return -1
    },
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function transformVueSource(
  source: string,
  options: CompileOptions = {},
  file = '',
  compiler?: TemplateCompiler,
): TransformResult {
  const { parseComponent, compile } = compiler ?? getLocalCompiler()
  const report: TransformReport = { file, componentIndex: [], clicks: [], rootClass: 'skipped-no-root' }
  if (options.disabled) {
    report.skipped = 'disabled'
    return { code: source, report }
  }

  // deindent: false —— 默认的 deindent 会剥离模板行的公共缩进，导致内容与源码偏移错位，
  // 必须关闭以保留原始字节（AST 区间与字符串编辑都依赖这一点）
  const sfc = parseComponent(source, { deindent: false })
  const block: SFCBlock | null = sfc.template
  if (!block) {
    report.skipped = 'no-template'
    return { code: source, report }
  }
  const template = block.content
  const templateStart = block.start

  // vue-template-compiler 实测行为：模板以空白开头（如换行+缩进）时，
  // 解析器会先消费掉这段空白，导致 AST 与文本错位。
  // 这里自行剥离再编译，保证 AST 与文本对齐；编辑后把空白原样拼回。
  const leadingWs = template.length - template.replace(/^\s+/, '').length
  const body = template.slice(leadingWs)

  let ast: AstElement | undefined
  try {
    ast = compile(body, { warn: () => {} }).ast
  } catch (err) {
    report.skipped = `template-compile-error: ${err instanceof Error ? err.message : String(err)}`
    return { code: source, report }
  }
  if (!ast || ast.type !== 1 || ast.tag === undefined) {
    report.skipped = 'no-root-element'
    return { code: source, report }
  }

  const edits: Edit[] = []
  const counters = new Map<string, number>()
  const extraNative = options.nativeTags ?? []
  const scan = createTagScanner(body)

  // 注入①：按文档序遍历 AST（先子树、后 v-else 分支，与文本顺序一致），收集插入点
  let rootTagOpen = -1
  const walk = (node: AstElement) => {
    if (node.type !== 1 || node.tag === undefined) return
    const tag = node.tag
    const clickAttrs = collectClickAttrs(node)
    const isInjectTarget =
      node.component === undefined && // <component :is> 动态组件跳过
      !NATIVE_TAGS.has(tag) &&
      !extraNative.includes(tag) &&
      !hasComponentIndex(node) // 幂等：已注入过则不再插入

    // 每个节点至多定位一次开标签（扫描器按文档序前进，多调会取到下一个同名标签）
    const needTagOpen = node === ast || isInjectTarget || clickAttrs.length > 0
    const tagOpen = needTagOpen ? scan.findTagOpen(tag) : -1
    if (node === ast) {
      // 根元素位置总是先取（注入②需要，无论根是否参与注入）
      rootTagOpen = tagOpen
    }

    if (isInjectTarget && tagOpen !== -1) {
      const index = counters.get(tag) ?? 0
      counters.set(tag, index + 1)
      const pos = tagOpen + 1 + tag.length
      edits.push({ start: pos, end: pos, text: ` :${COMPONENT_INDEX_ATTR}="${index}"` })
      report.componentIndex.push({ tag, index })
    }

    // 注入③：点击包装（只对原生标签；自定义组件标签上的 @click 是组件事件，不注入，
    // 真正的可点元素在组件自身模板里，那个文件会单独过 loader）
    const isNativeTag = NATIVE_TAGS.has(tag) || extraNative.includes(tag)
    if (isNativeTag && clickAttrs.length > 0 && tagOpen !== -1) {
      const openEnd = findInsertPosInOpenTag(body, tagOpen)
      const openTag = body.slice(tagOpen, openEnd + 1)
      for (const attr of clickAttrs) {
        const wrapped = wrapClickValue(attr.value)
        if (wrapped === null) continue // 幂等：已注入过
        const pos = findAttrValueInOpenTag(openTag, attr.name)
        if (!pos) continue // 防御：定位失败不注入
        edits.push({
          start: tagOpen + pos.valueStart,
          end: tagOpen + pos.valueEnd,
          text: wrapped,
        })
        report.clicks.push({ tag, event: attr.name })
      }
    }
    // 无论是否注入都继续遍历（找不到位置只是防御性场景，不能截断子树）
    if (node.children) {
      for (const child of node.children) walk(child)
    }
    if (node.ifConditions) {
      for (const cond of node.ifConditions.slice(1)) walk(cond.block)
    }
  }
  walk(ast)

  // 注入②：根元素 currentTrackClass class 绑定
  applyRootClass(ast, body, rootTagOpen, edits, report)

  if (edits.length === 0) {
    return { code: source, report }
  }

  // 从右到左应用所有编辑，保证偏移有效
  let newBody = body
  let copyReverseEdits = edits.slice().sort((a, b) => b.start - a.start)
  for (const edit of copyReverseEdits) {
    newBody = newBody.slice(0, edit.start) + edit.text + newBody.slice(edit.end)
  }
  const newTemplate = template.slice(0, leadingWs) + newBody
  const code =
    source.slice(0, templateStart) + newTemplate + source.slice(templateStart + template.length)
  return { code, report }
}

/** 该节点是否已注入过 componentIndex（幂等检测，看 attrsList 的原始属性名）。
 *  不用 rawAttrsMap：它只在 compile(outputSourceRange: true) 时被填充，
 *  我们刻意不依赖 range（保证 dev/production 行为一致），其恒为空对象。 */
function hasComponentIndex(node: AstElement): boolean {
  const list = node.attrsList ?? []
  return list.some(
    (a) => a.name === `:${COMPONENT_INDEX_ATTR}` || a.name === `v-bind:${COMPONENT_INDEX_ATTR}`,
  )
}

// ===== 注入③：点击事件包装 =====

/** 点击采集覆盖的事件（含修饰符形态，如 @click.stop 按前缀匹配） */
const CLICK_EVENTS = ['@click', '@tap', 'v-on:click', 'v-on:tap']

// TODO: hash 生成策略后续确定，先写死占位
const CLICK_HASH_PLACEHOLDER = 'click'

// 与 Vue 编译器 simplePathRE 同款判定：裸方法路径按方法引用处理，其余按表达式包括号
const SIMPLE_PATH_RE =
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/

/** 节点上待包装的点击事件属性（attrsList 原始名，含修饰符） */
function collectClickAttrs(node: AstElement): Array<{ name: string; value: string }> {
  const list = node.attrsList ?? []
  return list
    .filter((a) => CLICK_EVENTS.some((ev) => a.name === ev || a.name.startsWith(`${ev}.`)))
    .map((a) => ({ name: a.name, value: String(a.value ?? '') }))
}

/**
 * 生成包装后的属性值（方案 F：逗号序列，先上报、后原样执行原表达式）。
 * 逗号运算符优先级最低，右操作数（原表达式）无需括号；
 * 裸方法路径需补 ($event) 调用；空表达式只留上报调用；返回 null 表示跳过（已注入过）。
 */
function wrapClickValue(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.includes(`${TRACK_CLICK_METHOD}(`)) return null
  if (trimmed === '') return `${TRACK_CLICK_METHOD}('${CLICK_HASH_PLACEHOLDER}', $event)`
  const call = SIMPLE_PATH_RE.test(trimmed) ? `${trimmed}($event)` : raw
  return `(${TRACK_CLICK_METHOD}('${CLICK_HASH_PLACEHOLDER}', $event), ${call})`
}

/** 在开标签文本里定位某属性值区间（不含引号），找不到返回 null */
function findAttrValueInOpenTag(
  openTag: string,
  attrName: string,
): { valueStart: number; valueEnd: number } | null {
  const re = new RegExp(`(?:\\s|^)${escapeRegExp(attrName)}\\s*=\\s*(['"])`)
  const m = re.exec(openTag)
  if (!m) return null
  const quote = m[1]
  const valueStart = m.index + m[0].length
  const closeIdx = openTag.indexOf(quote, valueStart)
  if (closeIdx === -1) return null
  return { valueStart, valueEnd: closeIdx }
}

/** 注入②：根元素 currentTrackClass 绑定（在开标签文本里定位/合并 class 属性） */
function applyRootClass(
  root: AstElement,
  body: string,
  tagOpen: number,
  edits: Edit[],
  report: TransformReport,
) {
  // 页面模板根为 page-content 时不加（路径从页面下一层组件开始）
  if (root.tag === 'page-content') {
    report.rootClass = 'skipped-page-content'
    return
  }
  const openEnd = findInsertPosInOpenTag(body, tagOpen)
  const openTag = body.slice(tagOpen, openEnd + 1)
  const dynamic = matchDynamicClass(openTag)

  if (dynamic) {
    if (dynamic.value.includes(TRACK_CLASS)) {
      // 已注入过（幂等重跑）
      report.rootClass = 'merged'
      return
    }
    const valueStart = tagOpen + dynamic.valueStart
    const valueEnd = tagOpen + dynamic.valueEnd
    const next =
      dynamic.value.trim() === '' ? TRACK_CLASS : `[${dynamic.value}, ${TRACK_CLASS}]`
    edits.push({ start: valueStart, end: valueEnd, text: next })
    report.rootClass = 'merged'
    return
  }

  // 无动态 class：在开标签末尾追加独立 :class（静态 class 与 :class 由 Vue 自动合并）
  edits.push({ start: openEnd, end: openEnd, text: ` :class="${TRACK_CLASS}"` })
  report.rootClass = 'applied'
}

/** 匹配开标签文本中的动态 class 绑定（:class / v-bind:class），返回原值与值在开标签内的区间 */
const DYNAMIC_CLASS_RE = /(?:\s|^)(?::class|v-bind:class)\s*=\s*("([^"]*)"|'([^']*)')/

function matchDynamicClass(
  openTag: string,
): { value: string; valueStart: number; valueEnd: number } | null {
  const m = DYNAMIC_CLASS_RE.exec(openTag)
  if (!m) return null
  const value = m[2] ?? m[3]
  // 空值（:class=""）时 indexOf('') 恒为 0，单独处理：区间 = 两个引号之间
  const valueStart =
    value === '' ? m.index + m[0].length - 1 : m.index + m[0].indexOf(value)
  return { value, valueStart, valueEnd: valueStart + value.length }
}

/**
 * 开标签内可插入属性的位置：扫描到第一个未被引号包裹的 '>'，
 * 若为 '/>' 自闭合则插到 '/' 前，否则插到 '>' 前。
 */
function findInsertPosInOpenTag(body: string, from: number): number {
  let quote = ''
  for (let i = from; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return body[i - 1] === '/' ? i - 1 : i
    }
  }
  return body.length
}
