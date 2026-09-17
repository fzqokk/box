#!/usr/bin/env node
/**
 * uni-app x 运行时补丁：修复 wx.cloud 在新基础库下丢失的问题。
 *
 * 背景：unpackage/dist/dev/mp-weixin/common/vendor.js 的 initWx() 用
 * for...in 枚举原 wx 的可枚举属性构建代理对象并替换全局 wx；新版基础库
 * 中 wx.cloud 为不可枚举属性，枚举不到，导致全局 wx.cloud === undefined
 * （uni-app x 白名单 objectKeys 里本就有 "cloud"，属枚举机制的遗漏）。
 *
 * 补丁：在 initWx 内强制透传 ["cloud"]（若代理对象缺失且原对象存在）。
 *
 * 用法：
 *   node scripts/patch-wx-cloud.js           # 对当前编译产物执行一次补丁
 *   node scripts/patch-wx-cloud.js --watch   # 常驻监听，每次编译后自动补丁
 */
const fs = require('fs')
const path = require('path')

const VENDOR = path.join(__dirname, '..', 'unpackage', 'dist', 'dev', 'mp-weixin', 'common', 'vendor.js')
const NEEDLE = 'if (typeof globalThis !== "undefined" && typeof requireMiniProgram === "undefined") {'
const MARK = '__wx_cloud_patched__'
const INJECT = '["cloud"].forEach((ck) => { if (newWx[ck] === undefined && typeof wx[ck] !== "undefined") { newWx[ck] = wx[ck]; } });\n  '

function patchOnce() {
  if (!fs.existsSync(VENDOR)) {
    console.log('[patch] vendor.js 不存在，等待 HBuilderX 编译产物...')
    return false
  }
  const src = fs.readFileSync(VENDOR, 'utf8')
  if (src.includes(MARK)) {
    console.log('[patch] 补丁已存在，跳过')
    return true
  }
  if (!src.includes(NEEDLE)) {
    console.log('[patch] 未找到 initWx 注入点（可能是发行模式压缩产物），跳过')
    return false
  }
  fs.writeFileSync(VENDOR, src.replace(NEEDLE, MARK + '\n  ' + INJECT + NEEDLE))
  console.log('[patch] 已注入 wx.cloud 透传补丁 ✓')
  return true
}

if (process.argv.includes('--watch')) {
  console.log('[patch] watch 模式：每 2 秒检查一次编译产物')
  let lastMtime = 0
  setInterval(() => {
    try {
      if (!fs.existsSync(VENDOR)) return
      const mtime = fs.statSync(VENDOR).mtimeMs
      if (mtime !== lastMtime) {
        lastMtime = mtime
        patchOnce()
      }
    } catch (e) {
      console.log('[patch] 出错：', e.message)
    }
  }, 2000)
} else {
  process.exit(patchOnce() ? 0 : 1)
}
