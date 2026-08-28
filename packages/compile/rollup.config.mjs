import { nodeResolve } from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'

/**
 * 编译时包运行在 Node 构建管线里，只出 ESM + CJS（无浏览器 UMD）。
 * vue-template-compiler 由消费方提供（peerDependency），不打包进产物；
 * @ddmc/track-shared 是纯常量，用 nodeResolve 打进产物避免安装顺序问题。
 * target es2020：保住 import.meta（es2018 会被 esbuild 替换成空对象，CJS 产物运行时炸）。
 */
const external = ['vue-template-compiler']

function makeEntry(input, name) {
  return {
    input,
    external,
    plugins: [nodeResolve({ extensions: ['.ts', '.mjs', '.js'] }), esbuild({ target: 'es2020' })],
    output: [
      { file: `dist/${name}.mjs`, format: 'es', sourcemap: true },
      { file: `dist/${name}.cjs`, format: 'cjs', sourcemap: true, exports: 'named' },
    ],
  }
}

export default [makeEntry('src/index.ts', 'index'), makeEntry('src/loader.ts', 'loader')]
