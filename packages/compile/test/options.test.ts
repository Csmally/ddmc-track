import { describe, expect, it } from 'vitest'
import { matchesFile } from '../src/options'

describe('matchesFile', () => {
  const page = '/project/src/pages/home/home.vue'
  const dep = '/project/node_modules/foo/x.vue'

  it('默认全部匹配', () => {
    expect(matchesFile(page, {})).toBe(true)
    expect(matchesFile(dep, {})).toBe(true)
  })

  it('include 命中任一即处理', () => {
    expect(matchesFile(page, { include: [/src\/pages/] })).toBe(true)
    expect(matchesFile(dep, { include: [/src\/pages/] })).toBe(false)
    expect(matchesFile(page, { include: [/a\.vue/, /b\.vue/, /home\.vue/] })).toBe(true)
  })

  it('exclude 命中任一即跳过（优先于 include）', () => {
    expect(matchesFile(page, { exclude: [/node_modules/] })).toBe(true)
    expect(matchesFile(dep, { exclude: [/node_modules/] })).toBe(false)
    expect(matchesFile(dep, { include: [/\.vue/], exclude: [/node_modules/] })).toBe(false)
  })
})
