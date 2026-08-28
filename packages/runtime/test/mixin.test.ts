// @vitest-environment jsdom
import Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { install, trackMixin } from '../src/index'

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
  it('mounted 打印 currentTrackClass（注入的 componentIndex 参与路径）', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { attrs: { componentIndex: 2 } }),
    })
    new Parent().$mount()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['9898 runtime', 'searchBar-2'])
  })

  it('mounted 对未注入 componentIndex 的组件打印 index 按 0 的路径', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child'),
    })
    new Parent().$mount()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['9898 runtime', 'searchBar-0'])
  })

  it('this.componentIndex 以 prop 形式可读', () => {
    const Child = makeChild()
    const Parent = Vue.extend({
      components: { Child },
      render: (h) => h('child', { ref: 'child', attrs: { componentIndex: 3 } }),
    })
    const vm = new Parent().$mount()
    expect(vm.$refs.child.componentIndex).toBe(3)
  })

  it('install 向 vue 注册全局 mixin', () => {
    let registered: unknown
    install({ mixin: (m) => (registered = m) })
    expect(registered).toBe(trackMixin)
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
