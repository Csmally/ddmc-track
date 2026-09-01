// @vitest-environment jsdom
import Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureTrack, install, track, trackMixin } from '../src/index'
import type { TrackBatch } from '../src/index'
import { __resetReportState } from '../src/report'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeChild() {
  return Vue.extend({
    mixins: [trackMixin],
    name: 'searchBar',
    render: (h) => h('view'),
  })
}

/** 打桩 uni：捕获 observe 的选择器与回调，手动触发相交结果；
 *  可统计 disconnect 与 request 上报；storageUserInfo 控制 userInfo 存储值（缺省 null = 未登录） */
function mockUni(
  capture: (sel: string, cb: (res: { intersectionRatio: number }) => void) => void,
  onDisconnect?: () => void,
  onRequest?: (opts: {
    url: string
    method: string
    data: unknown
    success?: (res: { statusCode: number }) => void
    fail?: (err: unknown) => void
  }) => void,
  storageUserInfo?: unknown,
) {
  const observer = {
    relativeToViewport: () => observer,
    observe: (sel: string, cb: (res: { intersectionRatio: number }) => void) => capture(sel, cb),
    disconnect: () => onDisconnect?.(),
  }
  ;(globalThis as Record<string, unknown>).uni = {
    createIntersectionObserver: () => observer,
    request: (opts: {
      url: string
      method: string
      data: unknown
      success?: (res: { statusCode: number }) => void
      fail?: (err: unknown) => void
    }) => onRequest?.(opts),
    getSystemInfoSync: () => ({ uniPlatform: 'h5' }),
    getStorageSync: () => storageUserInfo ?? null,
  }
}

describe('trackMixin', () => {
  it('this.componentIndex 以 prop 形式可读', () => {
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 3 } }),
    })
    const vm = new Parent().$mount()
    expect(vm.$refs.child.componentIndex).toBe(3)
  })

  it('install 注册全局 mixin，并把 $track 挂到 Vue.prototype', () => {
    let registered: unknown
    const proto: Record<string, unknown> = {}
    install({ mixin: (m) => (registered = m), prototype: proto })
    expect(registered).toBe(trackMixin)
    expect(proto.$track).toBe(track)
  })
})

describe('__trackClick 点击采集入口', () => {
  afterEach(() => {
    delete (Vue.prototype as Record<string, unknown>).$track
  })

  it('点击事件汇入 $track：eventType=click，eventPath=currentTrackPath/hash', () => {
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 1 } }),
    })
    const vm = new Parent().$mount()
    vm.$refs.child.__trackClick('f4u4')

    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('click', 'searchBar/1/f4u4')
  })
})

describe('$track 全局上报入口（Vue.prototype）', () => {
  afterEach(() => {
    __resetReportState()
    configureTrack({ endpoint: 'http://127.0.0.1:3000/track', batchSize: 10, flushInterval: 5000 })
    delete (Vue.prototype as Record<string, unknown>).$track
    delete (globalThis as Record<string, unknown>).uni
  })

  function mountChild(index: number) {
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: index } }),
    })
    return new Parent().$mount()
  }

  it('组件上下文：载荷含实例 data，进队列批量上报（body = { platform, events }）', () => {
    configureTrack({ batchSize: 1 }) // 满 1 条立即发送
    const requests: Array<{ url: string; method: string; data: TrackBatch }> = []
    mockUni(() => {}, undefined, (opts) => {
      requests.push(opts as (typeof requests)[0])
      opts.success?.({ statusCode: 201 })
    })
    ;(Vue.prototype as Record<string, unknown>).$track = track
    const vm = mountChild(1)
    vm.$refs.child.$track('addCart', 'homePage/0/goodsGrid/0', { goodsId: 42, count: 1 })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('http://127.0.0.1:3000/track')
    expect(requests[0].method).toBe('POST')
    const batch = requests[0].data
    expect(batch.platform).toBe('h5')
    expect(batch.events).toHaveLength(1)
    const evt = batch.events[0]
    expect(evt.eventType).toBe('addCart')
    expect(evt.eventPath).toBe('homePage/0/goodsGrid/0')
    expect(evt.payload).toEqual({
      currentTrackPath: 'searchBar/1',
      currentTrackClass: 'searchBar-1',
      otherData: { goodsId: 42, count: 1 },
    })
    expect(evt.timestamp).toBeTypeOf('number')
  })

  it('install 注册 mixin 与 $track，第二参数透传 endpoint 配置', () => {
    let registered: unknown
    const proto: Record<string, unknown> = {}
    install({ mixin: (m) => (registered = m), prototype: proto }, { endpoint: 'http://x/events' })
    expect(registered).toBe(trackMixin)
    expect(proto.$track).toBe(track)

    configureTrack({ batchSize: 1 })
    const requests: Array<{ url: string; method: string; data: TrackBatch }> = []
    mockUni(() => {}, undefined, (opts) => {
      requests.push(opts as (typeof requests)[0])
      opts.success?.({ statusCode: 201 })
    })
    ;(proto.$track as typeof track).call(undefined, 'a', 'b')
    expect(requests[0].url).toBe('http://x/events')
  })

  it('非 uni 环境：降级打印不上报', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(Vue.prototype as Record<string, unknown>).$track = track
    const vm = mountChild(2)
    vm.$refs.child.$track('click', 'x/0')

    expect(spy).toHaveBeenCalledWith('9898 track 上报🚀🚀🚀', 'click', 'x/0', {
      currentTrackPath: 'searchBar/2',
      currentTrackClass: 'searchBar-2',
      otherData: {},
    })
  })
})

describe('曝光采集（uni.createIntersectionObserver）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as Record<string, unknown>).uni
    delete (Vue.prototype as Record<string, unknown>).$track
  })

  it('露出后停留满 300ms 才上报（选择器 = .currentTrackClass）', async () => {
    let capturedSel = ''
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((sel, cb) => {
      capturedSel = sel
      capturedCb = cb
    })
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 1 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    expect(capturedSel).toBe('.searchBar-1')
    capturedCb!({ intersectionRatio: 1 })
    vi.advanceTimersByTime(299)
    expect(trackSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('exposure', 'searchBar/1')
  })

  it('未露出（ratio 0）不上报', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 2 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    capturedCb!({ intersectionRatio: 0 })
    vi.advanceTimersByTime(1000)
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('停留未满 300ms 离开视口取消；再进入重新计时', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 3 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    const cb = capturedCb!
    cb({ intersectionRatio: 1 })
    vi.advanceTimersByTime(200)
    cb({ intersectionRatio: 0 }) // 未满时长离开：取消
    vi.advanceTimersByTime(1000)
    expect(trackSpy).not.toHaveBeenCalled()

    cb({ intersectionRatio: 1 }) // 再进入：重新计时
    vi.advanceTimersByTime(299)
    expect(trackSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('已报后离开再进入（再停留满时长）再次上报', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 4 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    const cb = capturedCb!
    cb({ intersectionRatio: 1 })
    vi.advanceTimersByTime(300)
    expect(trackSpy).toHaveBeenCalledTimes(1)
    cb({ intersectionRatio: 0 }) // 离开
    cb({ intersectionRatio: 1 }) // 再进入
    vi.advanceTimersByTime(300)
    expect(trackSpy).toHaveBeenCalledTimes(2)
  })

  it('ratio 连续变化不重置停留计时', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 5 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    const cb = capturedCb!
    cb({ intersectionRatio: 1 })
    vi.advanceTimersByTime(200)
    cb({ intersectionRatio: 0.5 }) // 仍可见：计时不重置
    vi.advanceTimersByTime(50)
    expect(trackSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('v-for 各实例按各自视口进出独立上报（同路径不去重）', async () => {
    const captured: Array<(res: { intersectionRatio: number }) => void> = []
    mockUni((_sel, cb) => captured.push(cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render(h) {
        return h('view', [
          h('child', { ref: 'a', attrs: { componentIndex: 6 } }),
          h('child', { ref: 'b', attrs: { componentIndex: 6 } }),
        ])
      },
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    expect(captured).toHaveLength(2) // 两个实例都建立观察
    captured[0]({ intersectionRatio: 1 })
    captured[1]({ intersectionRatio: 1 })
    vi.advanceTimersByTime(300)
    expect(trackSpy).toHaveBeenCalledTimes(2)
    expect(trackSpy).toHaveBeenCalledWith('exposure', 'searchBar/6')
  })

  it('组件销毁：断开观察器并清理未决计时', async () => {
    let disconnected = 0
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb), () => (disconnected += 1))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 7 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    capturedCb!({ intersectionRatio: 1 }) // 起未决计时
    vm.$destroy()
    vi.advanceTimersByTime(1000)
    expect(disconnected).toBe(1)
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('App 实例（空路径）不观察', async () => {
    let created = 0
    mockUni(() => (created += 1))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const App = Vue.extend({ name: 'App', mixins: [trackMixin], render: (h) => h('view') })
    const vm = new App().$mount()
    await vm.$nextTick()

    expect(created).toBe(0)
    expect(trackSpy).not.toHaveBeenCalled()
  })
})

describe('曝光采集 · 页面切换（onShow/onHide）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    __resetReportState()
    configureTrack({ endpoint: 'http://127.0.0.1:3000/track', batchSize: 10, flushInterval: 5000 })
    delete (globalThis as Record<string, unknown>).uni
    delete (Vue.prototype as Record<string, unknown>).$track
  })

  function mountPageChild(index: number) {
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: index } }),
    })
    return new Parent().$mount()
  }

  it('切走页面再返回：离开时可见的元素重新计时上报（页面栈保活场景）', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const vm = mountPageChild(8)
    await vm.$nextTick()

    // 首次进入：停留满 300ms 上报，wasVisible 保持 true
    capturedCb!({ intersectionRatio: 1 })
    vi.advanceTimersByTime(300)
    expect(trackSpy).toHaveBeenCalledTimes(1)

    // 切走页面：onHide 只取消未决计时，保留 wasVisible
    trackMixin.onHide.call(vm.$refs.child)
    vi.advanceTimersByTime(1000)
    expect(trackSpy).toHaveBeenCalledTimes(1)

    // 返回页面：wasVisible=true → 重新计时上报
    trackMixin.onShow.call(vm.$refs.child)
    vi.advanceTimersByTime(299)
    expect(trackSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(trackSpy).toHaveBeenCalledTimes(2)
    expect(trackSpy).toHaveBeenNthCalledWith(2, 'exposure', 'searchBar/8')
  })

  it('返回页面时离开前已不可见的元素不重报（等观察器滚动触发）', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const vm = mountPageChild(9)
    await vm.$nextTick()

    capturedCb!({ intersectionRatio: 1 })
    vi.advanceTimersByTime(300)
    expect(trackSpy).toHaveBeenCalledTimes(1)

    capturedCb!({ intersectionRatio: 0 }) // 切走前滚出视口：wasVisible=false
    trackMixin.onHide.call(vm.$refs.child)
    trackMixin.onShow.call(vm.$refs.child)
    vi.advanceTimersByTime(1000)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('切走页面取消未决停留计时', async () => {
    let capturedCb: ((res: { intersectionRatio: number }) => void) | undefined
    mockUni((_sel, cb) => (capturedCb = cb))
    const trackSpy = vi.fn()
    ;(Vue.prototype as Record<string, unknown>).$track = trackSpy
    const vm = mountPageChild(10)
    await vm.$nextTick()

    capturedCb!({ intersectionRatio: 1 })
    vi.advanceTimersByTime(100) // 停留 100ms 未满
    trackMixin.onHide.call(vm.$refs.child) // 切走页面：取消
    vi.advanceTimersByTime(1000)
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('onHide 主动 flush 积压的上报事件', async () => {
    const requests: Array<{ url: string; method: string; data: TrackBatch }> = []
    mockUni(() => {}, undefined, (opts) => {
      requests.push(opts as (typeof requests)[0])
      opts.success?.({ statusCode: 201 })
    })
    ;(Vue.prototype as Record<string, unknown>).$track = track
    configureTrack({ batchSize: 50 }) // 不满批量，等 onHide 触发
    const vm = mountPageChild(11)
    await vm.$nextTick()

    vm.$refs.child.$track('click', 'x/0')
    expect(requests).toHaveLength(0)

    trackMixin.onHide.call(vm.$refs.child)
    expect(requests).toHaveLength(1)
    expect(requests[0].data.events[0].eventPath).toBe('x/0')
  })
})

describe('currentTrackPath / currentTrackClass 路径链', () => {
  function makeComponent(name: string) {
    return Vue.extend({ mixins: [trackMixin], name, render: (h) => h('view') })
  }

  it('home.vue 形态：homePage → pageContent → searchBar / bannerSwiper×2', () => {
    const SearchBar = makeComponent('searchBar')
    const BannerSwiper = makeComponent('bannerSwiper')
    const PageContent = Vue.extend({
      mixins: [trackMixin],
      name: 'pageContent',
      render(h) {
        return h('view', [
          h(SearchBar, { ref: 'sb', attrs: { componentIndex: 0 } }),
          h(BannerSwiper, { ref: 'b0', attrs: { componentIndex: 0 } }),
          h(BannerSwiper, { ref: 'b1', attrs: { componentIndex: 1 } }),
        ])
      },
    })
    const HomePage = Vue.extend({
      mixins: [trackMixin],
      name: 'homePage',
      render(h) {
        return h(PageContent, { ref: 'pc', attrs: { componentIndex: 0 } })
      },
    })
    const App = Vue.extend({ name: 'App', render: (h) => h(HomePage, { ref: 'home' }) })
    const app = new App().$mount()

    const home = app.$refs.home
    // ref 注册在创建该 vnode 的组件上：pc 的 ref 在 HomePage 实例（home）上
    const pc = home.$refs.pc
    // 页面实例未注入 componentIndex → 按 0
    expect(home.currentTrackPath).toBe('homePage/0')
    expect(home.currentTrackClass).toBe('homePage-0')
    expect(pc.currentTrackPath).toBe('homePage/0/pageContent/0')
    expect(pc.currentTrackClass).toBe('homePage-0-pageContent-0')

    const sb = pc.$refs.sb
    expect(sb.currentTrackPath).toBe('homePage/0/pageContent/0/searchBar/0')
    expect(sb.currentTrackClass).toBe('homePage-0-pageContent-0-searchBar-0')

    const b0 = pc.$refs.b0
    const b1 = pc.$refs.b1
    expect(b0.currentTrackPath).toBe('homePage/0/pageContent/0/bannerSwiper/0')
    expect(b0.currentTrackClass).toBe('homePage-0-pageContent-0-bannerSwiper-0')
    expect(b1.currentTrackPath).toBe('homePage/0/pageContent/0/bannerSwiper/1')
    expect(b1.currentTrackClass).toBe('homePage-0-pageContent-0-bannerSwiper-1')
  })

  it('App 实例本身路径为空（链在 App 终止）', () => {
    const App = Vue.extend({ name: 'App', mixins: [trackMixin], render: (h) => h('view') })
    const app = new App().$mount()
    expect(app.currentTrackPath).toBe('')
    expect(app.currentTrackClass).toBe('')
  })

  it('无 name 的实例跳过段、链继续上溯', () => {
    const Leaf = makeComponent('leaf')
    const Wrapper = Vue.extend({
      mixins: [trackMixin],
      render(h) {
        return h(Leaf, { ref: 'leaf', attrs: { componentIndex: 2 } })
      },
    })
    const App = Vue.extend({ name: 'App', render: (h) => h(Wrapper, { ref: 'w' }) })
    const app = new App().$mount()

    expect(app.$refs.w.$refs.leaf.currentTrackPath).toBe('leaf/2')
    expect(app.$refs.w.$refs.leaf.currentTrackClass).toBe('leaf-2')
  })
})
