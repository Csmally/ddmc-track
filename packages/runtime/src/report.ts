/**
 * 上报链路（标准 SDK 方案）：$track 组装的事件进本地队列，独立调度器批量上报。
 *
 * - 队列：内存 + uni storage 持久化（应用被杀/断网不丢，启动时补发）
 * - 触发：满 batchSize 立即发 / flushInterval 定时发 / 页面隐藏（mixin onHide）主动 flush
 * - 批量：body = { platform, events: [...] }（公共上下文提升到批次外层）
 * - 重试：失败（网络错误或非 2xx）放回队首，指数退避（1s 起翻倍、上限 30s），成功复位
 * - 上限：队列超 MAX_QUEUE 丢最旧，防上报端点不可用期间内存/存储爆炸
 */

/** uni API 的最小类型面（运行时包不依赖 @dcloudio/types） */
declare const uni:
  | {
      request(options: {
        url: string
        method: string
        data: unknown
        success?: (res: { statusCode: number }) => void
        fail?: (err: unknown) => void
      }): void
      getSystemInfoSync(): { uniPlatform?: string }
      getStorageSync(key: string): unknown
      setStorageSync(key: string, data: unknown): void
      removeStorageSync(key: string): void
    }
  | undefined

// ===== 上报配置 =====

export interface TrackOptions {
  /** 上报端点（POST 批量事件，HTTP 契约见 README） */
  endpoint?: string
  /** 批量上报大小：队列满 N 条立即发送（默认 10） */
  batchSize?: number
  /** 定时发送间隔（毫秒，默认 5000）：队列未满也按此周期发送 */
  flushInterval?: number
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3000/track'
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_FLUSH_INTERVAL = 5000
/** 队列上限（内存与持久化一致），超出丢最旧 */
const MAX_QUEUE = 500
/** 失败重试退避：起始与上限（毫秒） */
const RETRY_BASE_DELAY = 1000
const RETRY_MAX_DELAY = 30000
/** enqueue 触发的持久化最小间隔（毫秒）；flush 前后强制持久化 */
const PERSIST_THROTTLE = 1000
/** 未发送事件持久化的 storage 键 */
const STORAGE_KEY = '__ddmc_track_queue__'

/** 单条上报事件（HTTP 契约见 README） */
export interface TrackEvent {
  eventType: string
  eventPath: string
  /** 事件载荷：当前实例 data 的全部字段 + otherData（手动传入的 data，缺省 {}） */
  payload: Record<string, unknown>
  /** 事件发生时间（毫秒时间戳） */
  timestamp: number
  /** 登录用户 id（uni storage userInfo.id，未登录时无此字段值） */
  uid: number | string | undefined
}

/** 批量上报 body：公共上下文提升到批次外层 */
export interface TrackBatch {
  platform: string | undefined
  events: TrackEvent[]
}

const config: Required<TrackOptions> = {
  endpoint: DEFAULT_ENDPOINT,
  batchSize: DEFAULT_BATCH_SIZE,
  flushInterval: DEFAULT_FLUSH_INTERVAL,
}

export function configureTrack(options: TrackOptions = {}): void {
  if (options.endpoint) config.endpoint = options.endpoint
  if (options.batchSize && options.batchSize > 0) config.batchSize = options.batchSize
  if (options.flushInterval && options.flushInterval > 0) {
    config.flushInterval = options.flushInterval
  }
}

// ===== 队列与发送 =====

const queue: TrackEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = RETRY_BASE_DELAY
let lastPersist = 0
let restored = false

/** 从 uni storage 读登录用户 id（market 登录态：userInfo = { id, username, nickname }）。
 *  未登录时各平台 getStorageSync 返回 '' / null（老版本 MP 可能抛异常），防御处理。 */
export function readUid(): number | string | undefined {
  if (typeof uni === 'undefined') return undefined
  try {
    const userInfo = uni.getStorageSync('userInfo') as { id?: number | string } | null | string
    return userInfo && typeof userInfo === 'object' ? userInfo.id : undefined
  } catch {
    return undefined
  }
}

/** 持久化当前队列（enqueue 触发时节流，flush 前后强制） */
function persistQueue(force = false): void {
  if (typeof uni === 'undefined') return
  const now = Date.now()
  if (!force && now - lastPersist < PERSIST_THROTTLE) return
  lastPersist = now
  try {
    if (queue.length === 0) uni.removeStorageSync(STORAGE_KEY)
    else uni.setStorageSync(STORAGE_KEY, queue)
  } catch {
    // 存储失败（配额/异常）不影响上报链路
  }
}

/** 启动时恢复上次未发送事件（install 调用一次） */
export function restoreQueue(): void {
  if (restored || typeof uni === 'undefined') return
  restored = true
  try {
    const saved = uni.getStorageSync(STORAGE_KEY)
    if (Array.isArray(saved)) {
      for (const item of saved) {
        const ev = item as TrackEvent
        if (ev && typeof ev === 'object' && typeof ev.eventType === 'string') {
          queue.push(ev)
        }
      }
    }
  } catch {
    // 存储数据损坏时忽略
  }
  if (queue.length > 0) flush()
}

export function enqueue(event: TrackEvent): void {
  queue.push(event)
  if (queue.length > MAX_QUEUE) queue.shift() // 超出上限丢最旧
  persistQueue()
  if (queue.length >= config.batchSize) {
    flush()
  } else {
    scheduleFlush()
  }
}

/** 定时发送：队列未满也按 flushInterval 周期发送 */
function scheduleFlush(delay?: number): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    flush()
  }, delay ?? config.flushInterval)
}

/** 取消既有定时并立即安排重试（退避优先于常规节奏） */
function rescheduleFlush(delay: number): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  scheduleFlush(delay)
}

/** 页面隐藏等时机主动发送积压（不改变既有定时节奏） */
export function flushPending(): void {
  if (queue.length === 0) return
  flush()
}

function flush(): void {
  if (typeof uni === 'undefined' || queue.length === 0) return
  const batch: TrackBatch = {
    platform: uni.getSystemInfoSync().uniPlatform,
    events: queue.splice(0, config.batchSize),
  }
  persistQueue(true) // 发送前落盘：后台冻结拿不到回调也不丢（at-least-once，至多重复）
  uni.request({
    url: config.endpoint,
    method: 'POST',
    data: batch,
    success: (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        onSendFailed(batch.events)
        return
      }
      retryDelay = RETRY_BASE_DELAY // 成功后退避复位
      persistQueue(true)
    },
    fail: () => onSendFailed(batch.events),
  })
}

/** 发送失败：事件放回队首，指数退避后重试 */
function onSendFailed(events: TrackEvent[]): void {
  queue.unshift(...events)
  persistQueue(true)
  rescheduleFlush(retryDelay)
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_DELAY)
}

/** 仅测试用：复位模块状态（队列/定时器/退避/恢复标记），保证测试间隔离 */
export function __resetReportState(): void {
  queue.length = 0
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  retryDelay = RETRY_BASE_DELAY
  lastPersist = 0
  restored = false
}
