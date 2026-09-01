/**
 * @ddmc/track-runtime —— ddmc 埋点 SDK 运行时包
 *
 * 当前提供：
 * - trackMixin：全局 mixin，消费编译时包注入的 componentIndex / currentTrackClass，
 *   并提供追踪路径值 currentTrackPath
 * - track / $track：统一全局上报入口（install 时挂到 Vue.prototype，任意实例 this.$track 可用）；
 *   组装上报事件（载荷 = 当前实例 data 的全部字段 + otherData）并 POST 到上报端点
 * - configureTrack：上报配置（endpoint 可配）
 * - install：Vue.use(ddmcTrack, options) 入口，内部 Vue.mixin(trackMixin) + Vue.prototype.$track
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

export { trackMixin }

// ===== 上报配置 =====

export interface TrackOptions {
  /** 上报端点（POST 上报事件 JSON，HTTP 契约见 README） */
  endpoint?: string
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3000/track'

const config: Required<TrackOptions> = { endpoint: DEFAULT_ENDPOINT }

export function configureTrack(options: TrackOptions = {}): void {
  if (options.endpoint) config.endpoint = options.endpoint
}

// ===== 上报事件组装与发送 =====

/** uni API 的最小类型面（运行时包不依赖 @dcloudio/types） */
declare const uni:
  | {
      request(options: {
        url: string
        method: string
        data: unknown
        fail?: (err: unknown) => void
      }): void
      getSystemInfoSync(): { uniPlatform?: string }
      getStorageSync(key: string): unknown
    }
  | undefined

/** 从 uni storage 读登录用户 id（market 登录态：userInfo = { id, username, nickname }）。
 *  未登录时各平台 getStorageSync 返回 '' / null（老版本 MP 可能抛异常），防御处理。 */
function readUid(): number | string | undefined {
  if (typeof uni === 'undefined') return undefined
  try {
    const userInfo = uni.getStorageSync('userInfo') as { id?: number | string } | null | string
    return userInfo && typeof userInfo === 'object' ? userInfo.id : undefined
  } catch {
    return undefined
  }
}

/** 上报事件结构（HTTP 契约，ddmc-server 接收端按此实现） */
export interface TrackEvent {
  eventType: string
  eventPath: string
  /** 事件载荷：当前实例 data 的全部字段 + otherData（手动传入的 data，缺省 {}） */
  payload: Record<string, unknown>
  /** 事件发生时间（毫秒时间戳） */
  timestamp: number
  /** 运行平台（uni.getSystemInfoSync().uniPlatform，如 h5 / mp-weixin） */
  platform: string | undefined
  /** 登录用户 id（uni storage userInfo.id，未登录时无此字段值） */
  uid: number | string | undefined
}

/**
 * 统一全局上报入口：业务手动埋点兜底与自动采集事件共用。
 * 挂在 Vue.prototype 上时 this 即调用它的组件实例（取 $data 作为载荷）。
 * TODO: 队列/批量/失败重试方案确定后接入，当前即发即送。
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
    platform: typeof uni !== 'undefined' ? uni.getSystemInfoSync().uniPlatform : undefined,
    uid: readUid(),
  }
  if (typeof uni === 'undefined') {
    // 非 uni 环境（纯 Vue2 宿主）无法发送，降级打印
    console.log('9898 track 上报🚀🚀🚀', eventType, eventPath, payload)
    return
  }
  uni.request({
    url: config.endpoint,
    method: 'POST',
    data: event,
    fail: (err) => console.error('[ddmc-track] 上报失败', err),
  })
}

/** Vue2 插件接口（vue 为 optional peerDependency，用最小类型面避免依赖其类型包） */
interface VueLike {
  mixin(mixin: unknown): void
  prototype: Record<string, unknown>
}

export function install(vue: VueLike, options?: TrackOptions): void {
  configureTrack(options)
  vue.mixin(trackMixin)
  vue.prototype.$track = track
}

export default { install }
