/**
 * 双半体构建（复刻官方 packages/client/tsdown.client.ts 的产物契约）：
 *
 *  1. node 半体：src/index.ts → lib/index.mjs（ESM）。Loader 按
 *     cordis.patch.yml 的行加载它。
 *  2. 浏览器半体：src/client/index.ts → lib/client.js（CJS 闭包工厂）。
 *     产物形如：
 *       window.__ModuleLoader__.load({ id: "dsh-skills",
 *         factory: (require) => { …body…; return module.exports; } });
 *     require 只允许命中 shell 的平台种子模块表（react、cordis、
 *     ui-slots 等）；其余一切（本插件自身代码与 React 组件）内联。
 */
import { defineConfig } from 'tsdown'

/** 平台种子模块表（与官方 web/src/platform.ts 的 PLATFORM_MODULES 一致）。 */
const SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

export default defineConfig([
  {
    name: 'dsh-skills',
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    outputOptions: {
      entryFileNames: 'index.mjs',
    },
  },
  {
    name: 'dsh-skills/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: false,
    clean: false,
    external: [...SEED_MODULES],
    noExternal: (id: string): boolean | undefined =>
      (SEED_MODULES as readonly string[]).includes(id) ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-skills", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
