# ddmc-track

ddmc 埋点 SDK monorepo，目标是给 uni-app（Vue2）应用提供**全自动埋点**能力：业务代码零埋点，由编译时包在构建期向模板注入标记，运行时包负责采集与上报。

```
packages/
├─ shared/   @ddmc/track-shared    编译期契约常量（注入/消费两端共用，单一来源）
├─ compile/  @ddmc/track-compile   编译时包：webpack loader，构建期注入模板标记
└─ runtime/  @ddmc/track-runtime   运行时包：全局 mixin 消费注入标记（SDK 主体持续迭代中）
```

## @ddmc/track-compile 编译时包

在 uni-app（Vue2，vue-cli 5 / webpack）构建管线中对 `.vue` 模板做两类注入（**构建管线内存转换，不改磁盘源文件**）：

### 注入① componentIndex（槽位级标识）

模板中所有**自定义组件**（非 uni-app 原生组件，如 view / scroll-view / text / image …）标签上追加第一个属性 `:componentIndex="N"`：

- 编号规则：**同类标签各自从 0 计数**——某类组件第 N 次出现得 `N-1`。`(组件名, componentIndex)` 构成页面内稳定的**槽位标识**（非实例标识，v-for 内所有实例共享同一静态值）
- 每个 `.vue` 文件独立计数；v-if / v-else 分支各自计数；动态组件 `<component :is>` 跳过；页面根组件（如 page-content）同样注入
- 原生组件白名单内置（可用 `nativeTags` 选项追加）

```html
<!-- 转换前 -->
<search-bar @search="handleSearch"></search-bar>
<banner-swiper :banners="banners"></banner-swiper>
<banner-swiper :banners="banners"></banner-swiper>

<!-- 转换后 -->
<search-bar :componentIndex="0" @search="handleSearch"></search-bar>
<banner-swiper :componentIndex="0" :banners="banners"></banner-swiper>
<banner-swiper :componentIndex="1" :banners="banners"></banner-swiper>
```

### 注入② currentTrackClass（组件根元素路径 class）

每个 `.vue` 模板的**根元素**上加 `:class="currentTrackClass"`（活的绑定，由运行时包 mixin 提供的响应式 computed 赋值）：

- 合并策略：无 class → 追加独立 `:class`；仅静态 class → 保留 + 追加独立 `:class`；已有动态 `:class` → 原表达式包进 `[原值, currentTrackClass]`
- **例外**：页面模板根元素是 `<page-content>` 时跳过（页面身份由路由标识，路径从页面下一层组件开始）

```html
<!-- 转换前（组件根） -->
<view :class="className">…</view>

<!-- 转换后 -->
<view :class="[className, currentTrackClass]">…</view>
```

### 接入方式（vue.config.js）

```js
// vue.config.js
const { configureTrackLoader } = require('@ddmc/track-compile')

module.exports = {
  chainWebpack(config) {
    configureTrackLoader(config, {
      // 以下均为可选
      debug: true,              // 输出注入报告
      include: /src\/pages/,    // 只处理命中的文件（默认全部）
      exclude: /node_modules/,  // 跳过命中的文件
      nativeTags: ['my-native'] // 追加原生组件白名单
    })
  }
}
```

`configureTrackLoader` 会在 `vue` 规则的 `vue-loader` 之前插入 `ddmc-track-loader`（规则名定制过可用 `vueRuleName` / `vueLoaderName` 参数调整，接入后可用 `npx vue inspect` 确认顺序）。

也可直接配置 loader：

```js
{ loader: '@ddmc/track-compile/loader', options: { debug: true } }
```

### debug 注入报告

`debug: true` 时每个文件输出报告（前缀 `[ddmc-track-compile]`）：

```
[ddmc-track-compile] /src/pages/home/home.vue
  根元素 class：skipped-page-content
  componentIndex 注入（7 处）：
    <page-content> → :componentIndex="0"
    <search-bar> → :componentIndex="0"
    <banner-swiper> → :componentIndex="0"
    <banner-swiper> → :componentIndex="1"
    …
```

### 与运行时包的契约

- `componentIndex`：注入到组件标签的 prop（未声明时经 Vue2 `$attrs` 传递给组件），运行时 mixin 消费后拼接路径段
- `currentTrackClass`：组件根元素 class 绑定，运行时 mixin 必须提供同名响应式 computed，**安装运行时包 mixin 是注入生效的前提**
- `currentTrackPath`：追踪路径值（运行时 mixin computed，后续实现 `$options.name`（驼峰）+ `[$attrs.componentIndex]` + `$parent.currentTrackPath` 链式上溯，含页面实例段）
- 契约常量定义在 `@ddmc/track-shared`，两端禁止硬编码同名字符串

### 配置项（CompileOptions）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `include` | `RegExp \| RegExp[]` | 全部 | 只处理命中的 .vue 文件 |
| `exclude` | `RegExp \| RegExp[]` | 无 | 跳过命中的文件 |
| `nativeTags` | `string[]` | 无 | 追加原生组件白名单 |
| `disabled` | `boolean` | `false` | 完全关闭注入 |
| `debug` | `boolean` | `false` | 输出注入报告 |

## @ddmc/track-runtime 运行时包

提供全局 mixin，消费编译时包注入的标记（当前为最小可用版）：

```js
// main.js
import ddmcTrack from '@ddmc/track-runtime'
Vue.use(ddmcTrack) // 内部 Vue.mixin(trackMixin)，必须在 $mount 之前
```

当前行为：

- **props.componentIndex**：mixin 声明了该 prop（编译时包注入的 `:componentIndex="N"` 经 Vue2 attrs→props 匹配进入组件），组件内可直接 `this.componentIndex` 读取；`mounted` 时被注入的组件会打印 `[ddmc-track] mounted <组件名> componentIndex = N`（未注入的组件不打印）
- **computed.currentTrackPath**：追踪路径值，沿 `$parent` 链上溯拼接——段 = 驼峰 `$options.name` 与 componentIndex（**未注入时按 0**，页面实例即此形态，如 `homePage/0`）；App 实例终止链（自身路径为空）；无 name 的实例跳过段、链继续。home.vue 示例：`homePage/0/pageContent/0/searchBar/0`、`homePage/0/pageContent/0/bannerSwiper/1`
- **computed.currentTrackClass**：`currentTrackPath` 的类名安全形态（`/` 换成 `-`，如 `homePage-0-pageContent-0-bannerSwiper-1`），绑定到组件根元素 class 上
- 类型增强随包发布：消费方获得 `this.componentIndex` / `this.currentTrackClass` / `this.currentTrackPath` 的类型提示
- **平台注意**：MP 端已验证 slot 子组件的 `$parent` 是 slot 宿主（pageContent），路径含 pageContent 段；H5 端（uni-h5 运行时）链式行为待接入 market 时验证

### 限制与说明

- 依赖 `vue-template-compiler`（peerDependency），需与项目 Vue 版本一致（本仓库测试环境 `~2.6.14`，与 uni-app Vue2 项目一致）
- 模板解析失败 / 无 template 块的文件原样透传并在报告中标注跳过原因，不会中断构建
- 转换幂等：同一文件重复注入结果不变（已注入的标记会被识别并跳过）

## 开发指南

环境：Node ≥ 18、pnpm 10（`corepack prepare pnpm@10 --activate` 或自装）。

```bash
pnpm install        # 安装依赖（workspace）
pnpm test           # Vitest 全量测试
pnpm typecheck      # 两个包的 TS 类型检查
pnpm build          # 构建 @ddmc/track-compile（dist/ 下 ESM + CJS + d.ts）
```

## License

MIT
