#!/usr/bin/env node
/**
 * 编译后处理脚本（HBuilderX 不支持的收尾工作全在这里）：
 * 1. 修复 uni-app x 运行时丢失 wx.cloud 的问题：
 *    vendor.js 的 initWx() 用 for...in 枚举构建 wx 代理并替换全局 wx，
 *    新基础库中 wx.cloud 为不可枚举属性导致丢失。补丁强制透传 ["cloud"]。
 * 2. 把根目录 cloudfunctions/（排除 node_modules）复制进 dist，
 *    使微信开发者工具能在 dist 项目窗口里直接上传部署云函数。
 *
 * 用法：
 *   node scripts/patch-wx-cloud.js           # 执行一次
 *   node scripts/patch-wx-cloud.js --watch   # 常驻监听，编译后自动执行
 */
const fs = require('fs')
const path = require('path')

const DIST = path.join(__dirname, '..', 'unpackage', 'dist', 'dev', 'mp-weixin')
const VENDOR = path.join(DIST, 'common', 'vendor.js')
const SRC_CLOUD = path.join(__dirname, '..', 'cloudfunctions')
const DEST_CLOUD = path.join(DIST, 'cloudfunctions')

const NEEDLE = 'if (typeof globalThis !== "undefined" && typeof requireMiniProgram === "undefined") {'
const MARK = '__wx_cloud_patched__'
const INJECT = '["cloud"].forEach((ck) => { if (newWx[ck] === undefined && typeof wx[ck] !== "undefined") { newWx[ck] = wx[ck]; } });\n  '

function patchVendor() {
  if (!fs.existsSync(VENDOR)) {
    console.log('[postbuild] vendor.js 不存在，等待 HBuilderX 编译产物...')
    return
  }
  const src = fs.readFileSync(VENDOR, 'utf8')
  if (src.includes(MARK)) {
    console.log('[postbuild] wx.cloud 补丁已存在，跳过')
    return
  }
  if (!src.includes(NEEDLE)) {
    console.log('[postbuild] 未找到 initWx 注入点（可能是发行模式压缩产物），跳过补丁')
    return
  }
  fs.writeFileSync(VENDOR, src.replace(NEEDLE, MARK + '\n  ' + INJECT + NEEDLE))
  console.log('[postbuild] 已注入 wx.cloud 透传补丁 ✓')
}

function maxMtime(dir) {
  let m = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const name of fs.readdirSync(cur)) {
      if (name === 'node_modules') continue
      const full = path.join(cur, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) stack.push(full)
      else if (st.mtimeMs > m) m = st.mtimeMs
    }
  }
  return m
}

function copyCloudFunctions(force) {
  if (!fs.existsSync(SRC_CLOUD)) return
  const srcM = maxMtime(SRC_CLOUD)
  const destM = fs.existsSync(DEST_CLOUD) ? maxMtime(DEST_CLOUD) : -1
  if (!force && destM >= srcM && fs.existsSync(DEST_CLOUD)) {
    console.log('[postbuild] cloudfunctions 已是最新，跳过复制')
    return
  }
  fs.rmSync(DEST_CLOUD, { recursive: true, force: true })
  fs.cpSync(SRC_CLOUD, DEST_CLOUD, {
    recursive: true,
    filter: (s) => !s.includes('node_modules')
  })
  console.log('[postbuild] 已复制 cloudfunctions 到 dist ✓')
}

function runAll(force) {
  patchVendor()
  copyCloudFunctions(force)
}

if (process.argv.includes('--watch')) {
  console.log('[postbuild] watch 模式：每 2 秒检查一次编译产物与云函数源码')
  let lastVendor = 0
  let lastSrc = 0
  setInterval(() => {
    try {
      const vendorM = fs.existsSync(VENDOR) ? fs.statSync(VENDOR).mtimeMs : 0
      const srcM = fs.existsSync(SRC_CLOUD) ? maxMtime(SRC_CLOUD) : 0
      if (vendorM !== lastVendor) {
        lastVendor = vendorM
        patchVendor()
        if (vendorM !== 0) copyCloudFunctions(true)
      } else if (srcM !== lastSrc) {
        lastSrc = srcM
        copyCloudFunctions(true)
      }
    } catch (e) {
      console.log('[postbuild] 出错：', e.message)
    }
  }, 2000)
} else {
  runAll(false)
}
