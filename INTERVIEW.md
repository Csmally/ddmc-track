# ddmc-track 面试要点

> 埋点 SDK monorepo：给 uni-app（Vue2）商城提供**全自动埋点**——业务代码零埋点，
> 编译期注入标记，运行时自动采集点击/曝光并批量上报，服务端落库。

---

## 1. 一句话介绍

「做了一个全自动埋点 SDK：编译期通过 webpack loader 向 Vue 模板注入追踪标记，
运行时 mixin 消费标记自动采集点击、曝光事件，经本地队列批量上报到服务端落库。
业务侧零埋点，最多一行 `Vue.use(ddmcTrack)`。」

## 2. 整体架构

```
┌─────────────┐   注入标记    ┌──────────────────────────────┐
│ track-compile│ ───────────→ │  ddmc-market（uni-app Vue2）  │
│ webpack loader│  .vue 模板   │  页面/组件实例（mixin 生效）    │
└─────────────┘              └──────────────┬───────────────┘
                                            │ $track（手动兜底）
                                            │ __trackClick（自动点击）
                                            │ observeExposure（自动曝光）
                                            ▼
                              ┌──────────────────────────────┐
                              │       track-runtime          │
                              │  本地队列（内存 + storage）    │
                              │  批量 / 定时 / onHide 触发     │
                              └──────────────┬───────────────┘
                                             │ uni.request POST
                                             ▼
                              ┌──────────────────────────────┐
                              │        ddmc-server           │
                              │  POST /track → track_events  │
                              │  （Express + PostgreSQL）     │
                              └──────────────────────────────┘
```

**三包职责**（pnpm workspace，@ddmc scope）：

| 包 | 职责 |
|---|---|
| `@ddmc/track-shared` | 契约常量单一来源（componentIndex / currentTrackClass / currentTrackPath / __trackClick），两端禁止硬编码 |
| `@ddmc/track-compile` | 编译时包：webpack loader，构建期内存转换 .vue 模板（不改磁盘源文件） |
| `@ddmc/track-runtime` | 运行时包：全局 mixin 消费标记 + 事件采集 + 上报链路 |

## 3. 核心设计点

### 3.1 编译期三类注入（外科手术式字符串编辑）

| 注入 | 内容 | 例子 |
|---|---|---|
| ① `:componentIndex="N"` | 自定义组件标签的**槽位级标识**：同类标签各自从 0 计数、每文件独立、v-if/v-else 分支各自计数、动态组件 `<component :is>` 跳过 | `<search-bar :componentIndex="0">` |
| ② `:class="currentTrackClass"` | 组件根元素挂追踪 class（活的绑定，运行时 data 赋值）；已有动态 :class 合并进数组；页面根为 page-content 时跳过 | `:class="[className, currentTrackClass]"` |
| ③ 点击包装 | 原生标签 @click/@tap 值包成「先上报、后执行」的逗号序列，**事件 key = 表达式 FNV-1a 哈希取低 4 位 base36** | `@tap="(__trackClick('f4u4', $event), testTap3('AA'))"` |

**定位方式**：不依赖编译器 outputSourceRange（生产构建下 vue-template-compiler 不输出 range），
改为按 AST 文档序遍历序在模板文本里顺序扫描 `<tag` 定位插入点——dev/prod 行为一致
（完整排查故事见第 4 节 #3）。

### 3.2 运行时身份体系（路径链）

- `currentTrackPath`：沿 `$parent` 链上溯拼接——段 = 驼峰组件名 + componentIndex（未注入按 0），
  App 根实例终止。形态：`homePage/0/pageContent/0/searchBar/0`
- `currentTrackClass`：路径的类名安全形态（`/` → `-`），绑在组件根元素上，同时是曝光观察的选择器
- **槽位级而非实例级**：v-for 所有实例共享同一静态标识（编译期可静态注入的前提）
- 实现细节：用 data + created 赋值而非 computed——小程序 wx data 只收集 data/methods，
  mixin 的 computed 不会进 WXML 绑定

### 3.3 曝光采集

- `uni.createIntersectionObserver(组件实例)` 组件级作用域观察 `.currentTrackClass`（跨 H5/MP，无平台分支）
- 口径：**须在视口内持续停留满 300ms 才上报**（过滤划过），只按"不可见 → 可见"跳变计时
  （ratio 连续变化不重置），未满时长离开取消，离开再进入再报
- **页面栈保活问题**：A → B → 返回 A，组件不重新 mounted、观察器不重新触发 → 曝光丢失。
  解法：mixin 的 onShow/onHide（uni 页面生命周期）驱动——onHide 取消该页未决计时并**保留 wasVisible**
  （离开时是否可见），onShow 对 wasVisible 为 true 的条目重新计时上报

### 3.4 上报链路（对标主流 SDK 标准方案）

- **本地队列**：内存 + uni storage 持久化（`__ddmc_track_queue__`），应用被杀/断网不丢，install 时补发
- **批量发送**：body = `{ platform, events: [...] }`（公共上下文提升到批次外层），
  三种触发：满 `batchSize`(10) / 定时 `flushInterval`(5s) / 页面 onHide；均可配置
- **失败重试**：网络错误或非 2xx → 批次放回队首，指数退避 1s 起翻倍、上限 30s，成功复位
- **上限**：队列超 500 条丢最旧；发送前落盘（at-least-once）
- 事件结构：`{ eventType, eventPath, payload: {...vm.$data, otherData}, timestamp, uid }`，
  uid 自动读 storage 的 `userInfo.id`（未登录缺省）

## 4. 踩坑与解决（面试故事库）

> 面试时按「现象 → 根因 → 方案」讲，每条 1~2 分钟

1. **vue-loader 的 pitch 短路**：loader 插进 vue 规则会拿不到原始 SFC（左侧拿编译产物、右侧不执行）
   → 用 `enforce('pre')` 独立规则，在 vue-loader 之前拿到原始 .vue 源码
   （注释按 vue-loader 15 的经验写的；market 实际装 17.4.2，pitch 拆到 pitcher.js 只拦截块请求——
   两代结论一致。执行顺序详解见第 5 节 Q&A「webpack loader 执行顺序」）
2. **uni module-alias 劫持 require**：uni-app 把 `vue-template-compiler` 全局重定向到 @dcloudio fork，
   从 SDK 包位置 require 必失败 → 模板编译器改为**依赖注入**：loader 手动沿目录链找消费方
   node_modules，require 绝对路径绕过 alias 重写
3. **NODE_ENV=production 无 source range**（最值得展开讲的一个）：
   - **现象**：`dev:h5` 下注入全部正常，`npm run build:h5`（生产构建）产物里注入全挂
   - **根因**：定位方案最初依赖 vue-template-compiler 的 `outputSourceRange: true`——AST 每个节点
     会带 `start`/`end`（节点在模板字符串里的字符区间）。但编译器发行代码里这段计算被环境变量守卫：
     `process.env.NODE_ENV !== 'production'`。开发构建时 NODE_ENV=development → 条件成立 → 有 range；
     生产构建时 vue-cli/webpack 把构建进程的 NODE_ENV 置为 production → 条件恒为 false → range 整体
     不计算（Vue 官方的体积/性能优化：生产打包不需要这类工具性信息）→ 实测 `ast.start === undefined`，
     所有基于 range 的定位全部失效
   - **方案**：彻底不依赖 range——改按 AST **文档序遍历序**，在模板文本里顺序扫描 `<tag` 字面量
     定位插入点。AST 遍历序与文本顺序一致，每个节点"轮到"的位置就是自己的开标签；
     扫描跳过注释区，保证 dev/prod 行为完全一致
   - **验证**：回归测试里手动设 `NODE_ENV=production` 跑一遍，断言输出与 dev 逐字节相同
4. **parseComponent 默认 deindent**：剥离模板行公共缩进导致偏移错位 → `{ deindent: false }` 保原始字节
5. **模板开头空白导致 AST 错位** → 编译前自行剥离开头空白、编辑后原样拼回
6. **esbuild target 过低**：import.meta 被替换成空对象导致 CJS 产物运行时报错 → target ≥ es2020
7. **页面栈保活的曝光丢失**（见 3.3）——真实 debug 故事：现象是"返回 A 页组件不再曝光"
8. **小程序 computed 不进 WXML**（见 3.2）
9. **幂等**：uni 管线同一个 .vue 过 loader 4 次，重跑结果必须不变——已注入标记的检测
   （hasComponentIndex / 值含 `__trackClick(`）跳过；debug 报告按文件去重

## 5. 高频面试 Q&A（预备答案）

**Q：点击 key 只有 4 位，碰撞怎么办？**
A：36⁴ ≈ 168 万组合，而 key 只需在**组件内**唯一（全局唯一性由 path 保证），
几十个点击点碰撞概率可忽略；方案可扩展——需要时加长哈希位数，服务端用 event_id 幂等兜底。

**Q：上报会不会丢/重复？**
A：at-least-once 语义：发送前落盘 + 失败重试保证不丢，代价是极端情况（后台冻结拿不到回调）可能重复。
已知取舍，解法是客户端生成 event_id、服务端唯一索引去重（当前量级没做，主动说出是边界意识）。

**Q：上报端点为什么不鉴权？**
A：匿名用户（未登录）也要产生事件（曝光/点击），uid 未登录时缺省。生产化可加限流、签名或独立采集域名。

**Q：为什么槽位级标识而不是实例级？**
A：编译期注入必须是静态值，v-for 实例在构建期不存在；槽位级（同类标签序号）是编译期可静态计算的最细粒度，
实例级差异由事件载荷（组件 data）携带。这是设计取舍，不是缺陷。

**Q：为什么曝光要停留 300ms？**
A：过滤"划过不算看到"的无效曝光；跳变计时避免 ratio 连续变化重复触发。

**Q：为什么不用 computed 而用 data？**
A：小程序端 wx data 只收集组件的 data/methods，mixin 的 computed 不会进入 WXML 绑定，类绑定会一直为空。

**Q：量大之后怎么办？**
A：批量上报已把请求量降两个数量级；服务端层面 JSONB 可平滑迁到列式存储（ClickHouse）或日志管道；
SDK 侧可加 gzip、更大批量、采样。

**Q：改了模板怎么保证注入不破坏业务？**
A：外科手术式字符串插入（只插不删，其余字节不动）+ 幂等 + 44 个编译包测试（fixture 为真实页面文件）；
失败防御：模板编译失败/定位失败时原样透传 + 报告标注跳过原因，不中断构建。

**Q：webpack loader 的执行顺序？（pre / normal / inline / post）**
A：loader 分四类：`enforce('pre')` 的 pre、规则 `use` 数组里的 normal（默认）、
import 请求里 `!` 分隔的 inline、`enforce('post')` 的 post。
webpack 组装的完整链是 `[post, inline, normal, pre]`，执行分两个阶段、方向相反：
**pitch 正向（post → inline → normal → pre），normal 执行反向（pre → normal → inline → post）**；
同一段内 use 数组从右到左（后写的先执行）。pitch 返回非空会短路：右侧 loader 全部跳过、
返回值交给左侧处理——这是 vue-loader 重写请求链的机制。
**项目里用 enforce('pre') 的原因**：要在 vue-loader 处理 SFC 之前拿到原始 .vue 模板做注入——
插在 vue 规则内部不行（vue-loader 左侧拿到的是编译产物、模板已没了；右侧被 pitch 短路），
而 pre 在 normal 阶段最先执行，直接拿到磁盘原始字节，注入结果再流进 vue-loader 正常编译。

口述版（30 秒）：
「webpack 把 loader 拼成 post、inline、normal、pre 四段，pitch 从前往后、执行从后往前，
所以 pre 最先干活、post 最后收尾。我的 loader 要在 vue-loader 之前拿到原始 .vue 文件做模板注入，
插在 vue 规则里要么拿到编译产物、要么被 pitch 短路，只有 enforce('pre') 能拿到原始字节，
注入完再交给 vue-loader 正常编译。」

## 5+. 打包工具发散追问（高频方向，答"为什么/取舍"即可）

> 项目入口是 webpack loader，面试官大概率从这里发散。原则：不硬编，答原理 + 引回自己的坑。

### webpack 基础（几乎必问）

- **loader vs plugin**：loader 做模块内容转换（链式、纯函数、右到左）；plugin 参与整个构建流程
  （事件钩子，基于 tapable 的 compiler / compilation 生命周期）
- **构建流程**：初始化（合并配置、挂插件）→ 从入口递归构建 module graph（resolve → loader → parse →
  再解析依赖）→ 封装 chunk → 输出产物；每个环节都有钩子可挂
- **三种 hash**：`hash`（全量，任一文件变都变）/ `chunkhash`（按 chunk，同 chunk 内容变才变）/
  `contenthash`（按文件内容）——缓存粒度依次变细
- **HMR 原理**：devServer 用 websocket 推送变更 → 浏览器端 webpack runtime 对比模块 id →
  更新链上模块并触发 accept 回调，整页 reload 只是失败兜底
- **tree-shaking**：依赖 ESM 静态 import/export 结构 + `usedExports` 标记 + 压缩阶段消除死代码；
  `sideEffects: false` 让打包器敢删"没被引用但有副作用"的模块
- **code splitting**：动态 `import()` / SplitChunksPlugin；runtime 代码与业务/三方库分离
- **sourcemap**：eval / cheap / inline / hidden 等形态，在"定位准确度"和"构建速度/安全"间取舍

### webpack vs vite（对比题，答原理层面）

- **vite 开发态快在哪**：浏览器原生 ESM，**no-bundle**——启动不打包、改哪个编译哪个（esbuild
  单文件转译，快 1~2 个数量级）；依赖预构建（optimizeDeps 用 esbuild 把 CJS 打平）解决请求瀑布
- **vite 生产**：换 Rollup 打包（成熟插件生态、稳定 tree-shaking）
- **webpack 强在哪**：全量打包的确定性、loader/plugin 生态最全、配置粒度细；
  uni-app Vue2 / vue-cli 生态深度绑定 webpack（小程序编译链是 uni 自研的 webpack 插件体系）
- **我们的项目为什么 webpack**：uni-app Vue2 生态就是 vue-cli + webpack 的天下，vite 版 uni 主要
  面向 Vue3；何况我们要写 loader 注入模板，webpack 的 loader 链正好是注入点
- **esbuild / swc / babel**：esbuild（Go）与 swc（Rust）是转译器（不做类型检查），快 10~100 倍；
  babel 慢但插件生态最全。可聊：编译走 esbuild、类型检查走 tsc 的现代组合

### 就着 loader 追问（项目内，安全区）

- **loader 上下文 this 上有什么**：`resourcePath`（模块路径）、`query`（options）、`async()`、
  `emitWarning/emitError`、`cacheable()`——我的 loader 用 resourcePath 做 include/exclude 匹配
- **为什么用 vue-template-compiler 而不是 @vue/compiler-sfc**：项目是 Vue2，前者是 Vue2 的官方模板
  编译器，API（parseComponent + compile 出 AST）正好满足注入需求
- **构建性能怎么做**：注入是 O(模板长度) 的字符串扫描，量级可忽略；幂等设计让同一文件被处理多次
  结果不变；更进一步可以加 cache-loader / webpack 5 持久化缓存
- **如果迁移 vite 怎么办**：loader 换成 plugin 的 `transform` 钩子（对 .vue 源做同样变换），
  `this.parse` 换成按需引编译器——注入逻辑（transform.ts）本身与打包器无关，可直接复用
- **小程序编译链**：uni 把 Vue 模板编译成 wxml + 生成页面 json 配置、分包规则，H5 则走 DOM
  ——我的 SDK 用 uni 的 API 层（IntersectionObserver/request/storage）把差异抹平了

## 6. 技术栈

- 语言/工程：TypeScript（strict）、pnpm workspace monorepo、vitest（73 个单测）
- 编译侧：webpack 5 loader、webpack-chain、vue-template-compiler（Vue2）
- 运行侧：Vue2 插件/mixin、uni-app API（IntersectionObserver / request / storage，跨 H5 + 微信小程序）
- 服务端：Express + PostgreSQL（JSONB 存载荷，多行批量 INSERT）
- 消费方：uni-app Vue2 商城（vue-cli 5），`file:` 协议本地联调

## 7. 项目数据

- 3 个 SDK 包 + 1 个服务端接入点，8 个功能 commit
- 73 个单测全绿（编译包 44 + 运行时包 29）、TS 严格模式 typecheck 干净
- 编译包注入幂等（同文件 4 次过 loader 结果不变），dev/prod 行为一致（有回归测试）
- 已在微信小程序真机环境验证曝光链路落库

## 8. 已知边界（主动提及显成熟）

- 上报 at-least-once 可能重复（无 event_id 幂等）→ 后续方案已想好
- 上报端点无鉴权/限流（当前开发环境取舍）
- 点击 hash 4 位（当前量级够用，可扩展）
- 事件查询/分析接口未做（只落库）
- 内存队列崩溃恢复依赖 storage 备份（已做），但 storage 写满/损坏有防御

## 8+. 规模化演进（主动聊出"懂行"，字节面试官吃这套）

> 场景话术：「现在这个量级（开发/内测）单机 PG 直接写就够了；如果做到千万日活，
> 我会按下面这条线演进」——**主动提出比被追问被动回答强一个档次**。

### 事件量估算（先算账，显专业）

千万日活 × 人均 20 事件/天 ≈ **2 亿事件/天**，按 8 小时活跃折算峰值 QPS 过万——
单机直写数据库会挂，必须分层。

### 链路分层演进

```
客户端（已有）        服务端（演进方向）
─────────────        ─────────────────────────────
本地队列/批量/退避  →  接入层：独立上报服务 + 网关
                       （限流、签名防刷——公开端点必须做）
                    →  削峰：事件直接进消息队列（Kafka），不直写库
                       （写放大、峰值容错、消费者可重放）
                    →  存储：列式存储 ClickHouse（事件分析场景：
                       高写入吞吐、按列聚合快）或对象存储+离线数仓
                    →  分析：实时 Flink 窗口聚合 + 离线 T+1 数仓
```

### 采样（控制成本的标准手段）

- 按事件类型分级：点击/购买全量，曝光/滑动按比例采样（如 10%）
- 采样率动态下发（配置中心）：大促期间调低采样保住关键事件
- 我的项目已具备的基础：事件在客户端就已结构化（eventType 可分类），采样逻辑加在 enqueue 前即可

### 事件模型（体现设计意识）

- 事件三要素：Who（uid/设备标识）、When（timestamp）、What（eventType + eventPath + payload）
- **公共上下文 vs 事件级字段分离**：platform 已提升到批次层，多端时钟偏差用服务端时间兜底
  （`COALESCE(to_timestamp(客户端), now())` 已实现）——这条可以直接讲，是现成的
- event_id + 服务端幂等：补齐 at-least-once 的重复问题（当前已知边界，演进第一步）
- 字段字典/schema 治理：eventPath 就是天然的事件字典，报表侧用它做聚合维度

### 字节语境的自检题（面试官可能反手就问）

- 「漏报率怎么衡量？」→ 客户端定时发"心跳标杆事件"，服务端对账计数，差值即漏报率
- 「埋点怎么配合 A/B 测试？」→ 实验分组 ID 作为事件公共字段（类似 uid 的挂载方式），
  报表按 groupId 分流对比转化率
- 「实时看板怎么做？」→ 事件进 MQ → Flink 窗口聚合 → 结果写 Redis/时序库 → 看板订阅
- 「多端同一事件怎么保证口径一致？」→ 我的答案：path 体系统一事件身份（H5/MP 同一按钮
  同一 eventPath），这是这个 SDK 的核心设计之一

## 9. 讲述建议

**1 分钟版**（开场）：全自动埋点 SDK 闭环 → 编译期 loader 注入三类标记 → 运行时 mixin 用
$parent 链算组件路径、IntersectionObserver 做曝光（300ms 停留 + 页面栈保活修复）、点击包装进
统一 $track → 本地队列批量上报（失败指数退避、storage 持久化补发）→ 服务端多行 INSERT 落库。
业务接入成本：一行 Vue.use。

**5 分钟版**：以上 + 挑 2~3 个坑讲故事（推荐 #1 vue-loader pitch、#3 生产构建无 source range、
#7 页面栈保活曝光 bug），每个都按现象→根因→方案→验证讲。结尾主动带一句规模化演进
（见 8+ 节：消息队列削峰 / 采样 / 事件模型），把面试官往你准备好的方向引。

**关键词自检**：槽位级身份 / 幂等注入 / 幂等重试 / at-least-once / 指数退避 /
组件级 IntersectionObserver / 页面生命周期 / JSONB 批量写入 / dev-prod 一致性 /
采样 / 削峰 / 事件模型 / 漏报对账 / A-B 分流。
