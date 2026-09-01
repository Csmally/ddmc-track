/**
 * @ddmc/track-runtime —— ddmc 埋点 SDK 运行时包
 *
 * 当前提供：
 * - trackMixin：全局 mixin，消费编译时包注入的 componentIndex / currentTrackClass，
 *   并提供追踪路径值 currentTrackPath
 * - track / $track：统一全局上报入口（install 时挂到 Vue.prototype，任意实例 this.$track 可用）；
 *   载荷 = 当前实例 data 的全部字段 + otherData（可选参数 data，缺省 {}）
 * - install：Vue.use(ddmcTrack) 入口，内部 Vue.mixin(trackMixin) + Vue.prototype.$track
 *
 * 接入方式（market 的 main.js）：
 *   import ddmcTrack from '@ddmc/track-runtime'
 *   Vue.use(ddmcTrack)
 *
 * 业务手动埋点兜底：
 *   this.$track('addCart', 'homePage/0/goodsGrid/0', { goodsId: 42 })
 *   // → 载荷 { ...当前实例 data 全部字段, otherData: { goodsId: 42 } }
 */
import './types'
import { trackMixin } from './mixin'

export { trackMixin }

/**
 * 统一全局上报入口：业务手动埋点兜底与自动采集事件共用。
 * 载荷 = 当前 Vue 实例 data 的全部字段（非组件上下文调用时无）+ otherData：
 * 可选参数 data（缺省 {}）。挂在 Vue.prototype 上时 this 即调用它的组件实例。
 * TODO: 队列/上报/会话/上下文方案确定后接入，当前占位打印。
 */
export function track(
  this: { $data?: Record<string, unknown> } | void,
  eventType: string,
  eventPath: string,
  data?: Record<string, unknown>,
): void {
  const vmData = (this && this.$data) || {}
  const payload = { ...vmData, otherData: data ?? {} }
  console.log('9898 track 上报🚀🚀🚀', eventType, eventPath, payload)
}

/** Vue2 插件接口（vue 为 optional peerDependency，用最小类型面避免依赖其类型包） */
interface VueLike {
  mixin(mixin: unknown): void
  prototype: Record<string, unknown>
}

export function install(vue: VueLike): void {
  vue.mixin(trackMixin)
  vue.prototype.$track = track
}

export default { install }
