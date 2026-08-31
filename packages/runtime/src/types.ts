/**
 * 类型增强：全局 mixin 给每个 Vue2 组件实例注入的成员。
 * 通过 index.ts 的 `import './types'` 进入类型图，随 dist 声明文件发布，
 * 消费方引入本包后即可获得 this.componentIndex / this.currentTrackClass /
 * this.currentTrackPath / this.$track 的类型提示。
 *
 * 注意：declare module 'vue/types/vue' 的合并要求 vue 的类型已加载进 program，
 * 这里用 reference 指令拉入（不产生任何 JS 产物，声明输出中保留）。
 */
/// <reference types="vue" />

export {}

declare module 'vue/types/vue' {
  interface Vue {
    /** 编译时包注入的槽位序号（未注入的组件为 undefined） */
    componentIndex?: number
    /** 组件根元素 class 绑定的值（mixin data，created 时沿 $parent 链计算赋值） */
    currentTrackClass: string
    /** 追踪路径值（mixin data，created 时沿 $parent 链计算赋值） */
    currentTrackPath: string
    /** 点击采集入口（mixin method，编译期注入的事件包装会调用） */
    __trackClick(hash: string, e?: unknown): void
    /** 统一全局上报入口（业务手动埋点兜底与自动采集共用；eventPath 为追踪路径，如 homePage/0/searchBar/0） */
    $track(eventType: string, eventPath: string, data?: Record<string, unknown>): void
  }
}
