/**
 * 曝光采集：组件 mounted 后观察根元素进入视口，每次进入视口上报一次。
 *
 * - 机制：uni.createIntersectionObserver（uni 框架已抹平 H5/MP 差异，不另做平台分支），
 *   组件级作用域，按 currentTrackClass（编译期注入的根元素 class）定位自身根元素
 * - 触发：intersectionRatio > 0（任一像素露出即曝光）；只按"不可见 → 可见"的跳变上报
 *   （ratio 连续变化不重复报），离开视口再露出会再次上报；同一路径不去重，
 *   v-for 各实例按各自视口进出独立上报
 * - 上报：$track('exposure', currentTrackPath, {})（载荷自动带组件 data）
 * - 生命周期：观察器随组件销毁断开（hook:destroyed）
 * - 防御：非 uni 环境或路径为空（App 实例）直接跳过
 */

import { TRACK_CLASS, TRACK_PATH } from '@ddmc/track-shared'

/** uni API 的最小类型面（运行时包不依赖 @dcloudio/types） */
interface UniObserver {
  relativeToViewport(options?: Record<string, unknown>): UniObserver
  observe(selector: string, callback: (res: { intersectionRatio: number }) => void): void
  disconnect(): void
}

declare const uni:
  | {
      createIntersectionObserver(
        component?: unknown,
        options?: Record<string, unknown>,
      ): UniObserver
    }
  | undefined

/** 观察目标的实例类型面（trackMixin 的 vm 满足）——契约成员用共享常量的计算属性名 */
interface ExposureVm {
  [TRACK_PATH]: string
  [TRACK_CLASS]: string
  $track: (eventType: string, eventPath: string, data?: Record<string, unknown>) => void
  $on?: (event: string, fn: () => void) => void
}

export function observeExposure(vm: ExposureVm): void {
  const path = vm[TRACK_PATH]
  if (!path || typeof uni === 'undefined') return
  let wasVisible = false
  const observer = uni.createIntersectionObserver(vm)
  observer.relativeToViewport().observe(`.${vm[TRACK_CLASS]}`, (res) => {
    const visible = res.intersectionRatio > 0
    // 只在"不可见 → 可见"跳变时上报，ratio 连续变化不重复报；离开再露出会再报
    if (visible && !wasVisible) vm.$track('exposure', path)
    wasVisible = visible
  })
  // 组件销毁时断开观察器，避免泄漏
  vm.$on?.('hook:destroyed', () => observer.disconnect())
}
