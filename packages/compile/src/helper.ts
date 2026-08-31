/**
 * vue.config.js 一行接入（webpack-chain）：
 *
 *   const { configureTrackLoader } = require('@ddmc/track-compile')
 *   module.exports = {
 *     chainWebpack(config) {
 *       configureTrackLoader(config, { debug: true })
 *     }
 *   }
 *
 * 实现说明：以 enforce('pre') 的独立规则注入，保证在 vue 规则之前拿到 .vue 原始源码。
 * 不能插进 vue 规则内部——vue-loader 15 的 pitch 会先处理 SFC 并短路，
 * 排在它左侧的 loader 拿到的已是编译产物（无 template），排在右侧则根本不会执行。
 */
import { createRequire } from 'module'
import type { CompileOptions } from './options'

/** webpack-chain 的最小类型面（避免依赖 webpack-chain 类型包） */
export interface ChainConfig {
  module: {
    rule(name: string): ChainRule
  }
}
export interface ChainRule {
  test(regex: RegExp): ChainRule
  enforce(value: 'pre'): ChainRule
  use(name: string): ChainUse
}
export interface ChainUse {
  loader(path: string): ChainUse
  options(options: unknown): ChainUse
}

export function configureTrackLoader(config: ChainConfig, options: CompileOptions = {}) {
  // 走包名自引用（exports 的 require 条件），保证 ESM/CJS 消费场景都解析到 dist/loader.cjs
  const nodeRequire = createRequire(import.meta.url)
  config.module
    .rule('ddmc-track')
    .test(/\.vue$/)
    .enforce('pre')
    .use('ddmc-track-loader')
    .loader(nodeRequire.resolve('@ddmc/track-compile/loader'))
    .options(options)
}
