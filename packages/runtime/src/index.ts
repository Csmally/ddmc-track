/**
 * @ddmc/track-runtime —— ddmc 埋点 SDK 运行时包
 *
 * 当前提供：
 * - trackMixin：全局 mixin，消费编译时包注入的 componentIndex / currentTrackClass，
 *   并提供追踪路径值 currentTrackPath；页面 onHide 时主动 flush 上报队列
 * - track / $track：统一全局上报入口（install 时挂到 Vue.prototype，任意实例 this.$track 可用）；
 *   组装上报事件（载荷 = 当前实例 data 的全部字段 + otherData）后进本地队列，
 *   由 report.ts 批量上报（满量 / 定时 / 页面隐藏触发，失败指数退避重试）
 * - configureTrack：上报配置（endpoint / batchSize / flushInterval）
 * - install：Vue.use(ddmcTrack, options) 入口：恢复上次未发送事件 + Vue.mixin(trackMixin)
 *   + Vue.prototype.$track
 *
 * 接入方式（market 的 main.js）：
 *   import ddmcTrack from '@ddmc/track-runtime'
 *   Vue.use(ddmcTrack) // 或 Vue.use(ddmcTrack, { endpoint: 'http://127.0.0.1:3000/track' })
 *
 * 业务手动埋点兜底：
 *   this.$track('addCart', 'homePage/0/goodsGrid/0', { goodsId: 42 })
 */
import './types'
import { trackMixin } from './mixin'
import { configureTrack, enqueue, readUid, restoreQueue } from './report'
import type { TrackEvent } from './report'

export { trackMixin }
export { configureTrack, flushPending, restoreQueue } from './report'
export type { TrackBatch, TrackEvent, TrackOptions } from './report'

declare const uni: unknown

/**
 * 统一全局上报入口：业务手动埋点兜底与自动采集事件共用。
 * 挂在 Vue.prototype 上时 this 即调用它的组件实例（取 $data 作为载荷）。
 */
export function track(
  this: { $data?: Record<string, unknown> } | void,
  eventType: string,
  eventPath: string,
  data?: Record<string, unknown>,
): void {
  const vmData = (this && this.$data) || {}
  const payload = { ...vmData, otherData: data ?? {} }
  const event: TrackEvent = {
    eventType,
    eventPath,
    payload,
    timestamp: Date.now(),
    uid: readUid(),
  }
  if (typeof uni === 'undefined') {
    // 非 uni 环境（纯 Vue2 宿主）无法发送，降级打印
    console.log('9898 track 上报🚀🚀🚀', eventType, eventPath, payload)
    return
  }
  enqueue(event)
}

/** Vue2 插件接口（vue 为 optional peerDependency，用最小类型面避免依赖其类型包） */
interface VueLike {
  mixin(mixin: unknown): void
  prototype: Record<string, unknown>
}

export function install(vue: VueLike, options?: Parameters<typeof configureTrack>[0]): void {
  configureTrack(options)
  restoreQueue() // 补发上次未发送的事件
  vue.mixin(trackMixin)
  vue.prototype.$track = track
}

export default { install }
