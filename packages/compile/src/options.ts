/**
 * @ddmc/track-compile 配置项（webpack loader options / configureTrackLoader 参数）。
 */
export interface CompileOptions {
  /** 匹配需要注入的 .vue 文件路径（正则或正则数组，命中任一即处理；默认全部处理） */
  include?: RegExp | RegExp[]
  /** 排除的 .vue 文件路径（命中任一即跳过） */
  exclude?: RegExp | RegExp[]
  /** 追加的原生组件标签白名单（与内置清单合并） */
  nativeTags?: string[]
  /** 完全关闭注入（默认 false） */
  disabled?: boolean
  /** 输出注入报告（默认 false） */
  debug?: boolean
}

/** 判断文件是否在注入范围内 */
export function matchesFile(file: string, options: CompileOptions): boolean {
  const includes = toArray(options.include)
  const excludes = toArray(options.exclude)
  if (includes.length > 0 && !includes.some((re) => re.test(file))) return false
  if (excludes.some((re) => re.test(file))) return false
  return true
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
