// @vitest-environment jsdom
import Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { install, track, trackMixin } from '../src/index'

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
    expect(trackSpy).toHaveBeenCalledWith('click', 'searchBar/1/f4u4', {})
  })
})

describe('$track 全局上报入口（Vue.prototype）', () => {
  afterEach(() => {
    delete (Vue.prototype as Record<string, unknown>).$track
  })

  it('载荷 = 实例 data 全部字段 + otherData（传入的 data），任意实例可调用', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(Vue.prototype as Record<string, unknown>).$track = track
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 1 } }),
    })
    const vm = new Parent().$mount()
    vm.$refs.child.$track('addCart', 'homePage/0/goodsGrid/0', { goodsId: 42, count: 1 })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual([
      '9898 runtime track',
      'addCart',
      'homePage/0/goodsGrid/0',
      {
        currentTrackPath: 'searchBar/1',
        currentTrackClass: 'searchBar-1',
        otherData: { goodsId: 42, count: 1 },
      },
    ])
  })

  it('data 缺省：只报实例 data，otherData 为空对象', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(Vue.prototype as Record<string, unknown>).$track = track
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child' }),
    })
    const vm = new Parent().$mount()
    vm.$refs.child.$track('click', 'x/0')

    expect(spy.mock.calls[0]).toEqual([
      '9898 runtime track',
      'click',
      'x/0',
      { currentTrackPath: 'searchBar/0', currentTrackClass: 'searchBar-0', otherData: {} },
    ])
  })

  it('非组件上下文直接调用：无实例 data，只有 otherData', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    track('search', 'homePage/0/searchBar/0', { kw: '手机' })

    expect(spy.mock.calls[0]).toEqual([
      '9898 runtime track',
      'search',
      'homePage/0/searchBar/0',
      { otherData: { kw: '手机' } },
    ])
  })
})

describe('曝光采集（uni.createIntersectionObserver）', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).uni
    delete (Vue.prototype as Record<string, unknown>).$track
  })

  /** 打桩 uni：捕获 observe 的选择器与回调，手动触发相交结果；可统计 disconnect */
  function mockUni(
    capture: (sel: string, cb: (res: { intersectionRatio: number }) => void) => void,
    onDisconnect?: () => void,
  ) {
    const observer = {
      relativeToViewport: () => observer,
      observe: (sel: string, cb: (res: { intersectionRatio: number }) => void) => capture(sel, cb),
      disconnect: () => onDisconnect?.(),
    }
    ;(globalThis as Record<string, unknown>).uni = {
      createIntersectionObserver: () => observer,
    }
  }

  it('根元素露出（ratio > 0）→ 上报 exposure（选择器 = .currentTrackClass）', async () => {
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
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('exposure', 'searchBar/1', {})
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
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('按"不可见 → 可见"跳变上报：ratio 连续变化不重复，离开视口再露出再报', async () => {
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
    cb({ intersectionRatio: 0.5 }) // 仍可见：不重复报
    cb({ intersectionRatio: 0 }) // 离开视口
    cb({ intersectionRatio: 1 }) // 再露出：再报

    expect(trackSpy).toHaveBeenCalledTimes(2)
    expect(trackSpy).toHaveBeenNthCalledWith(1, 'exposure', 'searchBar/3', {})
    expect(trackSpy).toHaveBeenNthCalledWith(2, 'exposure', 'searchBar/3', {})
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
          h('child', { ref: 'a', attrs: { componentIndex: 4 } }),
          h('child', { ref: 'b', attrs: { componentIndex: 4 } }),
        ])
      },
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    expect(captured).toHaveLength(2) // 两个实例都建立观察
    captured[0]({ intersectionRatio: 1 })
    captured[1]({ intersectionRatio: 1 })
    expect(trackSpy).toHaveBeenCalledTimes(2)
    expect(trackSpy).toHaveBeenCalledWith('exposure', 'searchBar/4', {})
  })

  it('组件销毁时断开观察器', async () => {
    let disconnected = 0
    mockUni(() => {}, () => (disconnected += 1))
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 5 } }),
    })
    const vm = new Parent().$mount()
    await vm.$nextTick()

    expect(disconnected).toBe(0)
    vm.$destroy()
    expect(disconnected).toBe(1)
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
