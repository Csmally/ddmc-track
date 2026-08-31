/**
 * @ddmc/track-runtime —— ddmc 埋点 SDK 运行时包
 *
 * 当前提供：
 * - trackMixin：全局 mixin，消费编译时包注入的 componentIndex / currentTrackClass，
 *   并提供追踪路径值 currentTrackPath
 * - track / $track：统一全局上报入口（install 时挂到 Vue.prototype，任意实例 this.$track 可用）
 * - install：Vue.use(ddmcTrack) 入口，内部 Vue.mixin(trackMixin) + Vue.prototype.$track
 *
 * 接入方式（market 的 main.js）：
 *   import ddmcTrack from '@ddmc/track-runtime'
 *   Vue.use(ddmcTrack)
 *
 * 业务手动埋点兜底：
 *   this.$track('addCart', 'homePage/0/goodsGrid/0', { goodsId: 42 })
 */
import './types'
import { trackMixin } from './mixin'

export { trackMixin }

/**
 * 统一全局上报入口：业务手动埋点兜底与自动采集事件共用。
 * TODO: 队列/上报/会话/上下文方案确定后接入，当前占位打印。
 */
export function track(eventType: string, eventPath: string, data: Record<string, unknown> = {}): void {
  console.log('9898 runtime track', eventType, eventPath, data)
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
