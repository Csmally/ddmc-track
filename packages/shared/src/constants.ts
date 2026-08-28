/**
 * 编译期契约常量：编译时包（@ddmc/track-compile）负责注入，
 * 运行时包（@ddmc/track-runtime）负责消费。
 * 两端必须引用本文件，禁止在各自包内硬编码同名字符串。
 */

// 注入①：自定义组件标签上的槽位序号绑定（如 :componentIndex="0"）
export const COMPONENT_INDEX_ATTR = 'componentIndex'

// 注入②：组件根元素上的追踪 class 绑定名（如 :class="currentTrackClass"）
export const TRACK_CLASS = 'currentTrackClass'

// 追踪路径值成员名（运行时 mixin computed，形态如 homePage.pageContent[0].searchBar[0]）
export const TRACK_PATH = 'currentTrackPath'
