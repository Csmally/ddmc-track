import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureTrack, install, track } from '../src/index'
import type { TrackBatch, TrackEvent } from '../src/index'
import { __resetReportState } from '../src/report'

interface RequestCapture {
  url: string
  method: string
  data: TrackBatch
  success?: (res: { statusCode: number }) => void
  fail?: (err: unknown) => void
}

/**
 * 打桩 uni：内存 storage + request 捕获。
 * preloadedQueue 预置未发送事件（模拟上次会话残留）；storageUserInfo 控制登录态。
 */
function mockUni(
  onRequest: (opts: {
    url: string
    method: string
    data: unknown
    success?: (res: { statusCode: number }) => void
    fail?: (err: unknown) => void
  }) => void,
  options: { storageUserInfo?: unknown; preloadedQueue?: unknown[] } = {},
) {
  const storage = new Map<string, unknown>()
  if (options.preloadedQueue) storage.set('__ddmc_track_queue__', options.preloadedQueue)
  if (options.storageUserInfo !== undefined) storage.set('userInfo', options.storageUserInfo)
  ;(globalThis as Record<string, unknown>).uni = {
    request: (opts: {
      url: string
      method: string
      data: unknown
      success?: (res: { statusCode: number }) => void
      fail?: (err: unknown) => void
    }) => onRequest(opts),
    getSystemInfoSync: () => ({ uniPlatform: 'h5' }),
    getStorageSync: (k: string) => storage.get(k) ?? null,
    setStorageSync: (k: string, v: unknown) => storage.set(k, JSON.parse(JSON.stringify(v))),
    removeStorageSync: (k: string) => storage.delete(k),
  }
  return storage
}

describe('上报链路（队列/批量/重试/持久化）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    __resetReportState()
    configureTrack({ endpoint: 'http://127.0.0.1:3000/track', batchSize: 10, flushInterval: 5000 })
    delete (globalThis as Record<string, unknown>).uni
  })

  it('满 batchSize 立即批量发送（body = { platform, events }，事件带 uid）', () => {
    configureTrack({ batchSize: 2 })
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
      opts.success?.({ statusCode: 201 })
    }, { storageUserInfo: { id: 7 } })

    track('click', 'p/0')
    track('exposure', 'p/1')

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('http://127.0.0.1:3000/track')
    expect(requests[0].method).toBe('POST')
    const batch = requests[0].data
    expect(batch.platform).toBe('h5')
    expect(batch.events).toHaveLength(2)
    expect(batch.events[0]).toMatchObject({ eventType: 'click', eventPath: 'p/0', uid: 7 })
    expect(batch.events[0].payload).toEqual({ otherData: {} })
    expect(batch.events[0].timestamp).toBeTypeOf('number')
  })

  it('队列未满按 flushInterval 定时发送', () => {
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
      opts.success?.({ statusCode: 201 })
    })

    track('click', 'p/0')
    track('click', 'p/1')
    expect(requests).toHaveLength(0)

    vi.advanceTimersByTime(4999)
    expect(requests).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(requests).toHaveLength(1)
    expect(requests[0].data.events).toHaveLength(2)
    expect(requests[0].data.events[0].uid).toBeUndefined()
  })

  it('事件持久化到 storage，发送成功后清空', () => {
    const requests: RequestCapture[] = []
    const storage = mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
      opts.success?.({ statusCode: 201 })
    })

    track('click', 'p/0')
    const saved = storage.get('__ddmc_track_queue__') as unknown[]
    expect(saved).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(requests).toHaveLength(1)
    expect(storage.has('__ddmc_track_queue__')).toBe(false)
  })

  it('发送失败放回队列，指数退避重试（1s → 2s），成功后退避复位', () => {
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
    })

    track('click', 'p/0')
    vi.advanceTimersByTime(5000) // 常规定时发送
    expect(requests).toHaveLength(1)
    requests[0].fail?.('network') // 失败 → 放回 + 1s 退避

    vi.advanceTimersByTime(999)
    expect(requests).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(requests).toHaveLength(2)
    requests[1].fail?.('network') // 再失败 → 2s 退避

    vi.advanceTimersByTime(1999)
    expect(requests).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(requests).toHaveLength(3)
    requests[2].success?.({ statusCode: 201 }) // 成功 → 退避复位

    // 再次失败时退避回到 1s（验证复位）
    track('click', 'p/1')
    vi.advanceTimersByTime(5000)
    expect(requests).toHaveLength(4)
    requests[3].fail?.('network')
    vi.advanceTimersByTime(999)
    expect(requests).toHaveLength(4)
    vi.advanceTimersByTime(1)
    expect(requests).toHaveLength(5)
    requests[4].success?.({ statusCode: 201 })
  })

  it('非 2xx 响应同样放回重试', () => {
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
    })

    track('click', 'p/0')
    vi.advanceTimersByTime(5000)
    requests[0].success?.({ statusCode: 500 })
    vi.advanceTimersByTime(1000)
    expect(requests).toHaveLength(2)
    requests[1].success?.({ statusCode: 201 })
    expect(requests).toHaveLength(2)
  })

  it('install 恢复 storage 中未发送事件并立即补发', () => {
    const saved: TrackEvent[] = [
      { eventType: 'click', eventPath: 'old/0', payload: { otherData: {} }, timestamp: 123, uid: undefined },
    ]
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
      opts.success?.({ statusCode: 201 })
    }, { preloadedQueue: saved })

    install({ mixin: () => {}, prototype: {} })

    expect(requests).toHaveLength(1)
    expect(requests[0].data.events).toEqual(saved)
  })

  it('队列超上限丢最旧', () => {
    configureTrack({ batchSize: 1000 })
    const requests: RequestCapture[] = []
    mockUni((opts) => {
      requests.push(opts as unknown as RequestCapture)
      opts.success?.({ statusCode: 201 })
    })

    for (let i = 0; i < 501; i++) track('click', `p/${i}`)
    vi.advanceTimersByTime(5000)

    const events = requests[0].data.events
    expect(events).toHaveLength(500)
    expect(events[0].eventPath).toBe('p/1') // 最旧的 p/0 被丢
    expect(events[499].eventPath).toBe('p/500')
  })

  it('非 uni 环境：降级打印不上报', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    track('click', 'x/0')

    expect(spy).toHaveBeenCalledWith('9898 track 上报🚀🚀🚀', 'click', 'x/0', { otherData: {} })
  })
})
