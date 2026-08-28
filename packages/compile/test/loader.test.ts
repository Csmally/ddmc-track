import { describe, expect, it, vi, afterEach } from 'vitest'
import trackLoader, { REPORT_TAG } from '../src/loader'
import type { TrackLoaderContext } from '../src/loader'
import type { CompileOptions } from '../src/options'

function run(source: string, options: CompileOptions, file: string): string {
  const context = {
    getOptions: () => options,
    resourcePath: file,
    rootContext: '/project',
    callback: () => {},
  } as TrackLoaderContext
  return trackLoader.call(context, source)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('trackLoader', () => {
  it('匹配的文件被注入', () => {
    const source = '<template><view><search-bar></search-bar></view></template>'
    expect(run(source, {}, '/src/pages/home/home.vue')).toContain(
      '<search-bar :componentIndex="0">',
    )
  })

  it('exclude 命中的文件原样返回', () => {
    const source = '<template><view><search-bar></search-bar></view></template>'
    expect(run(source, { exclude: /node_modules/ }, '/node_modules/x/y.vue')).toBe(source)
  })

  it('include 未命中的文件原样返回', () => {
    const source = '<template><view><search-bar></search-bar></view></template>'
    expect(run(source, { include: [/src\/pages/] }, '/src/utils/x.vue')).toBe(source)
  })

  it('debug 输出注入报告', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    run('<template><view><search-bar></search-bar></view></template>', { debug: true }, '/project/src/pages/a.vue')
    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain(REPORT_TAG)
    expect(output).toContain('a.vue')
    expect(output).toContain('<search-bar> → :componentIndex="0"')
  })

  it('非 debug 不输出', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    run('<template><view><search-bar></search-bar></view></template>', {}, '/project/src/pages/a.vue')
    expect(spy).not.toHaveBeenCalled()
  })
})
