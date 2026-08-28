import { nodeResolve } from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'

/**
 * 运行时包跑在浏览器 / 小程序 webview 里，经业务侧打包器消费，出 ESM + CJS。
 * vue 是 optional peerDependency，不进产物；@ddmc/track-shared 是纯常量，打进产物。
 * target es2018：uni-app 项目的 browserslist 是 Android >= 4.4，接入 MP 端时
 * 需将本包加入 vue.config.js 的 transpileDependencies 再降级。
 */
const external = ['vue']

export default {
  input: 'src/index.ts',
  external,
  plugins: [nodeResolve({ extensions: ['.ts', '.mjs', '.js'] }), esbuild({ target: 'es2018' })],
  output: [
    { file: 'dist/index.mjs', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' },
  ],
}
