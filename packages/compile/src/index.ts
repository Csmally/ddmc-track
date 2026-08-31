/**
 * @ddmc/track-compile —— ddmc 埋点 SDK 编译时包
 *
 * 在 uni-app（Vue2）构建管线中对 .vue 模板做两类注入（详见 transform.ts）：
 *  ① 自定义组件标签加 :componentIndex="N"（槽位级标识）
 *  ② 组件根元素加 :class="currentTrackClass"（运行时包消费的路径标记）
 */
export { transformVueSource } from './transform'
export type { TransformReport, TransformResult, RootClassStatus } from './transform'
export { default as loader, REPORT_TAG } from './loader'
export { configureTrackLoader } from './helper'
export { NATIVE_TAGS } from './native-tags'
export { matchesFile } from './options'
export type { CompileOptions } from './options'
