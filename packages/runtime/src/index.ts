/**
 * @ddmc/track-runtime —— ddmc 埋点 SDK 运行时包
 *
 * 当前提供：
 * - trackMixin：全局 mixin，消费编译时包注入的 componentIndex / currentTrackClass，
 *   并提供追踪路径值 currentTrackPath
 * - install：Vue.use(ddmcTrack) 入口，内部 Vue.mixin(trackMixin)
 *
 * 接入方式（market 的 main.js）：
 *   import ddmcTrack from '@ddmc/track-runtime'
 *   Vue.use(ddmcTrack)
 */
import './types'
import { trackMixin } from './mixin'

export { trackMixin }

/** Vue2 插件接口（vue 为 optional peerDependency，用最小类型面避免依赖其类型包） */
interface VueLike {
  mixin(mixin: unknown): void
}

export function install(vue: VueLike): void {
  vue.mixin(trackMixin)
}

export default { install }
