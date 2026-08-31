/**
 * webpack loader：构建管线内转换 .vue 模块源码（不改磁盘文件）。
 * 通过 vue.config.js 的 configureTrackLoader（helper.ts）接入；
 * 也可直接配置：{ loader: '@ddmc/track-compile/loader', options: {...} }
 *
 * 模板编译器（vue-template-compiler）在消费方文件位置解析后注入 transform：
 * uni-app 会用 module-alias 把 'vue-template-compiler' 重定向到 @dcloudio 的 fork，
 * 从消费方上下文解析才能拿到真实可用的编译器（本包位置解析会失败）。
 */
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { CompileOptions } from './options'
import { matchesFile } from './options'
import { transformVueSource } from './transform'
import type { TemplateCompiler, TransformReport } from './transform'

/** 报告日志前缀 */
export const REPORT_TAG = '[ddmc-track-compile]'

/** loader 上下文最小类型面（避免依赖 webpack 类型包） */
export interface TrackLoaderContext {
  getOptions(): CompileOptions
  resourcePath: string
  rootContext?: string
  callback(err: Error | null, content?: string): void
}

const compilerCache = new Map<string, TemplateCompiler>()

/**
 * 手动沿目录链找消费方的 node_modules/vue-template-compiler。
 * 不走 require 解析：uni-app 会用 module-alias 把 'vue-template-compiler'
 * 全局重定向到 @dcloudio 的 fork，且重定向后仍从本包位置解析（必然失败）；
 * 手动拿到绝对路径后 require 绝对路径不受 module-alias 影响。
 */
function resolveCompilerPath(root: string): string | null {
  let dir = root
  while (true) {
    const candidate = join(dir, 'node_modules', 'vue-template-compiler')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** 从消费方上下文加载模板编译器；失败时返回 undefined，由 transform 回退本地解析 */
function loadConsumerCompiler(context: TrackLoaderContext): TemplateCompiler | undefined {
  const root = context.rootContext || dirname(context.resourcePath)
  const cached = compilerCache.get(root)
  if (cached) return cached
  const resolved = resolveCompilerPath(root)
  if (!resolved) return undefined
  const req = createRequire(import.meta.url)
  const compiler = req(resolved) as TemplateCompiler
  compilerCache.set(root, compiler)
  return compiler
}

// uni-app 的管线会把同一个 .vue 模块处理多次（转换幂等，结果一致），报告只打一次
const reportedFiles = new Set<string>()

export default function trackLoader(this: TrackLoaderContext, source: string): string {
  const options = this.getOptions() || {}
  if (!matchesFile(this.resourcePath, options)) return source
  const compiler = loadConsumerCompiler(this)
  const { code, report } = transformVueSource(source, options, this.resourcePath, compiler)
  if (options.debug && report && !reportedFiles.has(this.resourcePath)) {
    reportedFiles.add(this.resourcePath)
    printReport(report)
  }
  return code
}

function printReport(report: TransformReport) {
  const lines = [`${REPORT_TAG} ${report.file}`]
  if (report.skipped) {
    lines.push(`  跳过：${report.skipped}`)
  } else {
    lines.push(`  根元素 class：${report.rootClass}`)
    if (report.componentIndex.length > 0) {
      lines.push(`  componentIndex 注入（${report.componentIndex.length} 处）：`)
      for (const item of report.componentIndex) {
        lines.push(`    <${item.tag}> → :componentIndex="${item.index}"`)
      }
    }
    if (report.clicks.length > 0) {
      lines.push(`  点击注入（${report.clicks.length} 处）：`)
      for (const item of report.clicks) {
        lines.push(`    <${item.tag}> ${item.event} → key "${item.hash}"`)
      }
    }
  }
  console.log(lines.join('\n'))
}
