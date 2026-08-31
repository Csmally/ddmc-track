import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { transformVueSource } from '../src/transform'

/** 读取 fixture（真实 market 文件为 CRLF，统一成 LF 便于断言） */
function fixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
}

describe('注入① componentIndex', () => {
  it('home.vue：六处组件注入 + page-content 也注入（编号按同类标签各自从 0 计数）', () => {
    const input = fixture('home.vue')
    const { code, report } = transformVueSource(input, {}, 'home.vue')

    let expected = input
    expected = expected.replace('<page-content>', '<page-content :componentIndex="0">')
    expected = expected.replace(
      '<search-bar @search="handleSearch"></search-bar>',
      '<search-bar :componentIndex="0" @search="handleSearch"></search-bar>',
    )
    // 第一个 banner-swiper → 0，第二个 → 1（replace 只命中第一个）
    expected = expected.replace('<banner-swiper :banners=', '<banner-swiper :componentIndex="0" :banners=')
    expected = expected.replace('<banner-swiper :banners=', '<banner-swiper :componentIndex="1" :banners=')
    expected = expected.replace('<nav-grid :list=', '<nav-grid :componentIndex="0" :list=')
    expected = expected.replace('<section-header title=', '<section-header :componentIndex="0" title=')
    expected = expected.replace('<goods-grid :list=', '<goods-grid :componentIndex="0" :list=')

    expect(code).toBe(expected)
    expect(report!.componentIndex).toEqual([
      { tag: 'page-content', index: 0 },
      { tag: 'search-bar', index: 0 },
      { tag: 'banner-swiper', index: 0 },
      { tag: 'banner-swiper', index: 1 },
      { tag: 'nav-grid', index: 0 },
      { tag: 'section-header', index: 0 },
      { tag: 'goods-grid', index: 0 },
    ])
    // 页面模板根为 page-content：不加 currentTrackClass class
    expect(report!.rootClass).toBe('skipped-page-content')
  })

  it('goods-grid.vue：静态 class 根元素追加独立 :class，嵌套组件 goods-card 注入 index', () => {
    const input = fixture('goods-grid.vue')
    const { code } = transformVueSource(input, {}, 'goods-grid.vue')

    let expected = input
    expected = expected.replace(
      '<view class="goods-grid">',
      '<view class="goods-grid" :class="currentTrackClass">',
    )
    expected = expected.replace('<goods-card', '<goods-card :componentIndex="0"')
    expect(code).toBe(expected)
  })

  it('page-content.vue：普通组件文件根元素正常加 class，slot 不注入', () => {
    const input = fixture('page-content.vue')
    const { code, report } = transformVueSource(input, {}, 'page-content.vue')

    const expected = input.replace(
      '<view class="page-content">',
      '<view class="page-content" :class="currentTrackClass">',
    )
    expect(code).toBe(expected)
    expect(report!.componentIndex).toEqual([])
    expect(report!.rootClass).toBe('applied')
  })

  it('v-if / v-else-if / v-else 各分支各自计数', () => {
    const input = fixture('branches.vue')
    const { code, report } = transformVueSource(input, {}, 'branches.vue')

    let expected = input
    expected = expected.replace('<view class="page">', '<view class="page" :class="currentTrackClass">')
    expected = expected.replace('<promo-banner v-if=', '<promo-banner :componentIndex="0" v-if=')
    expected = expected.replace('<promo-banner v-else-if=', '<promo-banner :componentIndex="1" v-else-if=')
    expected = expected.replace('<promo-banner v-else', '<promo-banner :componentIndex="2" v-else')
    expect(code).toBe(expected)
    expect(report!.componentIndex).toEqual([
      { tag: 'promo-banner', index: 0 },
      { tag: 'promo-banner', index: 1 },
      { tag: 'promo-banner', index: 2 },
    ])
  })

  it('动态组件 <component :is> 跳过，普通组件不受影响', () => {
    const input = fixture('dynamic-component.vue')
    const { code, report } = transformVueSource(input, {}, 'dynamic-component.vue')

    let expected = input
    expected = expected.replace('<view>', '<view :class="currentTrackClass">')
    expected = expected.replace('<some-widget title=', '<some-widget :componentIndex="0" title=')
    expect(code).toBe(expected)
    expect(report!.componentIndex).toEqual([{ tag: 'some-widget', index: 0 }])
  })

  it('原生组件不注入（view/text/image），只有根元素 class', () => {
    const input = fixture('native-only.vue')
    const { code, report } = transformVueSource(input, {}, 'native-only.vue')

    const expected = input.replace(
      '<view class="box">',
      '<view class="box" :class="currentTrackClass">',
    )
    expect(code).toBe(expected)
    expect(report!.componentIndex).toEqual([])
  })

  it('每个文件独立计数', () => {
    const tpl = '<template><view><search-bar></search-bar></view></template>'
    const first = transformVueSource(tpl, {}, 'a.vue')
    const second = transformVueSource(tpl, {}, 'b.vue')
    expect(first.code).toContain('<search-bar :componentIndex="0">')
    expect(second.code).toContain('<search-bar :componentIndex="0">')
  })
})

describe('注入② currentTrackClass class', () => {
  it('已有动态 :class 表达式 → 包进数组', () => {
    const input = fixture('search-bar.vue')
    const { code } = transformVueSource(input, {}, 'search-bar.vue')

    const expected = input.replace(
      '<view :class="className">',
      '<view :class="[className, currentTrackClass]">',
    )
    expect(code).toBe(expected)
  })

  it('已有动态 :class 数组 → 嵌套数组合并（Vue2 会归一化）', () => {
    const input = '<template><view :class="[a, b]"></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<view :class="[[a, b], currentTrackClass]">')
  })

  it('v-bind:class 拼写同样处理', () => {
    const input = '<template><view v-bind:class="foo"></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<view v-bind:class="[foo, currentTrackClass]">')
  })

  it('单引号写法同样处理', () => {
    const input = "<template><view :class='foo'></view></template>"
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain("<view :class='[foo, currentTrackClass]'>")
  })

  it('空 :class 直接替换为 currentTrackClass', () => {
    const input = '<template><view :class=""></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<view :class="currentTrackClass">')
  })

  it('无 class 根元素 → 追加独立 :class', () => {
    const input = '<template><view></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<view :class="currentTrackClass">')
  })

  it('自闭合根元素 → 属性插到 / 之前', () => {
    const input = '<template><view /></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<view  :class="currentTrackClass"/>')
  })
})

describe('注入③ 点击包装', () => {
  it('原生标签 @click 带参 → 逗号序列包裹，原表达式原样保留', () => {
    const input = '<template><view @click="handleTap(x)"></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`<view @click="(__trackClick('j86v', $event), handleTap(x))"`)
    expect(report!.clicks).toEqual([{ tag: 'view', event: '@click', hash: 'j86v' }])
  })

  it('裸方法名 → 补 ($event) 调用', () => {
    const input = '<template><view @click="handleTap"></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`<view @click="(__trackClick('ms9g', $event), handleTap($event))"`)
  })

  it('@tap / v-on:click 同处理，修饰符属性名原样保留', () => {
    const input =
      '<template><view><view @tap="onTap()"></view><text v-on:click="onClick"></text><button @click.stop="onBtn"></button></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`@tap="(__trackClick('mtyy', $event), onTap())"`)
    expect(code).toContain(`v-on:click="(__trackClick('jjbc', $event), onClick($event))"`)
    expect(code).toContain(`@click.stop="(__trackClick('47g8', $event), onBtn($event))"`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@tap', hash: 'mtyy' },
      { tag: 'text', event: 'v-on:click', hash: 'jjbc' },
      { tag: 'button', event: '@click.stop', hash: '47g8' },
    ])
  })

  it('复杂表达式与 v-for 参数原样保留（闭包捕获，无需哨兵参数）', () => {
    const input =
      '<template><view v-for="(item, i) in list" :key="i" @click="count++ && fn(i, item.id)"></view></template>'
    const { code } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`@click="(__trackClick('8tv4', $event), count++ && fn(i, item.id))"`)
  })

  it('自定义组件标签上的 @click 不注入点击（组件事件），仍注入 componentIndex', () => {
    const input = '<template><view><my-card @click="onCard"></my-card></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('<my-card :componentIndex="0" @click="onCard">')
    expect(report!.clicks).toEqual([])
  })

  it('非点击事件（@input/@change）不动', () => {
    const input =
      '<template><view><input @input="onInput" @change="onChange"></input></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain('@input="onInput"')
    expect(code).toContain('@change="onChange"')
    expect(report!.clicks).toEqual([])
  })

  it('无引号值形态（@click 无表达式）→ 防御跳过', () => {
    const input = '<template><view @click></view></template>'
    const { report } = transformVueSource(input, {}, 'x.vue')
    expect(report!.clicks).toEqual([])
  })

  it('幂等：重复转换不二次包裹', () => {
    const input = '<template><view @click="fn(x)"></view></template>'
    const first = transformVueSource(input, {}, 'x.vue')
    const second = transformVueSource(first.code, {}, 'x.vue')
    expect(second.code).toBe(first.code)
  })

  it('与注入①②共存：根元素点击 + 类注入 + 组件 index', () => {
    const input = '<template><view @click="fn()"><my-card></my-card></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(
      `<view @click="(__trackClick('nz1m', $event), fn())" :class="currentTrackClass">`,
    )
    expect(code).toContain('<my-card :componentIndex="0">')
    expect(report!.clicks).toEqual([{ tag: 'view', event: '@click', hash: 'nz1m' }])
  })

  it('nativeTags 扩展的原生标签也参与点击注入', () => {
    const input = '<template><view><my-native @tap="fn()"></my-native></view></template>'
    const { code } = transformVueSource(input, { nativeTags: ['my-native'] }, 'x.vue')
    expect(code).toContain(`<my-native @tap="(__trackClick('nz1m', $event), fn())"`)
  })

  it('事件 key：相同源码哈希相同（相同表达式共享同一 key）', () => {
    const input =
      '<template><view><view @click="fn"></view><text @click="fn"></text></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('8udx', $event)`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@click', hash: '8udx' },
      { tag: 'text', event: '@click', hash: '8udx' },
    ])
  })

  it('事件 key：调用与裸引用是不同的源码，key 各自独立', () => {
    const input =
      '<template><view><view @click="fn()"></view><text @click="fn"></text></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('nz1m', $event)`)
    expect(code).toContain(`__trackClick('8udx', $event)`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@click', hash: 'nz1m' },
      { tag: 'text', event: '@click', hash: '8udx' },
    ])
  })

  it('事件 key：不同参数的调用是不同的 key', () => {
    const input =
      '<template><view><view @click="onTap(1)"></view><text @click="onTap(2)"></text></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('kb41', $event)`)
    expect(code).toContain(`__trackClick('dz5u', $event)`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@click', hash: 'kb41' },
      { tag: 'text', event: '@click', hash: 'dz5u' },
    ])
  })

  it('事件 key：复杂/内联/空表达式都直接哈希为 4 位', () => {
    const input =
      '<template><view><view @click="a && b()"></view><text @click="() => go()"></text><button @click=""></button></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('s1uh', $event)`)
    expect(code).toContain(`__trackClick('e3vu', $event)`)
    expect(code).toContain(`__trackClick('ntfp', $event)`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@click', hash: 's1uh' },
      { tag: 'text', event: '@click', hash: 'e3vu' },
      { tag: 'button', event: '@click', hash: 'ntfp' },
    ])
  })

  it('事件 key：嵌套括号参数同样直接哈希', () => {
    const input = '<template><view @click="fn(a(1))"></view></template>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('fxxb', $event)`)
    expect(report!.clicks).toEqual([{ tag: 'view', event: '@click', hash: 'fxxb' }])
  })

  it('事件 key：含引号的表达式同样直接哈希（无需转义）', () => {
    const input =
      "<template><view><view @tap=\"testTap3('AA')\"></view><text @click='fn(\"x\")'></text></view></template>"
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toContain(`__trackClick('f4u4', $event)`)
    expect(code).toContain(`__trackClick('iq04', $event)`)
    expect(report!.clicks).toEqual([
      { tag: 'view', event: '@tap', hash: 'f4u4' },
      { tag: 'text', event: '@click', hash: 'iq04' },
    ])
  })
})

describe('边界与幂等', () => {
  it('幂等：重复转换结果不变', () => {
    const input = fixture('home.vue')
    const first = transformVueSource(input, {}, 'home.vue')
    const second = transformVueSource(first.code, {}, 'home.vue')
    expect(second.code).toBe(first.code)

    const gs = fixture('goods-grid.vue')
    const g1 = transformVueSource(gs, {}, 'goods-grid.vue')
    const g2 = transformVueSource(g1.code, {}, 'goods-grid.vue')
    expect(g2.code).toBe(g1.code)
  })

  it('disabled → 原样返回', () => {
    const input = fixture('home.vue')
    const { code, report } = transformVueSource(input, { disabled: true }, 'home.vue')
    expect(code).toBe(input)
    expect(report!.skipped).toBe('disabled')
  })

  it('无 template 块 → 原样返回', () => {
    const input = '<script>export default {}</script>'
    const { code, report } = transformVueSource(input, {}, 'x.vue')
    expect(code).toBe(input)
    expect(report!.skipped).toBe('no-template')
  })

  it('nativeTags 追加白名单生效', () => {
    const input = '<template><view><my-native></my-native></view></template>'
    const { code } = transformVueSource(input, { nativeTags: ['my-native'] }, 'x.vue')
    expect(code).not.toContain('componentIndex')
    expect(code).toContain(':class="currentTrackClass"')
  })

  it('模板外的字节（script/style）完全不动', () => {
    const input = fixture('home.vue')
    const { code } = transformVueSource(input, {}, 'home.vue')
    const scriptPart = input.slice(input.indexOf('<script>'))
    expect(code.endsWith(scriptPart)).toBe(true)
  })

  it('生产环境（NODE_ENV=production，编译器不输出 range）注入结果与开发环境一致', () => {
    const input = fixture('home.vue')
    const dev = transformVueSource(input, {}, 'home.vue')

    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const prod = transformVueSource(input, {}, 'home.vue')
      expect(prod.code).toBe(dev.code)
      expect(prod.report!.componentIndex).toEqual(dev.report!.componentIndex)
      expect(prod.report!.rootClass).toBe(dev.report!.rootClass)
    } finally {
      process.env.NODE_ENV = prev
    }

    // 生产模式下 class 合并同样正确（goods-grid：静态 class + goods-card 注入）
    process.env.NODE_ENV = 'production'
    try {
      const gs = fixture('goods-grid.vue')
      const { code } = transformVueSource(gs, {}, 'goods-grid.vue')
      expect(code).toContain('<view class="goods-grid" :class="currentTrackClass">')
      expect(code).toContain('<goods-card :componentIndex="0"')
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
