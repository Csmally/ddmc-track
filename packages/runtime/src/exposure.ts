/**
 * 曝光采集：组件 mounted 后观察根元素，在视口内持续停留满 300ms 才上报一次。
 *
 * - 机制：uni.createIntersectionObserver（uni 框架已抹平 H5/MP 差异，不另做平台分支），
 *   组件级作用域，按 currentTrackClass（编译期注入的根元素 class）定位自身根元素
 * - 触发：intersectionRatio > 0（任一像素露出即进入停留计时）；须在视口内持续停留
 *   满 EXPOSURE_MIN_DURATION（300ms）才上报（期间 ratio 连续变化不重置计时），
 *   未满时长离开视口则取消；已报后离开再进入（再停留满时长）会再报；
 *   同一路径不去重，v-for 各实例按各自视口进出独立上报
 * - 页面生命周期：页面切换走再返回时页面栈保活（组件不重新 mounted，观察器也不
 *   一定重新触发），由 mixin 的 onShow/onHide（uni 页面生命周期，仅页面实例触发）
 *   驱动：onHide 只取消该页未决计时、保留 wasVisible（"离开时是否可见"），
 *   onShow 对 wasVisible 为 true 的条目重新开始停留计时——返回页面可见组件会再次曝光；
 *   离开时不可见的条目不上报，等观察器滚动进出正常触发
 * - 上报：$track('exposure', currentTrackPath)（载荷自动带组件 data）
 * - 生命周期：组件销毁时清理未决计时并断开观察器（hook:destroyed）
 * - 防御：非 uni 环境或路径为空（App 实例）直接跳过
 */

import { TRACK_CLASS, TRACK_PATH } from '@ddmc/track-shared'

/** 有效曝光的最小停留时长（毫秒） */
const EXPOSURE_MIN_DURATION = 300

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

/** 一个曝光条目（一个组件实例）的停留计时状态机 */
interface ExposureEntry {
  vm: ExposureVm
  cls: string
  path: string
  /** 所属页面路径（path 的前两段，如 homePage/0）——页面 onShow/onHide 按此匹配 */
  pagePath: string
  wasVisible: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

/** 全部曝光条目（组件销毁时移除） */
const entries = new Set<ExposureEntry>()

/** 开始 300ms 停留计时（幂等：已有未决计时不重复起） */
function startDwell(entry: ExposureEntry): void {
  if (entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    entry.vm.$track('exposure', entry.path)
  }, EXPOSURE_MIN_DURATION)
}

/** 取消未决计时（已上报的不受影响） */
function cancelDwell(entry: ExposureEntry): void {
  if (!entry.timer) return
  clearTimeout(entry.timer)
  entry.timer = undefined
}

export function observeExposure(vm: ExposureVm): void {
  const path = vm[TRACK_PATH]
  if (!path || typeof uni === 'undefined') return
  const cls = vm[TRACK_CLASS]
  const entry: ExposureEntry = {
    vm,
    cls,
    path,
    pagePath: path.split('/').slice(0, 2).join('/'),
    wasVisible: false,
    timer: undefined,
  }
  entries.add(entry)
  const observer = uni.createIntersectionObserver(vm)
  observer.relativeToViewport().observe(`.${cls}`, (res) => {
    const visible = res.intersectionRatio > 0
    if (visible && !entry.wasVisible) {
      // 进入视口：开始停留计时（期间 ratio 连续变化不重置）
      startDwell(entry)
    } else if (!visible) {
      // 离开视口：未满时长的计时取消（不算有效曝光）
      cancelDwell(entry)
    }
    entry.wasVisible = visible
  })
  // 组件销毁：清理未决计时并断开观察器，避免泄漏
  vm.$on?.('hook:destroyed', () => {
    cancelDwell(entry)
    entries.delete(entry)
    observer.disconnect()
  })
}

/** 页面隐藏（mixin onHide 调用）：取消该页所有未决计时。
 *  不复位 wasVisible——保留"离开时是否可见"的状态，供返回页面时判断。 */
export function hidePageExposures(pagePath: string, pageName?: string): void {
  for (const entry of entries) {
    if (entry.pagePath !== pagePath) continue
    cancelDwell(entry)
  }
}

/** 页面显示（mixin onShow 调用）：离开时可见的条目重新开始停留计时，
 *  满 300ms 后再次上报（返回页面可见组件再次曝光）；不可见的等观察器滚动触发。 */
export function showPageExposures(pagePath: string, pageName?: string): void {
  for (const entry of entries) {
    if (entry.pagePath !== pagePath) continue
    if (entry.wasVisible) startDwell(entry)
  }
}
