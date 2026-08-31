/**
 * 全局 mixin：编译时包注入的标记在这里被运行时消费。
 *
 * - props.componentIndex：编译时包给每个自定义组件注入的槽位序号（:componentIndex="N"）。
 *   声明为 prop 后可直接 this.componentIndex 读取——Vue2 会把 vnode attrs 中的
 *   同名键（编译器实测输出 attrs: {"componentIndex": 2}）匹配进 prop。
 * - currentTrackPath / currentTrackClass：追踪路径与其类名安全形态（'/' 换成 '-'）。
 *   用 data + created 赋值而非 computed——小程序端的 wx data 只收集组件的
 *   data 与 methods（uni initData），mixin 的 computed 不会进入 WXML 绑定，
 *   类绑定会一直为空；data 赋值会被同步。组件树静态，created 算一次即可。
 *   形态如 home.vue 的 search-bar：homePage/0/pageContent/0/searchBar/0。
 * - __trackClick(hash)：编译期点击包装注入的调用目标（先于原 handler 执行），
 *   把点击事件汇入 $track：eventType 'click'，eventPath = currentTrackPath + '/' + hash。
 * - mounted：发起曝光观察（exposure.ts）——根元素每次进入视口上报一次 exposure
 *   （离开视口再露出会再报）。
 *
 * 注意：MP 端已验证 slot 子组件的 $parent 是 slot 宿主（pageContent）。
 */
import {
  COMPONENT_INDEX_ATTR,
  TRACK_CLASS,
  TRACK_CLICK_METHOD,
  TRACK_PATH,
} from '@ddmc/track-shared'
import { observeExposure } from './exposure'

interface TrackVm {
  $options: { name?: string }
  $parent?: TrackVm
  /** mixin data（created 时沿 $parent 链计算赋值）——契约成员用共享常量的计算属性名 */
  [TRACK_PATH]: string
  [TRACK_CLASS]: string
  /** install 时挂到 Vue.prototype 的统一上报入口（见 index.ts） */
  $track: (eventType: string, eventPath: string, data?: Record<string, unknown>) => void
  $on?: (event: string, fn: () => void) => void
  [key: string]: unknown
}

/** 从当前实例沿 $parent 链上溯，收集 [name, index, ...] 扁平序列 */
function collectTrackParts(start: TrackVm): Array<string | number> {
  const parts: Array<string | number> = []
  let vm: TrackVm | undefined = start
  while (vm) {
    const name = vm.$options.name
    if (name === 'App') break // App 根实例终止链（App 自身路径为空）
    if (name) {
      const index = (vm[COMPONENT_INDEX_ATTR] as number | undefined) ?? 0
      parts.unshift(name, index)
    }
    vm = vm.$parent
  }
  return parts
}

export const trackMixin = {
  props: {
    [COMPONENT_INDEX_ATTR]: { type: Number },
  },
  data() {
    return {
      // 小程序 wx data 只收集 data/methods，模板绑定与 JS 消费统一走 data
      [TRACK_PATH]: '',
      [TRACK_CLASS]: '',
    }
  },
  methods: {
    // 编译期点击包装注入的调用目标：先于原 handler 执行（逗号序列左操作数）
    [TRACK_CLICK_METHOD](hash: string) {
      const vm = this as unknown as TrackVm
      // 点击事件汇入统一上报：eventPath = currentTrackPath + '/' + hash（事件 key）
      vm.$track('click', `${vm[TRACK_PATH]}/${hash}`)
    },
  },
  created(this: TrackVm) {
    const path = collectTrackParts(this).join('/')
    this[TRACK_PATH] = path
    this[TRACK_CLASS] = path.replace(/\//g, '-')
  },
  mounted(this: TrackVm) {
    // 曝光观察：根元素进入视口即上报一次（机制详见 exposure.ts，非 uni 环境自动跳过）
    observeExposure(this)
  },
}
