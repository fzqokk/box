# 店铺宣传小程序实施计划（V1.0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 PRD V1.1（`docs/superpowers/specs/2026-09-17-store-promotion-prd.md`）实现店铺宣传微信小程序：顾客端展示套餐/季度活动/门店信息 + 本机打卡 + 分享海报，内置管理端（微信自带登录 + openid 白名单）。

**Architecture:** 全部数据访问走两个云函数（`data` 公开读 / `admin` 写 + 白名单校验），云数据库权限全部关闭直连（读写均只经云函数），杜绝越权。云函数统一返回 `{ code, message?, data }` 信封，云函数内把数据库 snake_case 字段映射为客户端 camelCase，并服务端批量把 `cloud://` fileID 转成临时 https 链接。打卡记录仅存本机 storage。

**Tech Stack:** uni-app x（uvue/uts，HBuilderX 运行到微信开发者工具）+ 微信云开发（云函数 Node.js + wx-server-sdk，jest 单测）。

---

## 前置条件（开始前人工确认）

- 已注册微信小程序账号并拿到 **AppID**（云开发必须正式 AppID，测试号不支持）。
- 已安装 **HBuilderX**（4.x，支持 uni-app x）与**微信开发者工具**（已开启“设置-安全-服务端口”，HBuilderX 中已配置其安装路径）。
- 微信开发者工具中已登录、可导入项目。

## 与 PRD 的实施差异说明（已在计划内明确，不阻塞）

1. tabBar 采用纯文字样式（微信允许无图标 tabBar）；图标留待上线前美化，不影响功能。
2. 套餐参数与图文块的排序采用「上移/下移」按钮实现（uvue 下拖拽成本高，功能等价）。
3. 内容安全：文本走 `security.msgSecCheck` 同步拦截；图片机审（mediaCheckAsync）需配置消息推送回调，V1 以“文本拦截 + 店主素材合规承诺（PRD 7.4）”替代，V1.1 增强。
4. `store_info` 增加 `qrcode_image` 字段（店铺小程序码图片 fileID），供海报绘制使用（PRD 5.3“预置上传”的落地方式）。

## 文件结构

```
etiniabox/
├── manifest.json                      # 修改：AppID、cloudfunctionRoot
├── pages.json                         # 重写：10 页面 + tabBar
├── App.uvue                           # 修改：onLaunch 初始化云开发
├── utils/
│   ├── config.uts                     # 云环境 ID 常量
│   ├── cloud.uts                      # 全部数据服务层（顾客端 + 管理端）
│   └── checkin.uts                    # 打卡本机逻辑（纯函数）
├── pages/
│   ├── index/index.uvue               # 首页 Tab
│   ├── package/list.uvue              # 套餐 Tab（兼管理列表）
│   ├── package/detail.uvue            # 套餐详情
│   ├── checkin/checkin.uvue           # 打卡 Tab
│   ├── about/about.uvue               # 门店 Tab（含管理入口）
│   ├── campaign/detail.uvue           # 季度活动详情
│   └── admin/
│       ├── index.uvue                 # 管理首页（活动列表 + 导航）
│       ├── package-edit.uvue          # 套餐新建/编辑
│       ├── campaign-edit.uvue         # 活动新建/编辑
│       └── store-info.uvue            # 门店信息维护
├── components/poster-popup.uvue       # 分享海报弹层（canvas 合成）
└── cloudfunctions/
    ├── data/                          # 公开读：getOpenId/getStoreInfo/listPackages/
    │   ├── index.js                   #   getPackage/listCampaigns/getCampaign/getTempUrls
    │   ├── package.json
    │   └── test/index.test.js
    └── admin/                         # 管理写：checkAdmin/两套 CRUD/状态切换/门店保存
        ├── index.js
        ├── package.json
        └── test/index.test.js
```

---

### Task 1: Git 初始化与基线提交

**Files:**
- Create: `.gitignore`（追加条目）

- [ ] **Step 1: 初始化仓库**

```bash
git init
```

- [ ] **Step 2: 确认 .gitignore 覆盖构建产物与依赖**

在 `.gitignore` 末尾确保存在以下行（缺则追加）：

```
unpackage/
node_modules/
cloudfunctions/**/node_modules/
```

- [ ] **Step 3: 基线提交**

```bash
git add -A && git commit -m "chore: uni-app x 脚手架基线"
```

预期：`git log --oneline` 显示 1 条提交。

---

### Task 2: 云开发环境准备与小程序初始化

**Files:**
- Create: `utils/config.uts`
- Modify: `manifest.json`（mp-weixin 节点）
- Modify: `App.uvue`（onLaunch 内初始化）

- [ ] **Step 1: 开通云开发并创建环境（人工操作）**

微信开发者工具 → 云开发 → 开通 → 创建环境（名称 `etiniabox-prod`，选择免费额度/按量付费）→ 复制**环境 ID**（形如 `etiniabox-prod-3g1a2b4c5d`）。

- [ ] **Step 2: 创建数据库集合并导入预置数据（人工操作）**

云开发控制台 → 数据库 → 依次创建集合：`packages`、`campaigns`、`store_info`、`admin_config`（权限选默认「仅创建者可读写」即可——所有读写都经云函数，客户端直连被计划性禁用）。
在 `admin_config` 集合先建占位文档：`{ "_id": "main", "openids": [] }`。

- [ ] **Step 3: 写入环境 ID 常量**

创建 `utils/config.uts`：

```uts
/** 云开发环境 ID：Task 2 Step 1 创建环境后粘贴到这里 */
export const CLOUD_ENV_ID = '在此填入你的云环境ID'
```

- [ ] **Step 4: manifest.json 配置 AppID 与云函数目录**

`manifest.json` 的 `mp-weixin` 节点改为（appid 换成自己的）：

```json
"mp-weixin" : {
    "appid" : "wx1234567890abcdef",
    "cloudfunctionRoot" : "cloudfunctions/",
    "setting" : { "urlCheck" : false },
    "usingComponents" : true
}
```

- [ ] **Step 5: App.uvue 初始化云开发**

把 `App.uvue` 的 `onLaunch` 改为：

```uts
	onLaunch(() => {
		// #ifdef MP-WEIXIN
		wx.cloud.init({
			env: CLOUD_ENV_ID,
			traceUser: false // 不记录用户访问信息，配合“不采集个人信息”承诺
		})
		// #endif
	})
```

并在 `App.uvue` 的 `<script setup lang="uts">` 顶部加：

```uts
	import { CLOUD_ENV_ID } from './utils/config.uts'
```

- [ ] **Step 6: 编译验证**

HBuilderX → 运行 → 运行到小程序模拟器 → 微信开发者工具。
预期：编译成功，模拟器显示脚手架首页，开发者工具 Console 无 `wx.cloud` 相关报错。
（若报 `wx.cloud` 类型错误：在 `App.uvue` 中把 `wx.cloud.init({...})` 整体保持 `#ifdef MP-WEIXIN` 条件编译内并给参数对象加 `as any` 断言后重试。）

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "chore: 初始化微信云开发环境配置"
```

---

### Task 3: data 云函数（TDD）

**Files:**
- Create: `cloudfunctions/data/package.json`
- Create: `cloudfunctions/data/index.js`
- Create: `cloudfunctions/data/test/index.test.js`

- [ ] **Step 1: 初始化云函数工程**

`cloudfunctions/data/package.json`：

```json
{
  "name": "data",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "wx-server-sdk": "~2.6.3" },
  "devDependencies": { "jest": "^29.7.0" },
  "scripts": { "test": "jest" }
}
```

- [ ] **Step 2: 写失败测试**

`cloudfunctions/data/test/index.test.js`：

```js
const mockDb = { collection: jest.fn() }
const mockCloud = {
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'DYNAMIC',
  getWXContext: jest.fn(),
  database: jest.fn(() => mockDb),
  getTempFileURL: jest.fn(),
  openapi: {}
}
jest.mock('wx-server-sdk', () => mockCloud)
const { main } = require('../index')

function chainGet(result) {
  const chain = {
    where: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    get: jest.fn(async () => result)
  }
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCloud.getWXContext.mockReturnValue({ OPENID: 'user-1' })
})

test('getOpenId 返回调用者 openid', async () => {
  const res = await main({ action: 'getOpenId' }, {})
  expect(res.code).toBe(0)
  expect(res.data.openid).toBe('user-1')
})

test('listPackages 过滤上架且未删除，映射为 camelCase 并带临时链接', async () => {
  mockDb.collection.mockImplementation((name) => {
    expect(name).toBe('packages')
    return chainGet({
      data: [
        { _id: 'p1', name: '清新写真', cover_image: 'cloud://c1', summary: 's', price_display: '￥299 起',
          params: [{ param_name: '拍摄时长', param_value: '60分钟' }], detail_images: [], is_featured: true, sort: 1, status: 'upper', deleted: false }
      ]
    })
  })
  mockCloud.getTempFileURL.mockResolvedValue({ fileList: [{ fileID: 'cloud://c1', tempFileURL: 'https://t/c1' }] })
  const res = await main({ action: 'listPackages' }, {})
  expect(res.code).toBe(0)
  expect(res.data.length).toBe(1)
  expect(res.data[0]).toMatchObject({ id: 'p1', name: '清新写真', coverImageUrl: 'https://t/c1' })
  expect(res.data[0].params[0]).toEqual({ paramName: '拍摄时长', paramValue: '60分钟' })
})

test('getPackage 对下架/不存在返回 404', async () => {
  mockDb.collection.mockImplementation(() => ({
    doc: () => ({ get: jest.fn(async () => { throw new Error('document.get:fail') }) })
  }))
  const res = await main({ action: 'getPackage', payload: { id: 'nope' } }, {})
  expect(res.code).toBe(404)
})

test('listCampaigns 计算 expired 标记', async () => {
  mockDb.collection.mockImplementation(() => chainGet({
    data: [
      { _id: 'c1', title: '暑期活动', season: '2026-Q3', banner_image: '', description_blocks: [],
        start_date: '2020-01-01', end_date: '2020-12-31', sort: 1, status: 'upper', deleted: false },
      { _id: 'c2', title: '当季活动', season: '2099-Q3', banner_image: '', description_blocks: [],
        start_date: '2099-01-01', end_date: '2099-12-31', sort: 2, status: 'upper', deleted: false }
    ]
  }))
  const res = await main({ action: 'listCampaigns' }, {})
  expect(res.data[0].expired).toBe(true)
  expect(res.data[1].expired).toBe(false)
})

test('未知 action 返回错误', async () => {
  const res = await main({ action: 'nope' }, {})
  expect(res.code).toBe(400)
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd cloudfunctions/data && npm i && npx jest
```

预期：FAIL（`Cannot find module '../index'` 或断言失败）。

- [ ] **Step 4: 实现 data 云函数**

`cloudfunctions/data/index.js`：

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ok = (data) => ({ code: 0, data })
const fail = (code, message) => ({ code, message })

/** 北京时间 YYYY-MM-DD */
function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

/** 批量把 cloud:// fileID 换成临时 https 链接 */
async function toUrls(fileIds) {
  const ids = (fileIds || []).filter((id) => typeof id === 'string' && id.startsWith('cloud://'))
  if (!ids.length) return {}
  const res = await cloud.getTempFileURL({ fileIdList: [...new Set(ids)] })
  const map = {}
  for (const f of res.fileList) if (f.status === 0) map[f.fileID] = f.tempFileURL
  return map
}

function mapPackage(doc, urls) {
  return {
    id: doc._id,
    name: doc.name || '',
    coverImage: doc.cover_image || '',
    coverImageUrl: urls[doc.cover_image] || '',
    summary: doc.summary || '',
    priceDisplay: doc.price_display || '',
    params: (doc.params || []).map((p) => ({ paramName: p.param_name, paramValue: p.param_value })),
    detailImages: doc.detail_images || [],
    detailImageUrls: (doc.detail_images || []).map((id) => urls[id] || ''),
    isFeatured: !!doc.is_featured,
    sort: doc.sort || 0,
    status: doc.status || 'upper'
  }
}

function mapCampaign(doc, urls) {
  const today = todayStr()
  return {
    id: doc._id,
    title: doc.title || '',
    season: doc.season || '',
    bannerImage: doc.banner_image || '',
    bannerImageUrl: urls[doc.banner_image] || '',
    descriptionBlocks: (doc.description_blocks || []).map((b) => ({
      type: b.type, text: b.text || '',
      image: b.image || '', imageUrl: urls[b.image] || ''
    })),
    startDate: doc.start_date || '',
    endDate: doc.end_date || '',
    sort: doc.sort || 0,
    status: doc.status || 'upper',
    expired: !!(doc.end_date && doc.end_date < today)
  }
}

function mapStoreInfo(doc, urls) {
  return {
    storeName: doc.store_name || '',
    logo: doc.logo || '',
    logoUrl: urls[doc.logo] || '',
    intro: doc.intro || '',
    photos: doc.photos || [],
    photoUrls: (doc.photos || []).map((id) => urls[id] || ''),
    businessHours: doc.business_hours || '',
    address: doc.address || '',
    longitude: doc.longitude || 0,
    latitude: doc.latitude || 0,
    contactPhone: doc.contact_phone || '',
    qrcodeImage: doc.qrcode_image || '',
    qrcodeImageUrl: urls[doc.qrcode_image] || ''
  }
}

async function getDocById(col, id) {
  try {
    const res = await db.collection(col).doc(id).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  const action = event.action
  const payload = event.payload || {}
  try {
    switch (action) {
      case 'getOpenId':
        return ok({ openid: cloud.getWXContext().OPENID })

      case 'getStoreInfo': {
        const doc = await getDocById('store_info', 'main')
        if (!doc) return ok(null)
        const urls = await toUrls([doc.logo, ...(doc.photos || []), doc.qrcode_image])
        return ok(mapStoreInfo(doc, urls))
      }

      case 'listPackages': {
        const res = await db.collection('packages')
          .where({ status: 'upper', deleted: false })
          .orderBy('sort', 'asc').orderBy('updated_at', 'desc').limit(50).get()
        const docs = res.data || []
        const urls = await toUrls(docs.flatMap((d) => [d.cover_image, ...(d.detail_images || [])]))
        return ok(docs.map((d) => mapPackage(d, urls)))
      }

      case 'getPackage': {
        const doc = await getDocById('packages', payload.id)
        if (!doc || doc.status !== 'upper' || doc.deleted) return fail(404, '该套餐已下架或不存在')
        const urls = await toUrls([doc.cover_image, ...(doc.detail_images || [])])
        return ok(mapPackage(doc, urls))
      }

      case 'listCampaigns': {
        const res = await db.collection('campaigns')
          .where({ status: 'upper', deleted: false })
          .orderBy('sort', 'asc').limit(10).get()
        const docs = res.data || []
        const urls = await toUrls(docs.map((d) => d.banner_image))
        return ok(docs.map((d) => mapCampaign(d, urls)))
      }

      case 'getCampaign': {
        const doc = await getDocById('campaigns', payload.id)
        if (!doc || doc.status !== 'upper' || doc.deleted) return fail(404, '活动不存在')
        const urls = await toUrls([doc.banner_image, ...(doc.description_blocks || []).map((b) => b.image)])
        return ok(mapCampaign(doc, urls))
      }

      default:
        return fail(400, '未知 action: ' + action)
    }
  } catch (e) {
    return fail(500, e.message || '服务异常')
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd cloudfunctions/data && npx jest
```

预期：5 个测试全部 PASS。

- [ ] **Step 6: 部署并在小程序侧冒烟验证**

1. HBuilderX 重新「运行到微信开发者工具」。
2. 若开发者工具左侧文件树没有 `cloudfunctions` 目录：把项目根 `cloudfunctions/` 复制到 `unpackage/dist/dev/mp-weixin/` 下，并确认 dist 的 `project.config.json` 含 `"cloudfunctionRoot": "cloudfunctions/"`（没有则手动加上），刷新工具。
3. 右键 `cloudfunctions/data` → 「上传并部署：云端安装依赖（不上传 node_modules）」。
4. 在开发者工具「调试器-Console」执行：

```js
wx.cloud.callFunction({ name: 'data', data: { action: 'getOpenId' } }).then(console.log)
```

预期：输出 `{ code: 0, data: { openid: "o..." } }`。**记下这个 openid，Task 4 需要用。**

- [ ] **Step 7: 提交**

```bash
git add cloudfunctions/data && git commit -m "feat: data 云函数（公开读接口 + fileID 转链）"
```

---

### Task 4: admin 云函数（TDD）与管理员白名单

**Files:**
- Create: `cloudfunctions/admin/package.json`
- Create: `cloudfunctions/admin/index.js`
- Create: `cloudfunctions/admin/test/index.test.js`

- [ ] **Step 1: 初始化工程**

`cloudfunctions/admin/package.json`（与 data 相同结构，`"name": "admin"`）：

```json
{
  "name": "admin",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "wx-server-sdk": "~2.6.3" },
  "devDependencies": { "jest": "^29.7.0" },
  "scripts": { "test": "jest" }
}
```

- [ ] **Step 2: 写失败测试**

`cloudfunctions/admin/test/index.test.js`：

```js
const mockDb = { collection: jest.fn() }
const mockCloud = {
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'DYNAMIC',
  getWXContext: jest.fn(),
  database: jest.fn(() => mockDb),
  getTempFileURL: jest.fn(),
  openapi: { security: { msgSecCheck: jest.fn() } }
}
jest.mock('wx-server-sdk', () => mockCloud)
const { main } = require('../index')

/** 构造 admin_config + 业务集合的通用 mock */
function setupDb({ adminOpenids = ['admin-1'], adminGetFails = false, storeDoc = null, storeGetFails = true } = {}) {
  const docObj = {
    get: jest.fn(),
    update: jest.fn(async () => ({ stats: { updated: 1 } })),
    set: jest.fn(async () => ({}))
  }
  const addMock = jest.fn(async () => ({ _id: 'new-id' }))
  mockDb.collection.mockImplementation((name) => {
    if (name === 'admin_config') {
      docObj.get.mockImplementation(async () => {
        if (adminGetFails) throw new Error('not exist')
        return { data: { openids: adminOpenids } }
      })
    } else if (name === 'store_info') {
      docObj.get.mockImplementation(async () => {
        if (storeGetFails) throw new Error('not exist')
        return { data: storeDoc }
      })
    } else {
      // packages / campaigns：get 返回不存在（编辑场景在 UI 上另行处理）
      docObj.get.mockImplementation(async () => { throw new Error('not exist') })
    }
    return { doc: () => docObj, add: addMock }
  })
  return { docObj, addMock }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCloud.getWXContext.mockReturnValue({ OPENID: 'admin-1' })
  mockCloud.openapi.security.msgSecCheck.mockResolvedValue({ result: { suggest: 'pass' } })
})

test('checkAdmin：白名单内返回 true', async () => {
  setupDb()
  const res = await main({ action: 'checkAdmin' }, {})
  expect(res.data.isAdmin).toBe(true)
})

test('checkAdmin：白名单外返回 false 且不报错', async () => {
  mockCloud.getWXContext.mockReturnValue({ OPENID: 'stranger' })
  setupDb()
  const res = await main({ action: 'checkAdmin' }, {})
  expect(res.data.isAdmin).toBe(false)
})

test('非白名单用户调用写操作返回 403', async () => {
  mockCloud.getWXContext.mockReturnValue({ OPENID: 'stranger' })
  setupDb()
  const res = await main({ action: 'savePackage', payload: { name: 'x' } }, {})
  expect(res.code).toBe(403)
})

test('savePackage：缺名称被拒绝且不落库', async () => {
  setupDb()
  const res = await main({ action: 'savePackage', payload: { name: '  ', coverImage: 'cloud://c', params: [{ paramName: 'a', paramValue: 'b' }] } }, {})
  expect(res.code).toBe(400)
  expect(res.message).toBe('套餐名称不能为空')
})

test('savePackage：合法数据映射为 snake_case 并落库', async () => {
  const { addMock } = setupDb()
  const res = await main({
    action: 'savePackage',
    payload: {
      name: '清新写真', coverImage: 'cloud://c', summary: 's', priceDisplay: '￥299 起',
      params: [{ paramName: '拍摄时长', paramValue: '60分钟' }],
      detailImages: [], isFeatured: true, sort: 1, status: 'upper'
    }
  }, {})
  expect(res.code).toBe(0)
  expect(res.data.id).toBe('new-id')
  expect(addMock).toHaveBeenCalledTimes(1)
  const saved = addMock.mock.calls[0][0].data
  expect(saved.cover_image).toBe('cloud://c')
  expect(saved.params[0]).toEqual({ param_name: '拍摄时长', param_value: '60分钟' })
  expect(saved.is_featured).toBe(true)
})

test('savePackage：文本违规被 msgSecCheck 拦截', async () => {
  mockCloud.openapi.security.msgSecCheck.mockRejectedValue({ errCode: 87014 })
  const { addMock } = setupDb()
  const res = await main({
    action: 'savePackage',
    payload: { name: '违规标题', coverImage: 'cloud://c', params: [{ paramName: 'a', paramValue: 'b' }] }
  }, {})
  expect(res.code).toBe(400)
  expect(res.message).toContain('违规')
  expect(addMock).not.toHaveBeenCalled()
})

test('deletePackage：软删除', async () => {
  const { docObj } = setupDb()
  const res = await main({ action: 'deletePackage', payload: { id: 'p1' } }, {})
  expect(res.code).toBe(0)
  expect(docObj.update).toHaveBeenCalledWith({ data: expect.objectContaining({ deleted: true }) })
})

test('saveStoreInfo：首次保存走 set 建 main 文档', async () => {
  const { docObj } = setupDb({ storeGetFails: true })
  const res = await main({
    action: 'saveStoreInfo',
    payload: { storeName: 'etiniabox', logo: '', intro: '', photos: [], businessHours: '', address: '地址', longitude: 113, latitude: 23, contactPhone: '0755-123', qrcodeImage: 'cloud://q' }
  }, {})
  expect(res.code).toBe(0)
  expect(docObj.set).toHaveBeenCalledTimes(1)
  expect(docObj.set.mock.calls[0][0].data.store_name).toBe('etiniabox')
})

test('setPackageStatus：切换上下架', async () => {
  const { docObj } = setupDb()
  const res = await main({ action: 'setPackageStatus', payload: { id: 'p1', status: 'lower' } }, {})
  expect(res.code).toBe(0)
  expect(docObj.update).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'lower' }) })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd cloudfunctions/admin && npm i && npx jest
```

预期：FAIL（模块不存在）。

- [ ] **Step 4: 实现 admin 云函数**

`cloudfunctions/admin/index.js`：

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ok = (data) => ({ code: 0, data })
const fail = (code, message) => ({ code, message })

async function getAdminOpenids() {
  try {
    const res = await db.collection('admin_config').doc('main').get()
    return (res.data && res.data.openids) || []
  } catch (e) {
    return []
  }
}

/** 文本内容安全（v2 接口需 openid + scene）；服务异常时放行，不阻塞正常运营 */
async function checkText(openid, text) {
  const t = (text || '').trim()
  if (!t) return null
  try {
    const res = await cloud.openapi.security.msgSecCheck({ openid, scene: 2, version: 2, content: t })
    if (res && res.result && res.result.suggest && res.result.suggest !== 'pass') {
      return '内容包含违规信息，请修改后再保存'
    }
    return null
  } catch (e) {
    if (e.errCode === 87014) return '内容包含违规信息，请修改后再保存'
    return null
  }
}

function validatePackage(p) {
  if (!p.name || !p.name.trim()) return '套餐名称不能为空'
  if (p.name.length > 30) return '套餐名称不能超过 30 字'
  if (!p.coverImage) return '请上传封面图'
  if (!Array.isArray(p.params) || p.params.length < 1) return '至少填写一行参数明细'
  for (const item of p.params) {
    if (!item.paramName || !item.paramValue) return '参数名与参数值不能为空'
  }
  return null
}

function packageDoc(p, now) {
  return {
    name: p.name.trim(),
    cover_image: p.coverImage,
    summary: (p.summary || '').slice(0, 40),
    price_display: p.priceDisplay || '',
    params: (p.params || []).map((item) => ({
      param_name: (item.paramName || '').slice(0, 12),
      param_value: (item.paramValue || '').slice(0, 30)
    })),
    detail_images: p.detailImages || [],
    is_featured: !!p.isFeatured,
    sort: Number(p.sort) || 0,
    status: p.status === 'lower' ? 'lower' : 'upper',
    deleted: false,
    updated_at: now
  }
}

function validateCampaign(p) {
  if (!p.title || !p.title.trim()) return '活动主题不能为空'
  if (p.title.length > 30) return '活动主题不能超过 30 字'
  if (!p.bannerImage) return '请上传海报图'
  if (!p.startDate || !p.endDate) return '请选择有效期'
  if (p.endDate < p.startDate) return '结束日期不能早于开始日期'
  return null
}

function campaignDoc(p, now) {
  return {
    title: p.title.trim(),
    season: p.season || '',
    banner_image: p.bannerImage,
    description_blocks: (p.descriptionBlocks || []).map((b) => ({
      type: b.type === 'image' ? 'image' : 'text',
      text: (b.text || '').slice(0, 500),
      image: b.image || ''
    })),
    start_date: p.startDate,
    end_date: p.endDate,
    sort: Number(p.sort) || 0,
    status: p.status === 'lower' ? 'lower' : 'upper',
    deleted: false,
    updated_at: now
  }
}

function storeInfoDoc(p, now) {
  return {
    store_name: (p.storeName || '').slice(0, 30),
    logo: p.logo || '',
    intro: (p.intro || '').slice(0, 500),
    photos: p.photos || [],
    business_hours: (p.businessHours || '').slice(0, 100),
    address: (p.address || '').slice(0, 100),
    longitude: Number(p.longitude) || 0,
    latitude: Number(p.latitude) || 0,
    contact_phone: (p.contactPhone || '').slice(0, 20),
    qrcode_image: p.qrcodeImage || '',
    updated_at: now
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const payload = event.payload || {}
  const now = Date.now()

  try {
    if (action === 'checkAdmin') {
      const openids = await getAdminOpenids()
      return ok({ isAdmin: openids.includes(OPENID) })
    }

    // 其余全部为写操作：必须命中白名单（写权限唯一入口）
    const openids = await getAdminOpenids()
    if (!openids.includes(OPENID)) return fail(403, '无管理员权限')

    switch (action) {
      case 'getPackageById': {
        try {
          const res = await db.collection('packages').doc(payload.id).get()
          return ok(res.data || null)
        } catch (e) { return ok(null) }
      }
      case 'savePackage': {
        const err = validatePackage(payload)
        if (err) return fail(400, err)
        const textErr = await checkText(OPENID, payload.name + ' ' + (payload.summary || ''))
        if (textErr) return fail(400, textErr)
        const doc = packageDoc(payload, now)
        if (payload.id) {
          await db.collection('packages').doc(payload.id).update({ data: doc })
          return ok({ id: payload.id })
        }
        const added = await db.collection('packages').add({ data: { ...doc, created_at: now } })
        return ok({ id: added._id })
      }
      case 'setPackageStatus': {
        await db.collection('packages').doc(payload.id).update({
          data: { status: payload.status === 'lower' ? 'lower' : 'upper', updated_at: now }
        })
        return ok({})
      }
      case 'deletePackage': {
        await db.collection('packages').doc(payload.id).update({
          data: { deleted: true, status: 'lower', updated_at: now }
        })
        return ok({})
      }
      case 'listCampaignsAdmin': {
        const res = await db.collection('campaigns')
          .where({ deleted: false }).orderBy('sort', 'asc').limit(50).get()
        return ok(res.data || [])
      }
      case 'getCampaignById': {
        try {
          const res = await db.collection('campaigns').doc(payload.id).get()
          return ok(res.data || null)
        } catch (e) { return ok(null) }
      }
      case 'saveCampaign': {
        const err = validateCampaign(payload)
        if (err) return fail(400, err)
        const textErr = await checkText(OPENID, payload.title + ' ' + (payload.descriptionBlocks || []).map((b) => b.text).join(' '))
        if (textErr) return fail(400, textErr)
        const doc = campaignDoc(payload, now)
        if (payload.id) {
          await db.collection('campaigns').doc(payload.id).update({ data: doc })
          return ok({ id: payload.id })
        }
        const added = await db.collection('campaigns').add({ data: { ...doc, created_at: now } })
        return ok({ id: added._id })
      }
      case 'setCampaignStatus': {
        await db.collection('campaigns').doc(payload.id).update({
          data: { status: payload.status === 'lower' ? 'lower' : 'upper', updated_at: now }
        })
        return ok({})
      }
      case 'deleteCampaign': {
        await db.collection('campaigns').doc(payload.id).update({
          data: { deleted: true, status: 'lower', updated_at: now }
        })
        return ok({})
      }
      case 'saveStoreInfo': {
        const textErr = await checkText(OPENID, (payload.storeName || '') + ' ' + (payload.intro || ''))
        if (textErr) return fail(400, textErr)
        const doc = storeInfoDoc(payload, now)
        await db.collection('store_info').doc('main').set({ data: doc })
        return ok({})
      }
      default:
        return fail(400, '未知 action: ' + action)
    }
  } catch (e) {
    return fail(500, e.message || '服务异常')
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd cloudfunctions/admin && npx jest
```

预期：9 个测试全部 PASS。

- [ ] **Step 6: 部署并配置管理员白名单（人工操作）**

1. 右键 `cloudfunctions/admin` → 「上传并部署：云端安装依赖」。
2. 云开发控制台 → 数据库 → `admin_config` → 编辑 `main` 文档，把 Task 3 Step 6 记下的 openid 填入：

```json
{ "_id": "main", "openids": ["oXXXX你在Task3拿到的openid"] }
```

3. 开发者工具 Console 验证：

```js
wx.cloud.callFunction({ name: 'admin', data: { action: 'checkAdmin' } }).then(console.log)
```

预期：`{ code: 0, data: { isAdmin: true } }`。

- [ ] **Step 7: 提交**

```bash
git add cloudfunctions/admin && git commit -m "feat: admin 云函数（白名单鉴权 + 套餐/活动/门店写接口 + 文本内容安全）"
```

---

### Task 5: 前端服务层、打卡工具与页面骨架

**Files:**
- Create: `utils/cloud.uts`
- Create: `utils/checkin.uts`
- Modify: `pages.json`
- Create: `pages/package/list.uvue`（占位）
- Create: `pages/package/detail.uvue`（占位）
- Create: `pages/checkin/checkin.uvue`（占位）
- Create: `pages/about/about.uvue`（占位）
- Create: `pages/campaign/detail.uvue`（占位）
- Create: `pages/admin/index.uvue`（占位）等 4 个 admin 占位页
- Create: `components/poster-popup.uvue`（占位）

- [ ] **Step 1: 重写 pages.json（10 页面 + 文字版 tabBar）**

```json
{
	"pages": [
		{ "path": "pages/index/index", "style": { "navigationBarTitleText": "etiniabox" } },
		{ "path": "pages/package/list", "style": { "navigationBarTitleText": "套餐" } },
		{ "path": "pages/package/detail", "style": { "navigationBarTitleText": "套餐详情" } },
		{ "path": "pages/checkin/checkin", "style": { "navigationBarTitleText": "打卡" } },
		{ "path": "pages/about/about", "style": { "navigationBarTitleText": "门店" } },
		{ "path": "pages/campaign/detail", "style": { "navigationBarTitleText": "季度活动" } },
		{ "path": "pages/admin/index", "style": { "navigationBarTitleText": "管理" } },
		{ "path": "pages/admin/package-edit", "style": { "navigationBarTitleText": "编辑套餐" } },
		{ "path": "pages/admin/campaign-edit", "style": { "navigationBarTitleText": "编辑活动" } },
		{ "path": "pages/admin/store-info", "style": { "navigationBarTitleText": "门店信息" } }
	],
	"tabBar": {
		"color": "#999999",
		"selectedColor": "#1A1A1A",
		"backgroundColor": "#FFFFFF",
		"borderStyle": "black",
		"list": [
			{ "pagePath": "pages/index/index", "text": "首页" },
			{ "pagePath": "pages/package/list", "text": "套餐" },
			{ "pagePath": "pages/checkin/checkin", "text": "打卡" },
			{ "pagePath": "pages/about/about", "text": "门店" }
		]
	},
	"globalStyle": {
		"navigationBarTextStyle": "black",
		"navigationBarTitleText": "etiniabox",
		"navigationBarBackgroundColor": "#FFFFFF",
		"backgroundColor": "#F5F5F5"
	},
	"uniIdRouter": {}
}
```

- [ ] **Step 2: 写服务层 utils/cloud.uts**

```uts
import { CLOUD_ENV_ID } from './config.uts'

// ---------- 数据模型（与云函数返回字段一一对应） ----------
export interface PackageParam { paramName: string; paramValue: string }
export interface PackageItem {
	id: string; name: string; coverImage: string; coverImageUrl: string
	summary: string; priceDisplay: string; params: PackageParam[]
	detailImages: string[]; detailImageUrls: string[]
	isFeatured: boolean; sort: number; status: string
}
export interface DescriptionBlock { type: string; text: string; image: string; imageUrl: string }
export interface CampaignItem {
	id: string; title: string; season: string
	bannerImage: string; bannerImageUrl: string
	descriptionBlocks: DescriptionBlock[]
	startDate: string; endDate: string
	sort: number; status: string; expired: boolean
}
export interface StoreInfo {
	storeName: string; logo: string; logoUrl: string; intro: string
	photos: string[]; photoUrls: string[]
	businessHours: string; address: string
	longitude: number; latitude: number
	contactPhone: string; qrcodeImage: string; qrcodeImageUrl: string
}

// ---------- 云函数调用信封 ----------
function callCloud(name: string, action: string, payload: UTSJSONObject | null): Promise<any> {
	return new Promise<any>((resolve, reject) => {
		// #ifdef MP-WEIXIN
		wx.cloud.callFunction({
			name: name,
			data: { action: action, payload: payload ?? {} }
		} as any).then((res: any) => {
			const result = res.result as UTSJSONObject
			if (result.getNumber('code') == 0) {
				resolve(result['data'])
			} else {
				reject(new Error(result.getString('message') ?? '请求失败'))
			}
		}).catch((err: any) => {
			reject(new Error(err.errMsg ?? '网络异常'))
		})
		// #endif
	})
}

// ---------- 映射辅助 ----------
function toPackage(o: UTSJSONObject): PackageItem {
	const paramsRaw = (o['params'] ?? []) as Array<any>
	return {
		id: o.getString('id') ?? '',
		name: o.getString('name') ?? '',
		coverImage: o.getString('coverImage') ?? '',
		coverImageUrl: o.getString('coverImageUrl') ?? '',
		summary: o.getString('summary') ?? '',
		priceDisplay: o.getString('priceDisplay') ?? '',
		params: paramsRaw.map((p: any): PackageParam => {
			const pj = p as UTSJSONObject
			return { paramName: pj.getString('paramName') ?? '', paramValue: pj.getString('paramValue') ?? '' }
		}),
		detailImages: (o['detailImages'] ?? []) as string[],
		detailImageUrls: (o['detailImageUrls'] ?? []) as string[],
		isFeatured: o.getBoolean('isFeatured') ?? false,
		sort: o.getNumber('sort') ?? 0,
		status: o.getString('status') ?? 'upper'
	}
}

function toCampaign(o: UTSJSONObject): CampaignItem {
	const blocksRaw = (o['descriptionBlocks'] ?? []) as Array<any>
	return {
		id: o.getString('id') ?? '',
		title: o.getString('title') ?? '',
		season: o.getString('season') ?? '',
		bannerImage: o.getString('bannerImage') ?? '',
		bannerImageUrl: o.getString('bannerImageUrl') ?? '',
		descriptionBlocks: blocksRaw.map((b: any): DescriptionBlock => {
			const bj = b as UTSJSONObject
			return {
				type: bj.getString('type') ?? 'text',
				text: bj.getString('text') ?? '',
				image: bj.getString('image') ?? '',
				imageUrl: bj.getString('imageUrl') ?? ''
			}
		}),
		startDate: o.getString('startDate') ?? '',
		endDate: o.getString('endDate') ?? '',
		sort: o.getNumber('sort') ?? 0,
		status: o.getString('status') ?? 'upper',
		expired: o.getBoolean('expired') ?? false
	}
}

function toStoreInfo(o: UTSJSONObject): StoreInfo {
	return {
		storeName: o.getString('storeName') ?? '',
		logo: o.getString('logo') ?? '',
		logoUrl: o.getString('logoUrl') ?? '',
		intro: o.getString('intro') ?? '',
		photos: (o['photos'] ?? []) as string[],
		photoUrls: (o['photoUrls'] ?? []) as string[],
		businessHours: o.getString('businessHours') ?? '',
		address: o.getString('address') ?? '',
		longitude: o.getNumber('longitude') ?? 0,
		latitude: o.getNumber('latitude') ?? 0,
		contactPhone: o.getString('contactPhone') ?? '',
		qrcodeImage: o.getString('qrcodeImage') ?? '',
		qrcodeImageUrl: o.getString('qrcodeImageUrl') ?? ''
	}
}

// ---------- 顾客端接口 ----------
export function getStoreInfo(): Promise<StoreInfo | null> {
	return callCloud('data', 'getStoreInfo', null).then((d: any) => {
		if (d == null) return null
		return toStoreInfo(d as UTSJSONObject)
	})
}

export function listPackages(): Promise<PackageItem[]> {
	return callCloud('data', 'listPackages', null).then((d: any) => {
		const arr = (d ?? []) as Array<any>
		return arr.map((o: any): PackageItem => toPackage(o as UTSJSONObject))
	})
}

export function getPackage(id: string): Promise<PackageItem | null> {
	return callCloud('data', 'getPackage', { id: id } as UTSJSONObject).then((d: any) => {
		if (d == null) return null
		return toPackage(d as UTSJSONObject)
	})
}

export function listCampaigns(): Promise<CampaignItem[]> {
	return callCloud('data', 'listCampaigns', null).then((d: any) => {
		const arr = (d ?? []) as Array<any>
		return arr.map((o: any): CampaignItem => toCampaign(o as UTSJSONObject))
	})
}

export function getCampaign(id: string): Promise<CampaignItem | null> {
	return callCloud('data', 'getCampaign', { id: id } as UTSJSONObject).then((d: any) => {
		if (d == null) return null
		return toCampaign(d as UTSJSONObject)
	})
}

// ---------- 管理端接口 ----------
export function checkAdmin(): Promise<boolean> {
	return callCloud('admin', 'checkAdmin', null).then((d: any) => {
		const o = (d ?? {}) as UTSJSONObject
		return o.getBoolean('isAdmin') ?? false
	})
}

function adminPackagePayload(p: PackageItem): UTSJSONObject {
	return JSON.parse(JSON.stringify(p)) as UTSJSONObject
}

export function adminGetPackageById(id: string): Promise<PackageItem | null> {
	return callCloud('admin', 'getPackageById', { id: id } as UTSJSONObject).then((d: any) => {
		if (d == null) return null
		return toPackage(d as UTSJSONObject)
	})
}

export function adminSavePackage(p: PackageItem): Promise<string> {
	return callCloud('admin', 'savePackage', adminPackagePayload(p)).then((d: any) => {
		const o = (d ?? {}) as UTSJSONObject
		return o.getString('id') ?? ''
	})
}

export function adminSetPackageStatus(id: string, status: string): Promise<void> {
	return callCloud('admin', 'setPackageStatus', { id: id, status: status } as UTSJSONObject).then(() => {})
}

export function adminDeletePackage(id: string): Promise<void> {
	return callCloud('admin', 'deletePackage', { id: id } as UTSJSONObject).then(() => {})
}

export function adminListCampaigns(): Promise<CampaignItem[]> {
	return callCloud('admin', 'listCampaignsAdmin', null).then((d: any) => {
		const arr = (d ?? []) as Array<any>
		// 管理端列表拿到的是数据库原始 snake_case 文档
		return arr.map((doc: any): CampaignItem => {
			const j = doc as UTSJSONObject
			const blocksRaw = (j['description_blocks'] ?? []) as Array<any>
			return {
				id: j.getString('_id') ?? '',
				title: j.getString('title') ?? '',
				season: j.getString('season') ?? '',
				bannerImage: j.getString('banner_image') ?? '',
				bannerImageUrl: '',
				descriptionBlocks: blocksRaw.map((b: any): DescriptionBlock => {
					const bj = b as UTSJSONObject
					return { type: bj.getString('type') ?? 'text', text: bj.getString('text') ?? '', image: bj.getString('image') ?? '', imageUrl: '' }
				}),
				startDate: j.getString('start_date') ?? '',
				endDate: j.getString('end_date') ?? '',
				sort: j.getNumber('sort') ?? 0,
				status: j.getString('status') ?? 'upper',
				expired: (j.getString('end_date') ?? '') < todayLocal()
			}
		})
	})
}

export function adminGetCampaignById(id: string): Promise<CampaignItem | null> {
	return callCloud('admin', 'getCampaignById', { id: id } as UTSJSONObject).then((d: any) => {
		if (d == null) return null
		// 原始 snake_case → camelCase（ imageUrl 置空，编辑页用上传时本地路径预览 ）
		const j = d as UTSJSONObject
		const blocksRaw = (j['description_blocks'] ?? []) as Array<any>
		return {
			id: j.getString('_id') ?? '',
			title: j.getString('title') ?? '',
			season: j.getString('season') ?? '',
			bannerImage: j.getString('banner_image') ?? '',
			bannerImageUrl: '',
			descriptionBlocks: blocksRaw.map((b: any): DescriptionBlock => {
				const bj = b as UTSJSONObject
				return { type: bj.getString('type') ?? 'text', text: bj.getString('text') ?? '', image: bj.getString('image') ?? '', imageUrl: '' }
			}),
			startDate: j.getString('start_date') ?? '',
			endDate: j.getString('end_date') ?? '',
			sort: j.getNumber('sort') ?? 0,
			status: j.getString('status') ?? 'upper',
			expired: false
		} as CampaignItem
	})
}

function campaignPayload(c: CampaignItem): UTSJSONObject {
	return JSON.parse(JSON.stringify(c)) as UTSJSONObject
}

export function adminSaveCampaign(c: CampaignItem): Promise<string> {
	return callCloud('admin', 'saveCampaign', campaignPayload(c)).then((d: any) => {
		const o = (d ?? {}) as UTSJSONObject
		return o.getString('id') ?? ''
	})
}

export function adminSetCampaignStatus(id: string, status: string): Promise<void> {
	return callCloud('admin', 'setCampaignStatus', { id: id, status: status } as UTSJSONObject).then(() => {})
}

export function adminDeleteCampaign(id: string): Promise<void> {
	return callCloud('admin', 'deleteCampaign', { id: id } as UTSJSONObject).then(() => {})
}

export function adminSaveStoreInfo(s: StoreInfo): Promise<void> {
	return callCloud('admin', 'saveStoreInfo', JSON.parse(JSON.stringify(s)) as UTSJSONObject).then(() => {})
}

// ---------- 图片上传（管理端） ----------
export function uploadImage(tempFilePath: string, folder: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		// #ifdef MP-WEIXIN
		const ext = tempFilePath.substring(tempFilePath.lastIndexOf('.'))
		const cloudPath = folder + '/' + Date.now() + '-' + Math.floor(Math.random() * 100000) + ext
		wx.cloud.uploadFile({
			cloudPath: cloudPath,
			filePath: tempFilePath,
			success: (res: any) => resolve(res.fileID as string),
			fail: (err: any) => reject(new Error(err.errMsg ?? '上传失败'))
		} as any)
		// #endif
	})
}

/** 本地日期 YYYY-MM-DD（供 adminListCampaigns 过期判断复用） */
export function todayLocal(): string {
	const d = new Date()
	const m = d.getMonth() + 1
	const day = d.getDate()
	const mm = m < 10 ? '0' + m : '' + m
	const dd = day < 10 ? '0' + day : '' + day
	return d.getFullYear() + '-' + mm + '-' + dd
}
```

- [ ] **Step 3: 写打卡工具 utils/checkin.uts**

```uts
const STORAGE_KEY = 'checkin_records'

/** 本机日期 YYYY-MM-DD */
export function formatDateString(date: Date): string {
	const y = date.getFullYear()
	const m = date.getMonth() + 1
	const d = date.getDate()
	const mm = m < 10 ? '0' + m : '' + m
	const dd = d < 10 ? '0' + d : '' + d
	return y + '-' + mm + '-' + dd
}

/** 读取本机打卡日期数组 */
export function loadCheckinDates(): string[] {
	const v = uni.getStorageSync(STORAGE_KEY)
	return (v ?? []) as string[]
}

export function isCheckedToday(dates: string[]): boolean {
	return dates.includes(formatDateString(new Date()))
}

/** 执行打卡：每自然日仅一次；记录只存本机 */
export function doCheckin(): { dates: string[]; firstToday: boolean } {
	const today = formatDateString(new Date())
	const dates = loadCheckinDates()
	if (dates.includes(today)) {
		return { dates: dates, firstToday: false }
	}
	dates.push(today)
	uni.setStorageSync(STORAGE_KEY, dates)
	return { dates: dates, firstToday: true }
}

/** 某月 42 格日历（6 行 x 7 列，周日起始），标记已打卡日 */
export function buildMonthGrid(year: number, month: number, dates: string[]): boolean[] {
	const grid: boolean[] = []
	const first = new Date(year, month - 1, 1)
	const startWeek = first.getDay()
	const daysInMonth = new Date(year, month, 0).getDate()
	for (let i = 0; i < 42; i++) {
		const dayNum = i - startWeek + 1
		if (dayNum < 1 || dayNum > daysInMonth) {
			grid.push(false)
		} else {
			grid.push(dates.includes(formatDateString(new Date(year, month - 1, dayNum))))
		}
	}
	return grid
}
```

- [ ] **Step 4: 建 8 个占位页面**

`pages/package/list.uvue`、`pages/package/detail.uvue`、`pages/checkin/checkin.uvue`、`pages/about/about.uvue`、`pages/campaign/detail.uvue`、`pages/admin/index.uvue`、`pages/admin/package-edit.uvue`、`pages/admin/campaign-edit.uvue`、`pages/admin/store-info.uvue` 均先写同一占位内容：

```vue
<template>
	<view class="page"><text class="tip">建设中</text></view>
</template>
<script setup lang="uts">
</script>
<style>
	.page { padding: 40rpx; }
	.tip { color: #999999; }
</style>
```

（`pages/index/index.uvue` 保留脚手架原样，下一任务重写。）

- [ ] **Step 5: 编译验证**

HBuilderX 运行到微信开发者工具。预期：底部出现「首页/套餐/打卡/门店」4 个文字 Tab，可切换，各页显示“建设中”。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: 页面骨架 + 前端服务层 + 本机打卡工具"
```

---

### Task 6: 门店信息页（含管理入口判定）

**Files:**
- Modify: `pages/about/about.uvue`（整体重写）

- [ ] **Step 1: 重写 about.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view v-if="isAdmin" class="admin-entry" @click="goAdmin"><text>进入管理</text></view>

		<view class="head">
			<image class="logo" :src="logoUrl" mode="aspectFill" />
			<text class="name">{{ storeName }}</text>
			<text class="hours" v-if="businessHours != ''">营业时间：{{ businessHours }}</text>
		</view>

		<view class="block" v-if="intro != ''">
			<text class="block-title">店铺介绍</text>
			<text class="intro">{{ intro }}</text>
		</view>

		<view class="block" v-if="photoUrls.length > 0">
			<text class="block-title">店内环境</text>
			<image v-for="(u, i) in photoUrls" :key="i" class="photo" :src="u" mode="widthFix" />
		</view>

		<view class="block" v-if="address != ''">
			<text class="block-title">门店地址</text>
			<view class="row" @click="openMap"><text class="link">{{ address }}</text></view>
		</view>

		<view class="block" v-if="contactPhone != ''">
			<text class="block-title">联系电话</text>
			<view class="row" @click="callPhone"><text class="link">{{ contactPhone }}</text></view>
		</view>

		<view v-if="loadingFailed" class="empty"><text>加载失败，请退出重试</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getStoreInfo, checkAdmin, StoreInfo } from '../../utils/cloud.uts'

const storeName = ref('etiniabox')
const logoUrl = ref('/static/logo.png')
const intro = ref('')
const photoUrls = ref<string[]>([])
const businessHours = ref('')
const address = ref('')
const contactPhone = ref('')
const longitude = ref(0)
const latitude = ref(0)
const isAdmin = ref(false)
const loadingFailed = ref(false)

onShow(() => {
	loadStore()
	refreshAdmin()
})

async function loadStore() {
	try {
		const info: StoreInfo | null = await getStoreInfo()
		if (info != null) {
			if (info.storeName != '') storeName.value = info.storeName
			if (info.logoUrl != '') logoUrl.value = info.logoUrl
			intro.value = info.intro
			photoUrls.value = info.photoUrls
			businessHours.value = info.businessHours
			address.value = info.address
			contactPhone.value = info.contactPhone
			longitude.value = info.longitude
			latitude.value = info.latitude
		}
		loadingFailed.value = false
	} catch (e) {
		loadingFailed.value = true
	}
}

async function refreshAdmin() {
	try {
		isAdmin.value = await checkAdmin()
	} catch (e) {
		isAdmin.value = false
	}
}

function goAdmin() {
	uni.navigateTo({ url: '/pages/admin/index' })
}

function openMap() {
	// 仅展示店铺位置并导航，不获取用户位置
	uni.openLocation({
		longitude: longitude.value,
		latitude: latitude.value,
		name: storeName.value,
		address: address.value
	})
}

function callPhone() {
	uni.makePhoneCall({ phoneNumber: contactPhone.value })
}
</script>

<style>
	.page { padding: 24rpx; }
	.admin-entry { position: absolute; top: 20rpx; right: 24rpx; background-color: #1A1A1A; border-radius: 24rpx; padding: 8rpx 24rpx; }
	.admin-entry text { color: #FFFFFF; font-size: 24rpx; }
	.head { display: flex; flex-direction: column; align-items: center; padding: 40rpx 0; }
	.logo { width: 160rpx; height: 160rpx; border-radius: 32rpx; }
	.name { font-size: 40rpx; font-weight: bold; margin-top: 20rpx; }
	.hours { font-size: 26rpx; color: #666666; margin-top: 12rpx; }
	.block { background-color: #FFFFFF; border-radius: 24rpx; padding: 32rpx; margin-bottom: 24rpx; }
	.block-title { font-size: 30rpx; font-weight: bold; margin-bottom: 16rpx; }
	.intro { font-size: 28rpx; color: #444444; line-height: 1.6; }
	.photo { width: 100%; border-radius: 16rpx; margin-bottom: 16rpx; }
	.row { padding: 8rpx 0; }
	.link { font-size: 28rpx; color: #1677FF; }
	.empty { align-items: center; padding: 40rpx; }
	.empty text { color: #999999; }
</style>
```

- [ ] **Step 2: 编译验证（含空数据态）**

运行到微信开发者工具 → 「门店」Tab。
预期：显示默认店名 etiniabox 与 logo 占位；无“进入管理”按钮（此时 openid 尚未加白名单——若已在 Task 4 加白则显示该按钮，两种都符合预期）；无报错。

- [ ] **Step 3: 提交**

```bash
git add pages/about && git commit -m "feat: 门店信息页（介绍/相册/导航/拨号 + 白名单管理入口）"
```

---

### Task 7: 首页

**Files:**
- Modify: `pages/index/index.uvue`（整体重写）

- [ ] **Step 1: 重写 index.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view class="head">
			<image class="logo" :src="logoUrl" mode="aspectFill" />
			<view class="head-text">
				<text class="name">{{ storeName }}</text>
				<text class="intro" v-if="storeIntro != ''">{{ storeIntro }}</text>
			</view>
		</view>

		<swiper v-if="campaigns.length > 0" class="swiper" circular autoplay :interval="4000" :duration="500">
			<swiper-item v-for="c in campaigns" :key="c.id" @click="goCampaign(c.id)">
				<image class="swiper-img" :src="c.bannerImageUrl" mode="aspectFill" />
			</swiper-item>
		</swiper>

		<view class="section-head"><text class="section-title">推荐套餐</text></view>
		<view v-if="featured.length > 0" class="pkg-list">
			<view class="pkg-card" v-for="p in featured" :key="p.id" @click="goPackage(p.id)">
				<image class="pkg-cover" :src="p.coverImageUrl" mode="aspectFill" />
				<view class="pkg-info">
					<text class="pkg-name">{{ p.name }}</text>
					<text class="pkg-price" v-if="p.priceDisplay != ''">{{ p.priceDisplay }}</text>
				</view>
			</view>
		</view>
		<view v-else class="empty"><text class="empty-text">套餐整理中，敬请期待</text></view>

		<button class="checkin-btn" @click="goCheckin">到店打卡</button>

		<view v-if="loadingFailed" class="empty"><text class="empty-text">加载失败，请重进小程序</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listPackages, listCampaigns, getStoreInfo, PackageItem, CampaignItem } from '../../utils/cloud.uts'

const storeName = ref('etiniabox')
const storeIntro = ref('')
const logoUrl = ref('/static/logo.png')
const campaigns = ref<CampaignItem[]>([])
const featured = ref<PackageItem[]>([])
const loadingFailed = ref(false)

onShow(() => {
	loadData()
})

async function loadData() {
	try {
		const info = await getStoreInfo()
		if (info != null) {
			if (info.storeName != '') storeName.value = info.storeName
			storeIntro.value = info.intro
			if (info.logoUrl != '') logoUrl.value = info.logoUrl
		}
		const pkgs = await listPackages()
		featured.value = pkgs.filter((p: PackageItem): boolean => p.isFeatured).slice(0, 4)
		const cams = await listCampaigns()
		campaigns.value = cams.filter((c: CampaignItem): boolean => !c.expired)
		loadingFailed.value = false
	} catch (e) {
		loadingFailed.value = true
	}
}

function goCampaign(id: string) {
	uni.navigateTo({ url: '/pages/campaign/detail?id=' + id })
}
function goPackage(id: string) {
	uni.navigateTo({ url: '/pages/package/detail?id=' + id })
}
function goCheckin() {
	uni.switchTab({ url: '/pages/checkin/checkin' })
}
</script>

<style>
	.page { padding: 24rpx; }
	.head { display: flex; flex-direction: row; align-items: center; padding: 24rpx 8rpx; }
	.logo { width: 120rpx; height: 120rpx; border-radius: 28rpx; }
	.head-text { display: flex; flex-direction: column; margin-left: 24rpx; }
	.name { font-size: 38rpx; font-weight: bold; }
	.intro { font-size: 26rpx; color: #666666; margin-top: 8rpx; }
	.swiper { height: 320rpx; border-radius: 24rpx; overflow: hidden; }
	.swiper-img { width: 100%; height: 320rpx; }
	.section-head { margin: 32rpx 8rpx 16rpx; }
	.section-title { font-size: 32rpx; font-weight: bold; }
	.pkg-list { display: flex; flex-direction: column; }
	.pkg-card { display: flex; flex-direction: row; background-color: #FFFFFF; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }
	.pkg-cover { width: 160rpx; height: 160rpx; border-radius: 16rpx; }
	.pkg-info { display: flex; flex-direction: column; justify-content: center; margin-left: 24rpx; }
	.pkg-name { font-size: 30rpx; font-weight: bold; }
	.pkg-price { font-size: 28rpx; color: #C85A54; margin-top: 12rpx; }
	.checkin-btn { margin: 32rpx 0 48rpx; background-color: #1A1A1A; color: #FFFFFF; border-radius: 48rpx; }
	.empty { align-items: center; padding: 48rpx; }
	.empty-text { color: #999999; font-size: 28rpx; }
</style>
```

- [ ] **Step 2: 编译验证**

预期：首页显示店铺头部；“推荐套餐”空态显示“套餐整理中，敬请期待”；无活动时轮播隐藏；点击“到店打卡”切到打卡 Tab；Console 无报错。

- [ ] **Step 3: 提交**

```bash
git add pages/index && git commit -m "feat: 首页（活动轮播 + 推荐套餐 + 打卡入口）"
```

---

### Task 8: 套餐列表与套餐详情

**Files:**
- Modify: `pages/package/list.uvue`（重写；管理操作 Task 13 追加）
- Modify: `pages/package/detail.uvue`（重写）

- [ ] **Step 1: 重写 package/list.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view v-if="list.length > 0" class="pkg-list">
			<view class="pkg-card" v-for="p in list" :key="p.id" @click="goDetail(p.id)">
				<image class="cover" :src="p.coverImageUrl" mode="aspectFill" />
				<view class="info">
					<text class="name">{{ p.name }}</text>
					<text class="summary">{{ p.summary }}</text>
					<text class="price" v-if="p.priceDisplay != ''">{{ p.priceDisplay }}</text>
				</view>
			</view>
		</view>
		<view v-else class="empty"><text class="empty-text">套餐整理中，敬请期待</text></view>
		<view v-if="loadingFailed" class="empty"><text class="empty-text">加载失败，请重试</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listPackages, PackageItem } from '../../utils/cloud.uts'

const list = ref<PackageItem[]>([])
const loadingFailed = ref(false)

onShow(() => {
	loadData()
})

async function loadData() {
	try {
		list.value = await listPackages()
		loadingFailed.value = false
	} catch (e) {
		loadingFailed.value = true
	}
}

function goDetail(id: string) {
	uni.navigateTo({ url: '/pages/package/detail?id=' + id })
}
</script>

<style>
	.page { padding: 24rpx; }
	.pkg-list { display: flex; flex-direction: column; }
	.pkg-card { background-color: #FFFFFF; border-radius: 24rpx; margin-bottom: 24rpx; overflow: hidden; }
	.cover { width: 100%; height: 320rpx; }
	.info { padding: 24rpx; display: flex; flex-direction: column; }
	.name { font-size: 32rpx; font-weight: bold; }
	.summary { font-size: 26rpx; color: #666666; margin-top: 8rpx; }
	.price { font-size: 30rpx; color: #C85A54; margin-top: 12rpx; }
	.empty { align-items: center; padding: 60rpx; }
	.empty-text { color: #999999; font-size: 28rpx; }
</style>
```

- [ ] **Step 2: 重写 package/detail.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<swiper v-if="pkg.detailImageUrls.length > 0" class="imgs" circular>
			<swiper-item v-for="(u, i) in pkg.detailImageUrls" :key="i">
				<image class="img" :src="u" mode="aspectFill" />
			</swiper-item>
		</swiper>

		<view class="card">
			<text class="name">{{ pkg.name }}</text>
			<text class="price" v-if="pkg.priceDisplay != ''">{{ pkg.priceDisplay }}</text>
			<text class="summary" v-if="pkg.summary != ''">{{ pkg.summary }}</text>
		</view>

		<view class="card" v-if="pkg.params.length > 0">
			<text class="card-title">套餐参数</text>
			<view class="param-row" v-for="(p, i) in pkg.params" :key="i">
				<text class="param-name">{{ p.paramName }}</text>
				<text class="param-value">{{ p.paramValue }}</text>
			</view>
		</view>

		<view v-if="notFound" class="empty"><text class="empty-text">该套餐已下架或不存在</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref, reactive } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import { getPackage } from '../../utils/cloud.uts'

const pkg = reactive({ id: '', name: '', coverImage: '', coverImageUrl: '', summary: '', priceDisplay: '', params: [], detailImages: [], detailImageUrls: [], isFeatured: false, sort: 0, status: 'upper' })
const notFound = ref(false)

onLoad((option) => {
	const id = option?.id ?? ''
	if (id != '') load(id)
})

// #ifdef MP-WEIXIN
onShareAppMessage((): { title: string; path: string } => {
	return { title: pkg.name != '' ? pkg.name + ' · etiniabox' : 'etiniabox 摄影套餐', path: '/pages/package/detail?id=' + pkg.id }
})
// #endif

async function load(id: string) {
	try {
		const data = await getPackage(id)
		if (data == null) { notFound.value = true; return }
		pkg.id = data.id
		pkg.name = data.name
		pkg.priceDisplay = data.priceDisplay
		pkg.summary = data.summary
		pkg.params = data.params
		pkg.detailImageUrls = data.detailImageUrls
	} catch (e) {
		notFound.value = true
	}
}
</script>

<style>
	.page { padding: 24rpx; }
	.imgs { height: 480rpx; border-radius: 24rpx; overflow: hidden; }
	.img { width: 100%; height: 480rpx; }
	.card { background-color: #FFFFFF; border-radius: 24rpx; padding: 32rpx; margin-top: 24rpx; display: flex; flex-direction: column; }
	.name { font-size: 36rpx; font-weight: bold; }
	.price { font-size: 32rpx; color: #C85A54; margin-top: 12rpx; }
	.summary { font-size: 28rpx; color: #666666; margin-top: 12rpx; }
	.card-title { font-size: 30rpx; font-weight: bold; margin-bottom: 16rpx; }
	.param-row { display: flex; flex-direction: row; justify-content: space-between; padding: 16rpx 0; border-bottom-width: 1px; border-bottom-style: solid; border-bottom-color: #F0F0F0; }
	.param-name { font-size: 28rpx; color: #666666; }
	.param-value { font-size: 28rpx; color: #1A1A1A; }
	.empty { align-items: center; padding: 60rpx; }
	.empty-text { color: #999999; font-size: 28rpx; }
</style>
```

注意：`pkg.params` 的 reactive 数组在 uts 下若编译报类型错，改为 `const pkgParams = ref<PackageParam[]>([])` 并在模板用 `pkgParams`（功能一致）。

- [ ] **Step 3: 编译验证（无数据空态即可）**

预期：套餐 Tab 空态文案正常；直接访问不存在的详情 id 显示“该套餐已下架或不存在”，无报错。

- [ ] **Step 4: 提交**

```bash
git add pages/package && git commit -m "feat: 套餐列表与详情（参数明细、下架态、转发）"
```

---

### Task 9: 季度活动详情页

**Files:**
- Modify: `pages/campaign/detail.uvue`（重写）

- [ ] **Step 1: 重写 campaign/detail.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view v-if="!notFound && campaign.title != ''">
			<image class="banner" :src="campaign.bannerImageUrl" mode="widthFix" />
			<view class="card">
				<text class="title">{{ campaign.title }}</text>
				<text class="meta">{{ campaign.season }} · {{ campaign.startDate }} 至 {{ campaign.endDate }}</text>
				<view v-if="campaign.expired" class="expired-tag"><text class="expired-text">活动已结束</text></view>
			</view>

			<view class="card" v-if="campaign.descriptionBlocks.length > 0">
				<text class="card-title">活动说明</text>
				<block v-for="(b, i) in campaign.descriptionBlocks" :key="i">
					<text v-if="b.type == 'text' && b.text != ''" class="para">{{ b.text }}</text>
					<image v-if="b.type == 'image' && b.imageUrl != ''" class="para-img" :src="b.imageUrl" mode="widthFix" />
				</block>
			</view>

			<view class="card">
				<text class="card-title">参与方式</text>
				<text class="para">到店咨询店员，出示本页即可。</text>
			</view>
		</view>
		<view v-if="notFound" class="empty"><text class="empty-text">活动不存在</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref, reactive } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import { getCampaign, CampaignItem, DescriptionBlock } from '../../utils/cloud.uts'

const campaign = reactive({ id: '', title: '', season: '', bannerImage: '', bannerImageUrl: '', descriptionBlocks: [] as DescriptionBlock[], startDate: '', endDate: '', sort: 0, status: 'upper', expired: false })
const notFound = ref(false)

onLoad((option) => {
	const id = option?.id ?? ''
	if (id != '') load(id)
})

// #ifdef MP-WEIXIN
onShareAppMessage((): { title: string; path: string } => {
	return { title: campaign.title != '' ? campaign.title : 'etiniabox 季度活动', path: '/pages/campaign/detail?id=' + campaign.id }
})
// #endif

async function load(id: string) {
	try {
		const data: CampaignItem | null = await getCampaign(id)
		if (data == null) { notFound.value = true; return }
		campaign.id = data.id
		campaign.title = data.title
		campaign.season = data.season
		campaign.bannerImageUrl = data.bannerImageUrl
		campaign.descriptionBlocks = data.descriptionBlocks
		campaign.startDate = data.startDate
		campaign.endDate = data.endDate
		campaign.expired = data.expired
	} catch (e) {
		notFound.value = true
	}
}
</script>

<style>
	.page { padding: 24rpx; }
	.banner { width: 100%; border-radius: 24rpx; }
	.card { background-color: #FFFFFF; border-radius: 24rpx; padding: 32rpx; margin-top: 24rpx; }
	.title { font-size: 36rpx; font-weight: bold; }
	.meta { font-size: 26rpx; color: #666666; margin-top: 12rpx; }
	.expired-tag { margin-top: 16rpx; background-color: #F2F2F2; border-radius: 12rpx; padding: 8rpx 20rpx; align-self: flex-start; }
	.expired-text { color: #999999; font-size: 24rpx; }
	.card-title { font-size: 30rpx; font-weight: bold; margin-bottom: 16rpx; }
	.para { font-size: 28rpx; color: #444444; line-height: 1.6; margin-bottom: 16rpx; }
	.para-img { width: 100%; border-radius: 16rpx; margin-bottom: 16rpx; }
	.empty { align-items: center; padding: 60rpx; }
	.empty-text { color: #999999; font-size: 28rpx; }
</style>
```

- [ ] **Step 2: 编译验证**

从首页无活动时无法点入——在开发者工具 Console 临时执行 `uni.navigateTo({url:'/pages/campaign/detail?id=test'})`。预期：显示“活动不存在”，无报错。

- [ ] **Step 3: 提交**

```bash
git add pages/campaign && git commit -m "feat: 季度活动详情页（过期态标识 + 图文说明 + 转发）"
```

---

### Task 10: 打卡页

**Files:**
- Modify: `pages/checkin/checkin.uvue`（重写）

- [ ] **Step 1: 重写 checkin.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view class="summary-card">
			<text class="count-label">累计打卡</text>
			<text class="count-num">{{ dates.length }} 次</text>
			<text class="tip">打卡记录保存在本机，更换设备将不会保留</text>
		</view>

		<view class="calendar-card">
			<view class="cal-head">
				<text class="cal-arrow" @click="prevMonth">‹</text>
				<text class="cal-title">{{ year }} 年 {{ month }} 月</text>
				<text class="cal-arrow" @click="nextMonth">›</text>
			</view>
			<view class="week-row">
				<text class="week" v-for="(w, i) in weekHeads" :key="i">{{ w }}</text>
			</view>
			<view class="grid">
				<view class="cell" v-for="(on, i) in grid" :key="i">
					<view v-if="on" class="dot"></view>
				</view>
			</view>
		</view>

		<button class="checkin-btn" :disabled="checkedToday" @click="onCheckin">
			<text>{{ checkedToday ? '今日已打卡' : '打卡' }}</text>
		</button>

		<poster-popup :visible="posterVisible" :count="dates.length" :store-name="storeName" :qrcode-url="qrcodeUrl" :logo-url="logoUrl" @close="posterVisible = false" />
	</scroll-view>
</template>

<script setup lang="uts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { doCheckin, loadCheckinDates, buildMonthGrid, isCheckedToday } from '../../utils/checkin.uts'
import { getStoreInfo } from '../../utils/cloud.uts'
import PosterPopup from '../../components/poster-popup.uvue'

const weekHeads = ['日', '一', '二', '三', '四', '五', '六']
const dates = ref<string[]>([])
const year = ref(new Date().getFullYear())
const month = ref(new Date().getMonth() + 1)
const posterVisible = ref(false)
const storeName = ref('etiniabox')
const logoUrl = ref('/static/logo.png')
const qrcodeUrl = ref('')

const grid = computed<boolean[]>((): boolean[] => buildMonthGrid(year.value, month.value, dates.value))
const checkedToday = computed<boolean>((): boolean => isCheckedToday(dates.value))

onShow(() => {
	dates.value = loadCheckinDates()
	loadStore()
})

async function loadStore() {
	try {
		const info = await getStoreInfo()
		if (info != null) {
			if (info.storeName != '') storeName.value = info.storeName
			if (info.logoUrl != '') logoUrl.value = info.logoUrl
			qrcodeUrl.value = info.qrcodeImageUrl
		}
	} catch (e) {
		// 门店信息缺失不阻塞打卡
	}
}

function onCheckin() {
	const res = doCheckin()
	dates.value = res.dates
	if (res.firstToday) {
		posterVisible.value = true
	} else {
		uni.showToast({ title: '今天已打过卡啦', icon: 'none' })
	}
}

function prevMonth() {
	let m = month.value - 1
	let y = year.value
	if (m < 1) { m = 12; y = y - 1 }
	month.value = m
	year.value = y
}
function nextMonth() {
	let m = month.value + 1
	let y = year.value
	if (m > 12) { m = 1; y = y + 1 }
	month.value = m
	year.value = y
}
</script>

<style>
	.page { padding: 24rpx; }
	.summary-card { background-color: #1A1A1A; border-radius: 24rpx; padding: 48rpx; display: flex; flex-direction: column; align-items: center; }
	.count-label { color: #CCCCCC; font-size: 26rpx; }
	.count-num { color: #FFFFFF; font-size: 64rpx; font-weight: bold; margin: 16rpx 0; }
	.tip { color: #888888; font-size: 22rpx; }
	.calendar-card { background-color: #FFFFFF; border-radius: 24rpx; padding: 32rpx; margin-top: 24rpx; }
	.cal-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 24rpx; }
	.cal-title { font-size: 30rpx; font-weight: bold; }
	.cal-arrow { font-size: 40rpx; color: #666666; padding: 0 24rpx; }
	.week-row { display: flex; flex-direction: row; }
	.week { width: 14.28%; text-align: center; color: #999999; font-size: 24rpx; padding: 12rpx 0; }
	.grid { display: flex; flex-direction: row; flex-wrap: wrap; }
	.cell { width: 14.28%; height: 72rpx; display: flex; align-items: center; justify-content: center; }
	.dot { width: 20rpx; height: 20rpx; border-radius: 10rpx; background-color: #C85A54; }
	.checkin-btn { margin: 32rpx 0 48rpx; background-color: #C85A54; color: #FFFFFF; border-radius: 48rpx; }
</style>
```

- [ ] **Step 2: 编译验证**

预期：页面正常渲染（poster-popup 当前仍是占位组件，需先把 Task 5 的占位 poster-popup.uvue 换成空实现，见 Step 3），点击「打卡」→ 按钮变「今日已打卡」，日历当月出现一个红点；杀掉模拟器重进后计数与红点保留；点「‹/›」切换月份网格变化。

- [ ] **Step 3: poster-popup 先行替换为空实现（Task 11 完整实现）**

`components/poster-popup.uvue`：

```vue
<template>
	<view v-if="visible" class="mask" @click="close">
		<view class="popup" @click.stop>
			<text class="tip">海报生成中（下一任务实现）</text>
			<button class="btn" @click="close">关闭</button>
		</view>
	</view>
</template>
<script setup lang="uts">
	const props = defineProps({ visible: Boolean, count: Number, storeName: String, qrcodeUrl: String, logoUrl: String })
	const emit = defineEmits(['close'])
	function close() { emit('close') }
</script>
<style>
	.mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
	.popup { background-color: #FFFFFF; border-radius: 24rpx; padding: 48rpx; width: 560rpx; display: flex; flex-direction: column; align-items: center; }
	.tip { font-size: 28rpx; color: #666666; margin-bottom: 24rpx; }
	.btn { background-color: #1A1A1A; color: #FFFFFF; border-radius: 40rpx; width: 100%; }
</style>
```

- [ ] **Step 4: 提交**

```bash
git add pages/checkin components && git commit -m "feat: 打卡页（本机打卡 + 日历 + 每日一次限制）"
```

---

### Task 11: 分享海报组件（canvas 合成 + 保存相册）

**Files:**
- Modify: `components/poster-popup.uvue`（重写为完整实现）

- [ ] **Step 1: 重写 poster-popup.uvue**

```vue
<template>
	<view v-if="visible" class="mask" @click="close">
		<view class="popup" @click.stop>
			<canvas canvas-id="posterCanvas" id="posterCanvas" class="poster-canvas" />
			<view class="btn-row">
				<button class="btn" @click="save">保存到相册</button>
				<button class="btn btn-plain" @click="close">关闭</button>
			</view>
		</view>
	</view>
</template>

<script setup lang="uts">
import { watch } from 'vue'

const props = defineProps({
	visible: { type: Boolean, default: false },
	count: { type: Number, default: 0 },
	storeName: { type: String, default: 'etiniabox' },
	qrcodeUrl: { type: String, default: '' },
	logoUrl: { type: String, default: '' }
})
const emit = defineEmits(['close'])

watch(() => props.visible, (v: boolean) => {
	if (v) setTimeout(draw, 300) // 等 canvas 挂载
})

// 海报仅含店铺信息与打卡文案，不含用户照片与任何个人信息；全程本机合成
function draw() {
	const ctx = uni.createCanvasContext('posterCanvas')
	// 画布逻辑尺寸 300 x 480 px
	ctx.setFillStyle('#FFFFFF')
	ctx.fillRect(0, 0, 300, 480)
	ctx.setFillStyle('#1A1A1A')
	ctx.setFontSize(24)
	ctx.fillText(props.storeName, 20, 50)
	if (props.logoUrl != '') {
		ctx.drawImage(props.logoUrl, 20, 70, 260, 150)
	}
	ctx.setFillStyle('#444444')
	ctx.setFontSize(16)
	ctx.fillText('我在 ' + props.storeName + ' 完成第 ' + props.count + ' 次打卡', 20, 252)
	if (props.qrcodeUrl != '') {
		ctx.drawImage(props.qrcodeUrl, 90, 280, 120, 120)
	} else {
		ctx.setFillStyle('#F2F2F2')
		ctx.fillRect(90, 280, 120, 120)
	}
	ctx.setFillStyle('#999999')
	ctx.setFontSize(12)
	ctx.fillText('扫码进入小程序 · 到店打卡', 88, 420)
	ctx.draw()
}

function save() {
	uni.canvasToTempFilePath({
		canvasId: 'posterCanvas',
		destWidth: 600,
		destHeight: 960,
		success: (res) => {
			uni.saveImageToPhotosAlbum({
				filePath: res.tempFilePath,
				success: () => { uni.showToast({ title: '已保存到相册', icon: 'success' }) },
				fail: () => {
					// 相册授权被拒：引导去设置页开启
					uni.showModal({
						title: '无法保存',
						content: '需要相册写入权限，请在设置中开启后重试',
						confirmText: '去设置',
						success: (m) => { if (m.confirm) uni.openSetting({}) }
					})
				}
			})
		},
		fail: () => { uni.showToast({ title: '海报生成失败', icon: 'none' }) }
	})
}

function close() {
	emit('close')
}
</script>

<style>
	.mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
	.popup { background-color: #FFFFFF; border-radius: 24rpx; padding: 32rpx; width: 600rpx; display: flex; flex-direction: column; align-items: center; }
	.poster-canvas { width: 300px; height: 480px; }
	.btn-row { display: flex; flex-direction: row; margin-top: 24rpx; width: 100%; }
	.btn { flex: 1; background-color: #1A1A1A; color: #FFFFFF; border-radius: 40rpx; margin: 0 8rpx; }
	.btn-plain { background-color: #F2F2F2; color: #1A1A1A; }
</style>
```

- [ ] **Step 2: 编译验证（真机或模拟器）**

打卡页点击打卡（首次）→ 弹出海报弹层。
预期：canvas 显示白底海报，含店名、“我在 etiniabox 完成第 1 次打卡”、二维码（未配置时为灰块）；点“保存到相册”→ 首次弹相册授权 → 允许后提示“已保存到相册”；拒绝后保存 → 出现引导弹窗 →“去设置”打开设置页。生成的图片可用相册预览。

- [ ] **Step 3: 提交**

```bash
git add components/poster-popup.uvue && git commit -m "feat: 分享海报（canvas 本机合成 + 相册保存 + 授权引导）"
```

---

### Task 12: 管理首页（身份门禁 + 活动列表操作）

**Files:**
- Modify: `pages/admin/index.uvue`（重写）

- [ ] **Step 1: 重写 admin/index.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<view class="nav-cards">
			<view class="nav-card" @click="goNewPackage"><text class="nav-title">新增套餐</text></view>
			<view class="nav-card" @click="goPackageList"><text class="nav-title">套餐列表管理</text></view>
			<view class="nav-card" @click="goNewCampaign"><text class="nav-title">新增活动</text></view>
			<view class="nav-card" @click="goStoreInfo"><text class="nav-title">门店信息维护</text></view>
		</view>

		<view class="section-head"><text class="section-title">活动管理</text><text class="new-link" @click="goNewCampaign">＋ 新增</text></view>
		<view v-if="campaigns.length > 0">
			<view class="camp-row" v-for="c in campaigns" :key="c.id">
				<view class="camp-info">
					<text class="camp-title">{{ c.title }}</text>
					<text class="camp-meta">{{ c.season }} · {{ c.startDate }} 至 {{ c.endDate }} · {{ statusText(c) }}</text>
				</view>
				<view class="op-row">
					<text class="op" @click="editCampaign(c.id)">编辑</text>
					<text class="op" @click="toggleCampaign(c)">{{ c.status == 'upper' ? '下架' : '上架' }}</text>
					<text class="op op-danger" @click="removeCampaign(c.id)">删除</text>
				</view>
			</view>
		</view>
		<view v-else class="empty"><text class="empty-text">暂无活动，点右上「＋ 新增」创建</text></view>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { checkAdmin, adminListCampaigns, adminSetCampaignStatus, adminDeleteCampaign, CampaignItem } from '../../utils/cloud.uts'

const campaigns = ref<CampaignItem[]>([])

onShow(() => {
	gate()
})

/** 门禁：非白名单用户直接退出（页面入口本身已隐藏，双保险） */
async function gate() {
	try {
		const ok = await checkAdmin()
		if (!ok) {
			uni.showToast({ title: '无管理权限', icon: 'none' })
			setTimeout(() => { uni.navigateBack({}) }, 800)
			return
		}
		loadCampaigns()
	} catch (e) {
		uni.showToast({ title: '网络异常', icon: 'none' })
	}
}

async function loadCampaigns() {
	try {
		campaigns.value = await adminListCampaigns()
	} catch (e) {
		uni.showToast({ title: '加载失败', icon: 'none' })
	}
}

function statusText(c: CampaignItem): string {
	if (c.status != 'upper') return '已下架'
	return c.expired ? '已结束' : '进行中'
}

function goNewPackage() { uni.navigateTo({ url: '/pages/admin/package-edit' }) }
function goPackageList() { uni.navigateTo({ url: '/pages/package/list?admin=1' }) }
function goNewCampaign() { uni.navigateTo({ url: '/pages/admin/campaign-edit' }) }
function goStoreInfo() { uni.navigateTo({ url: '/pages/admin/store-info' }) }
function editCampaign(id: string) { uni.navigateTo({ url: '/pages/admin/campaign-edit?id=' + id }) }

function toggleCampaign(c: CampaignItem) {
	const target = c.status == 'upper' ? 'lower' : 'upper'
	adminSetCampaignStatus(c.id, target).then(() => {
		uni.showToast({ title: '已更新', icon: 'success' })
		loadCampaigns()
	}).catch((e: Error) => { uni.showToast({ title: e.message, icon: 'none' }) })
}

function removeCampaign(id: string) {
	uni.showModal({
		title: '确认删除',
		content: '删除后顾客端不可见（软删除，可联系开发者恢复）',
		success: (m) => {
			if (m.confirm) {
				adminDeleteCampaign(id).then(() => { uni.showToast({ title: '已删除', icon: 'success' }); loadCampaigns() })
			}
		}
	})
}
</script>

<style>
	.page { padding: 24rpx; }
	.nav-cards { display: flex; flex-direction: row; flex-wrap: wrap; }
	.nav-card { width: 306rpx; background-color: #FFFFFF; border-radius: 24rpx; padding: 40rpx 32rpx; margin: 0 24rpx 24rpx 0; }
	.nav-card:nth-child(2n) { margin-right: 0; }
	.nav-title { font-size: 30rpx; font-weight: bold; }
	.section-head { display: flex; flex-direction: row; justify-content: space-between; margin: 16rpx 8rpx 16rpx; }
	.section-title { font-size: 32rpx; font-weight: bold; }
	.new-link { color: #1677FF; font-size: 28rpx; }
	.camp-row { background-color: #FFFFFF; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }
	.camp-info { display: flex; flex-direction: column; }
	.camp-title { font-size: 30rpx; font-weight: bold; }
	.camp-meta { font-size: 24rpx; color: #999999; margin-top: 8rpx; }
	.op-row { display: flex; flex-direction: row; justify-content: flex-end; margin-top: 16rpx; }
	.op { color: #1677FF; font-size: 26rpx; margin-left: 32rpx; }
	.op-danger { color: #C85A54; }
	.empty { align-items: center; padding: 48rpx; }
	.empty-text { color: #999999; font-size: 28rpx; }
</style>
```

- [ ] **Step 2: 编译验证（门禁双向）**

1. 当前设备在白名单内：门店页应显示「进入管理」→ 进入后看到 4 个导航卡与空活动列表。
2. 临时把 `admin_config.openids` 清空（控制台编辑文档）：重进小程序，「进入管理」入口消失；Console 直接 `wx.cloud.callFunction({name:'admin',data:{action:'deletePackage',payload:{id:'x'}}})` 返回 `{code:403}`。验证后把 openid 恢复。

- [ ] **Step 3: 提交**

```bash
git add pages/admin/index.uvue && git commit -m "feat: 管理首页（白名单门禁 + 活动列表管理操作）"
```

---

### Task 13: 套餐管理（编辑页 + 列表管理操作）

**Files:**
- Modify: `pages/admin/package-edit.uvue`（重写）
- Modify: `pages/package/list.uvue`（追加管理操作）

- [ ] **Step 1: 重写 admin/package-edit.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<text class="label">套餐名称（必填，≤30字）</text>
		<input class="input" v-model="name" maxlength="30" placeholder="如：清新写真套餐" />

		<text class="label">封面图（必填）</text>
		<view class="img-add" @click="chooseCover">
			<image v-if="coverPreview != ''" class="cover-preview" :src="coverPreview" mode="aspectFill" />
			<text v-else class="add-text">＋ 选择图片</text>
		</view>

		<text class="label">一句话简介（≤40字）</text>
		<input class="input" v-model="summary" maxlength="40" placeholder="一句话介绍套餐亮点" />

		<text class="label">展示价格（仅展示，不交易）</text>
		<input class="input" v-model="priceDisplay" maxlength="20" placeholder="如：￥299 起" />

		<text class="label">参数明细（至少 1 行）</text>
		<view class="param-edit" v-for="(p, i) in params" :key="i">
			<input class="param-input" v-model="p.paramName" maxlength="12" placeholder="参数名（如：精修）" />
			<input class="param-input" v-model="p.paramValue" maxlength="30" placeholder="参数值（如：15 张）" />
			<text class="op" v-if="params.length > 1" @click="removeParam(i)">删除</text>
		</view>
		<text class="add-param" @click="addParam">＋ 添加参数行</text>

		<text class="label">详情图（多选）</text>
		<view class="img-row">
			<view class="img-item" v-for="(u, i) in detailPreviews" :key="i">
				<image class="detail-img" :src="u" mode="aspectFill" />
				<text class="img-del" @click="removeDetail(i)">×</text>
			</view>
			<view class="img-add small" @click="chooseDetails"><text class="add-text">＋</text></view>
		</view>

		<view class="switch-row">
			<text class="label inline">首页推荐</text>
			<switch :checked="isFeatured" @change="onFeaturedChange" />
		</view>
		<view class="switch-row">
			<text class="label inline">上架</text>
			<switch :checked="status == 'upper'" @change="onStatusChange" />
		</view>

		<text class="label">排序值（越小越靠前）</text>
		<input class="input" type="number" v-model="sort" placeholder="0" />

		<button class="save-btn" @click="save">保存</button>
		<button class="btn-plain" @click="cancel">取消</button>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { adminGetPackageById, adminSavePackage, uploadImage, PackageItem, PackageParam } from '../../utils/cloud.uts'

const id = ref('')
const name = ref('')
const coverImage = ref('')      // fileID 或 ''
const coverPreview = ref('')    // 预览：新图为本地临时路径，旧图为临时链接
const summary = ref('')
const priceDisplay = ref('')
const params = ref<PackageParam[]>([{ paramName: '', paramValue: '' }])
const detailImages = ref<string[]>([])      // fileID 列表
const detailPreviews = ref<string[]>([])    // 与 detailImages 一一对应的预览
const isFeatured = ref(false)
const status = ref('upper')
const sort = ref(0)

onLoad((option) => {
	const pid = option?.id ?? ''
	if (pid != '') load(pid)
})

async function load(pid: string) {
	try {
		const data: PackageItem | null = await adminGetPackageById(pid)
		if (data == null) return
		id.value = data.id
		name.value = data.name
		coverImage.value = data.coverImage
		coverPreview.value = data.coverImageUrl
		summary.value = data.summary
		priceDisplay.value = data.priceDisplay
		params.value = data.params.length > 0 ? data.params : [{ paramName: '', paramValue: '' }]
		detailImages.value = data.detailImages
		detailPreviews.value = data.detailImageUrls
		isFeatured.value = data.isFeatured
		status.value = data.status
		sort.value = data.sort
	} catch (e) {
		uni.showToast({ title: '加载失败', icon: 'none' })
	}
}

function chooseCover() {
	uni.chooseImage({
		count: 1,
		success: (res) => {
			const p = res.tempFilePaths[0]
			uploadImage(p, 'packages').then((fileID: string) => {
				coverImage.value = fileID
				coverPreview.value = p
			}).catch((e: Error) => uni.showToast({ title: e.message, icon: 'none' }))
		}
	})
}

function chooseDetails() {
	uni.chooseImage({
		count: 9,
		success: (res) => {
			const paths = res.tempFilePaths
			paths.forEach((p: string) => {
				uploadImage(p, 'packages').then((fileID: string) => {
					detailImages.value.push(fileID)
					detailPreviews.value.push(p)
				}).catch((e: Error) => uni.showToast({ title: e.message, icon: 'none' }))
			})
		}
	})
}

function removeDetail(i: number) {
	detailImages.value.splice(i, 1)
	detailPreviews.value.splice(i, 1)
}

function addParam() {
	params.value.push({ paramName: '', paramValue: '' } as PackageParam)
}
function removeParam(i: number) {
	params.value.splice(i, 1)
}
function onFeaturedChange(e: any) { isFeatured.value = e.detail.value }
function onStatusChange(e: any) { status.value = e.detail.value ? 'upper' : 'lower' }

function save() {
	if (name.value.trim() == '') { uni.showToast({ title: '请填写套餐名称', icon: 'none' }); return }
	if (coverImage.value == '') { uni.showToast({ title: '请上传封面图', icon: 'none' }); return }
	if (params.value.length < 1) { uni.showToast({ title: '至少一行参数', icon: 'none' }); return }
	for (let i = 0; i < params.value.length; i++) {
		const p = params.value[i]
		if (p.paramName.trim() == '' || p.paramValue.trim() == '') {
			uni.showToast({ title: '参数名与参数值不能为空', icon: 'none' }); return
		}
	}
	uni.showLoading({ title: '保存中' })
	adminSavePackage({
		id: id.value, name: name.value, coverImage: coverImage.value, coverImageUrl: '',
		summary: summary.value, priceDisplay: priceDisplay.value, params: params.value,
		detailImages: detailImages.value, detailImageUrls: [],
		isFeatured: isFeatured.value, sort: sort.value, status: status.value
	} as PackageItem).then(() => {
		uni.hideLoading()
		uni.showToast({ title: '已保存', icon: 'success' })
		setTimeout(() => { uni.navigateBack({}) }, 600)
	}).catch((e: Error) => {
		uni.hideLoading()
		uni.showToast({ title: e.message, icon: 'none' })
	})
}

function cancel() { uni.navigateBack({}) }
</script>

<style>
	.page { padding: 24rpx; }
	.label { font-size: 26rpx; color: #666666; margin: 24rpx 8rpx 12rpx; }
	.label.inline { margin: 0; }
	.input { background-color: #FFFFFF; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
	.img-add { background-color: #FFFFFF; border-radius: 16rpx; height: 240rpx; display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.img-add.small { width: 160rpx; height: 160rpx; }
	.cover-preview { width: 100%; height: 240rpx; }
	.add-text { color: #999999; font-size: 40rpx; }
	.param-edit { display: flex; flex-direction: row; align-items: center; margin-bottom: 12rpx; }
	.param-input { flex: 1; background-color: #FFFFFF; border-radius: 16rpx; padding: 16rpx 20rpx; font-size: 26rpx; margin-right: 12rpx; }
	.op { color: #C85A54; font-size: 26rpx; }
	.add-param { color: #1677FF; font-size: 26rpx; padding: 12rpx 8rpx; }
	.img-row { display: flex; flex-direction: row; flex-wrap: wrap; }
	.img-item { position: relative; margin: 0 12rpx 12rpx 0; }
	.detail-img { width: 160rpx; height: 160rpx; border-radius: 12rpx; }
	.img-del { position: absolute; top: -10rpx; right: -10rpx; width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center; background-color: #1A1A1A; color: #FFFFFF; border-radius: 20rpx; font-size: 24rpx; }
	.switch-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-top: 24rpx; }
	.save-btn { margin-top: 40rpx; background-color: #1A1A1A; color: #FFFFFF; border-radius: 44rpx; }
	.btn-plain { margin-top: 16rpx; background-color: #F2F2F2; color: #1A1A1A; border-radius: 44rpx; }
</style>
```

- [ ] **Step 2: list.uvue 追加管理操作**

在 `pages/package/list.uvue` 的模板 `pkg-card` 内（`info` view 之后）追加：

```vue
			<view v-if="adminMode" class="op-row">
				<text class="op" @click.stop="editPkg(p.id)">编辑</text>
				<text class="op" @click.stop="togglePkg(p)">{{ p.status == 'upper' ? '下架' : '上架' }}</text>
				<text class="op op-danger" @click.stop="removePkg(p.id)">删除</text>
			</view>
```

script 部分追加（import 行补 `adminSetPackageStatus, adminDeletePackage`）：

```uts
const adminMode = ref(false)

onLoad((option) => {
	// #ifdef MP-WEIXIN
	if ((option?.admin ?? '') == '1') {
		checkAdmin().then((ok: boolean) => { adminMode.value = ok }).catch(() => { adminMode.value = false })
	}
	// #endif
})
```

并把 `onShow` 中 `loadData()` 前的取数改为：管理模式下仍调 `listPackages()`（只显示上架）——编辑已下架套餐入口在管理首页「套餐列表管理」看不到已下架项，因此再补一段：管理模式下额外拉 `adminGetPackageById` 不可行（无全量接口）。**简化处理（记录为已知限制）**：V1 管理列表只覆盖上架套餐；已下架套餐通过管理首页后续版本补「全部套餐」视图。为满足 PRD「列表页：展示全部套餐（含已下架）」，在本任务同时给 `data` 云函数加一个管理复用读接口：在 `cloudfunctions/data/index.js` 的 switch 中追加 case：

```js
      case 'listPackagesAdmin': {
        const res = await db.collection('packages')
          .where({ deleted: false }).orderBy('sort', 'asc').limit(50).get()
        const docs = res.data || []
        const urls = await toUrls(docs.flatMap((d) => [d.cover_image, ...(d.detail_images || [])]))
        return ok(docs.map((d) => mapPackage(d, urls)))
      }
```

在 `utils/cloud.uts` 追加：

```uts
export function adminListPackages(): Promise<PackageItem[]> {
	return callCloud('data', 'listPackagesAdmin', null).then((d: any) => {
		const arr = (d ?? []) as Array<any>
		return arr.map((o: any): PackageItem => toPackage(o as UTSJSONObject))
	})
}
```

list.uvue 的 `loadData()` 改为：

```uts
async function loadData() {
	try {
		if (adminMode.value) {
			list.value = await adminListPackages()
		} else {
			list.value = await listPackages()
		}
		loadingFailed.value = false
	} catch (e) {
		loadingFailed.value = true
	}
}
```

注意 `onLoad` 需在文件顶部补 import（`onLoad` 加入 `@dcloudio/uni-app` 的 import）。样式追加：

```css
	.op-row { display: flex; flex-direction: row; justify-content: flex-end; padding: 0 24rpx 24rpx; }
	.op { color: #1677FF; font-size: 26rpx; margin-left: 32rpx; }
	.op-danger { color: #C85A54; }
```

管理操作函数：

```uts
function editPkg(id: string) {
	uni.navigateTo({ url: '/pages/admin/package-edit?id=' + id })
}
function togglePkg(p: PackageItem) {
	const target = p.status == 'upper' ? 'lower' : 'upper'
	adminSetPackageStatus(p.id, target).then(() => { uni.showToast({ title: '已更新', icon: 'success' }); loadData() })
}
function removePkg(id: string) {
	uni.showModal({
		title: '确认删除',
		content: '删除后顾客端不可见（软删除）',
		success: (m) => { if (m.confirm) adminDeletePackage(id).then(() => { uni.showToast({ title: '已删除', icon: 'success' }); loadData() }) }
	})
}
```

`goDetail` 保持不变（管理模式下点卡片仍进详情）。

- [ ] **Step 3: 重新部署 data 云函数并编译验证**

右键 `cloudfunctions/data` 重新上传部署。
1. 管理首页 → 新增套餐：填名称、传封面、加两行参数、勾首页推荐 → 保存 → 返回列表可见。
2. 列表管理操作：下架 → 顾客态列表消失；上架恢复。
3. 编辑回显：字段与图片正确回显（旧图预览来自临时链接）。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 套餐管理（新建/编辑/上下架/删除 + 全量列表管理视图）"
```

---

### Task 14: 活动管理（编辑页）

**Files:**
- Modify: `pages/admin/campaign-edit.uvue`（重写）

- [ ] **Step 1: 重写 admin/campaign-edit.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<text class="label">活动主题（必填，≤30字）</text>
		<input class="input" v-model="title" maxlength="30" placeholder="如：盛夏毕业季特惠" />

		<text class="label">季度标识</text>
		<picker :range="seasonOptions" @change="onSeasonChange">
			<view class="input"><text>{{ season == '' ? '请选择季度' : season }}</text></view>
		</picker>

		<text class="label">海报图（必填）</text>
		<view class="img-add" @click="chooseBanner">
			<image v-if="bannerPreview != ''" class="cover-preview" :src="bannerPreview" mode="aspectFill" />
			<text v-else class="add-text">＋ 选择海报</text>
		</view>

		<text class="label">活动说明（图文块，可排序）</text>
		<view class="block-edit" v-for="(b, i) in blocks" :key="i">
			<textarea v-if="b.type == 'text'" class="textarea" v-model="b.text" maxlength="500" placeholder="输入文字段落" />
			<view v-else class="block-img-wrap">
				<image class="block-img" :src="b.imageUrl" mode="widthFix" />
				<text class="block-hint">图片块</text>
			</view>
			<view class="block-ops">
				<text class="op" @click="moveBlock(i, -1)">上移</text>
				<text class="op" @click="moveBlock(i, 1)">下移</text>
				<text class="op op-danger" @click="removeBlock(i)">删除</text>
			</view>
		</view>
		<view class="add-row">
			<text class="add-link" @click="addTextBlock">＋ 文字段</text>
			<text class="add-link" @click="addImageBlock">＋ 图片</text>
		</view>

		<text class="label">有效期</text>
		<view class="date-row">
			<picker mode="date" :value="startDate" @change="onStartChange">
				<view class="input half"><text>{{ startDate == '' ? '开始日期' : startDate }}</text></view>
			</picker>
			<text class="date-sep">至</text>
			<picker mode="date" :value="endDate" @change="onEndChange">
				<view class="input half"><text>{{ endDate == '' ? '结束日期' : endDate }}</text></view>
			</picker>
		</view>

		<view class="switch-row">
			<text class="label inline">上架</text>
			<switch :checked="status == 'upper'" @change="onStatusChange" />
		</view>
		<text class="label">排序值（越小越靠前）</text>
		<input class="input" type="number" v-model="sort" placeholder="0" />

		<button class="save-btn" @click="save">保存</button>
		<button class="btn-plain" @click="cancel">取消</button>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { adminGetCampaignById, adminSaveCampaign, uploadImage, DescriptionBlock } from '../../utils/cloud.uts'

const id = ref('')
const title = ref('')
const season = ref('')
const bannerImage = ref('')
const bannerPreview = ref('')
const blocks = ref<DescriptionBlock[]>([])
const startDate = ref('')
const endDate = ref('')
const status = ref('upper')
const sort = ref(0)

const seasonOptions = ref<string[]>([])
{
	const arr: string[] = []
	for (let y = 2025; y <= 2027; y++) {
		arr.push(y + '-Q1'); arr.push(y + '-Q2'); arr.push(y + '-Q3'); arr.push(y + '-Q4')
	}
	seasonOptions.value = arr
}

onLoad((option) => {
	const cid = option?.id ?? ''
	if (cid != '') load(cid)
})

async function load(cid: string) {
	try {
		const data = await adminGetCampaignById(cid)
		if (data == null) return
		id.value = data.id
		title.value = data.title
		season.value = data.season
		bannerImage.value = data.bannerImage
		bannerPreview.value = data.bannerImageUrl
		blocks.value = data.descriptionBlocks
		startDate.value = data.startDate
		endDate.value = data.endDate
		status.value = data.status
		sort.value = data.sort
	} catch (e) {
		uni.showToast({ title: '加载失败', icon: 'none' })
	}
}

function onSeasonChange(e: any) { season.value = seasonOptions.value[e.detail.value] }

function chooseBanner() {
	uni.chooseImage({
		count: 1,
		success: (res) => {
			const p = res.tempFilePaths[0]
			uploadImage(p, 'campaigns').then((fileID: string) => {
				bannerImage.value = fileID
				bannerPreview.value = p
			}).catch((e: Error) => uni.showToast({ title: e.message, icon: 'none' }))
		}
	})
}

function addTextBlock() { blocks.value.push({ type: 'text', text: '', image: '', imageUrl: '' } as DescriptionBlock) }
function addImageBlock() {
	uni.chooseImage({
		count: 1,
		success: (res) => {
			const p = res.tempFilePaths[0]
			uploadImage(p, 'campaigns').then((fileID: string) => {
				blocks.value.push({ type: 'image', text: '', image: fileID, imageUrl: p } as DescriptionBlock)
			}).catch((e: Error) => uni.showToast({ title: e.message, icon: 'none' }))
		}
	})
}
function moveBlock(i: number, delta: number) {
	const j = i + delta
	if (j < 0 || j >= blocks.value.length) return
	const tmp = blocks.value[i]
	blocks.value[i] = blocks.value[j]
	blocks.value[j] = tmp
}
function removeBlock(i: number) { blocks.value.splice(i, 1) }

function onStartChange(e: any) { startDate.value = e.detail.value }
function onEndChange(e: any) { endDate.value = e.detail.value }
function onStatusChange(e: any) { status.value = e.detail.value ? 'upper' : 'lower' }

function save() {
	if (title.value.trim() == '') { uni.showToast({ title: '请填写活动主题', icon: 'none' }); return }
	if (bannerImage.value == '') { uni.showToast({ title: '请上传海报图', icon: 'none' }); return }
	if (startDate.value == '' || endDate.value == '') { uni.showToast({ title: '请选择有效期', icon: 'none' }); return }
	if (endDate.value < startDate.value) { uni.showToast({ title: '结束日期不能早于开始日期', icon: 'none' }); return }
	uni.showLoading({ title: '保存中' })
	adminSaveCampaign({
		id: id.value, title: title.value, season: season.value,
		bannerImage: bannerImage.value, bannerImageUrl: '',
		descriptionBlocks: blocks.value,
		startDate: startDate.value, endDate: endDate.value,
		sort: sort.value, status: status.value, expired: false
	}).then(() => {
		uni.hideLoading()
		uni.showToast({ title: '已保存', icon: 'success' })
		setTimeout(() => { uni.navigateBack({}) }, 600)
	}).catch((e: Error) => {
		uni.hideLoading()
		uni.showToast({ title: e.message, icon: 'none' })
	})
}

function cancel() { uni.navigateBack({}) }
</script>

<style>
	.page { padding: 24rpx; }
	.label { font-size: 26rpx; color: #666666; margin: 24rpx 8rpx 12rpx; }
	.label.inline { margin: 0; }
	.input { background-color: #FFFFFF; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
	.input.half { flex: 1; text-align: center; }
	.img-add { background-color: #FFFFFF; border-radius: 16rpx; height: 300rpx; display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.cover-preview { width: 100%; height: 300rpx; }
	.add-text { color: #999999; font-size: 40rpx; }
	.block-edit { background-color: #FFFFFF; border-radius: 16rpx; padding: 20rpx; margin-bottom: 16rpx; }
	.textarea { width: 100%; height: 140rpx; font-size: 26rpx; }
	.block-img-wrap { display: flex; flex-direction: column; }
	.block-img { width: 100%; border-radius: 12rpx; }
	.block-hint { font-size: 22rpx; color: #999999; margin-top: 8rpx; }
	.block-ops { display: flex; flex-direction: row; justify-content: flex-end; margin-top: 12rpx; }
	.op { color: #1677FF; font-size: 24rpx; margin-left: 24rpx; }
	.op-danger { color: #C85A54; }
	.add-row { display: flex; flex-direction: row; }
	.add-link { color: #1677FF; font-size: 26rpx; margin-right: 32rpx; padding: 12rpx 0; }
	.date-row { display: flex; flex-direction: row; align-items: center; }
	.date-sep { margin: 0 16rpx; color: #999999; }
	.switch-row { display: flex; flex-direction: row; justify-content: space-between; align-items: center; margin-top: 24rpx; }
	.save-btn { margin-top: 40rpx; background-color: #1A1A1A; color: #FFFFFF; border-radius: 44rpx; }
	.btn-plain { margin-top: 16rpx; background-color: #F2F2F2; color: #1A1A1A; border-radius: 44rpx; }
</style>
```

- [ ] **Step 2: 编译验证（闭环）**

1. 管理首页 → 新增活动：主题/季度/海报/说明（一文字一图片）/有效期 → 保存 → 管理首页列表出现该活动。
2. 首页轮播出现海报 → 点击进入活动详情，图文块按顺序显示。
3. 把结束日期改为昨天保存 → 首页轮播消失，管理列表显示「已结束」，详情页显示「活动已结束」标签。
4. 删除活动 → 顾客端不可见。

- [ ] **Step 3: 提交**

```bash
git add pages/admin/campaign-edit.uvue && git commit -m "feat: 活动管理（图文块编辑/排序/有效期/上下架）"
```

---

### Task 15: 门店信息维护页

**Files:**
- Modify: `pages/admin/store-info.uvue`（重写）

- [ ] **Step 1: 重写 admin/store-info.uvue**

```vue
<template>
	<scroll-view class="page" scroll-y>
		<text class="label">门店名称</text>
		<input class="input" v-model="storeName" maxlength="30" placeholder="店铺名称" />

		<text class="label">店铺 LOGO</text>
		<view class="img-add small" @click="chooseLogo">
			<image v-if="logoPreview != ''" class="logo-preview" :src="logoPreview" mode="aspectFill" />
			<text v-else class="add-text">＋</text>
		</view>

		<text class="label">店铺介绍（≤500字）</text>
		<textarea class="textarea" v-model="intro" maxlength="500" placeholder="介绍店铺风格、团队、特色" />

		<text class="label">店内环境相册（多选）</text>
		<view class="img-row">
			<view class="img-item" v-for="(u, i) in photoPreviews" :key="i">
				<image class="detail-img" :src="u" mode="aspectFill" />
				<text class="img-del" @click="removePhoto(i)">×</text>
			</view>
			<view class="img-add small" @click="choosePhotos"><text class="add-text">＋</text></view>
		</view>

		<text class="label">营业时间</text>
		<input class="input" v-model="businessHours" maxlength="100" placeholder="如：10:00-20:00，周一店休" />

		<text class="label">门店地址</text>
		<input class="input" v-model="address" maxlength="100" placeholder="文本地址" />

		<text class="label">地图位置（点击选点，用于顾客导航）</text>
		<view class="input" @click="chooseLocation">
			<text>{{ (longitude != 0 && latitude != 0) ? ('已选：' + longitude + ', ' + latitude) : '点击选择地图位置' }}</text>
		</view>

		<text class="label">联系电话（展示用）</text>
		<input class="input" type="number" v-model="contactPhone" maxlength="20" placeholder="如：0755-12345678" />

		<text class="label">店铺小程序码（用于顾客分享海报，找开发者生成后上传）</text>
		<view class="img-add small" @click="chooseQrcode">
			<image v-if="qrcodePreview != ''" class="logo-preview" :src="qrcodePreview" mode="aspectFill" />
			<text v-else class="add-text">＋</text>
		</view>

		<button class="save-btn" @click="save">保存</button>
	</scroll-view>
</template>

<script setup lang="uts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getStoreInfo, adminSaveStoreInfo, uploadImage, StoreInfo } from '../../utils/cloud.uts'

const storeName = ref('')
const logo = ref('')
const logoPreview = ref('')
const intro = ref('')
const photos = ref<string[]>([])
const photoPreviews = ref<string[]>([])
const businessHours = ref('')
const address = ref('')
const longitude = ref(0)
const latitude = ref(0)
const contactPhone = ref('')
const qrcodeImage = ref('')
const qrcodePreview = ref('')

onShow(() => {
	load()
})

async function load() {
	try {
		const info: StoreInfo | null = await getStoreInfo()
		if (info != null) {
			storeName.value = info.storeName
			logo.value = info.logo
			logoPreview.value = info.logoUrl
			intro.value = info.intro
			photos.value = info.photos
			photoPreviews.value = info.photoUrls
			businessHours.value = info.businessHours
			address.value = info.address
			longitude.value = info.longitude
			latitude.value = info.latitude
			contactPhone.value = info.contactPhone
			qrcodeImage.value = info.qrcodeImage
			qrcodePreview.value = info.qrcodeImageUrl
		}
	} catch (e) {
		// 首次为空属正常
	}
}

function chooseLogo() {
	uni.chooseImage({
		count: 1,
		success: (res) => {
			const p = res.tempFilePaths[0]
			uploadImage(p, 'store').then((f: string) => { logo.value = f; logoPreview.value = p })
		}
	})
}
function choosePhotos() {
	uni.chooseImage({
		count: 9,
		success: (res) => {
			res.tempFilePaths.forEach((p: string) => {
				uploadImage(p, 'store').then((f: string) => { photos.value.push(f); photoPreviews.value.push(p) })
			})
		}
	})
}
function removePhoto(i: number) {
	photos.value.splice(i, 1)
	photoPreviews.value.splice(i, 1)
}
function chooseQrcode() {
	uni.chooseImage({
		count: 1,
		success: (res) => {
			const p = res.tempFilePaths[0]
			uploadImage(p, 'store').then((f: string) => { qrcodeImage.value = f; qrcodePreview.value = p })
		}
	})
}
function chooseLocation() {
	// 管理端店主主动触发地图选点
	uni.chooseLocation({
		success: (res) => {
			longitude.value = res.longitude
			latitude.value = res.latitude
			if (address.value == '') address.value = res.address
		},
		fail: () => { uni.showToast({ title: '未选择位置', icon: 'none' }) }
	})
}

function save() {
	uni.showLoading({ title: '保存中' })
	adminSaveStoreInfo({
		storeName: storeName.value, logo: logo.value, logoUrl: logoPreview.value,
		intro: intro.value, photos: photos.value, photoUrls: photoPreviews.value,
		businessHours: businessHours.value, address: address.value,
		longitude: longitude.value, latitude: latitude.value,
		contactPhone: contactPhone.value,
		qrcodeImage: qrcodeImage.value, qrcodeImageUrl: qrcodePreview.value
	} as StoreInfo).then(() => {
		uni.hideLoading()
		uni.showToast({ title: '已保存', icon: 'success' })
	}).catch((e: Error) => {
		uni.hideLoading()
		uni.showToast({ title: e.message, icon: 'none' })
	})
}
</script>

<style>
	.page { padding: 24rpx; }
	.label { font-size: 26rpx; color: #666666; margin: 24rpx 8rpx 12rpx; }
	.label.inline { margin: 0; }
	.input { background-color: #FFFFFF; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
	.textarea { width: 100%; height: 200rpx; background-color: #FFFFFF; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
	.img-add { background-color: #FFFFFF; border-radius: 16rpx; height: 240rpx; display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.img-add.small { width: 160rpx; height: 160rpx; }
	.logo-preview { width: 160rpx; height: 160rpx; }
	.cover-preview { width: 100%; height: 240rpx; }
	.add-text { color: #999999; font-size: 40rpx; }
	.img-row { display: flex; flex-direction: row; flex-wrap: wrap; }
	.img-item { position: relative; margin: 0 12rpx 12rpx 0; }
	.detail-img { width: 160rpx; height: 160rpx; border-radius: 12rpx; }
	.img-del { position: absolute; top: -10rpx; right: -10rpx; width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center; background-color: #1A1A1A; color: #FFFFFF; border-radius: 20rpx; font-size: 24rpx; }
	.save-btn { margin: 40rpx 0 60rpx; background-color: #1A1A1A; color: #FFFFFF; border-radius: 44rpx; }
</style>
```

注意：`store_info` 保存接口接受 URL 字段但云函数只落库 fileID 字段（`storeInfoDoc` 已过滤），URL 字段仅为表单内复用 `StoreInfo` 类型，不影响数据。

- [ ] **Step 2: 编译验证（全链路）**

1. 填写门店信息（含地图选点、电话、LOGO、环境图）→ 保存。
2. 门店 Tab / 首页立即展示新信息；点击地址拉起地图；点电话弹拨号确认。
3. 上传小程序码图片 → 打卡页海报中出现真实二维码，扫码可进入小程序。

- [ ] **Step 3: 提交**

```bash
git add pages/admin/store-info.uvue && git commit -m "feat: 门店信息维护（图文/地图选点/小程序码上传）"
```

---

### Task 16: 页面分享与体验收尾

**Files:**
- Modify: `pages/index/index.uvue`、`pages/about/about.uvue`（追加分享）

- [ ] **Step 1: index.uvue 与 about.uvue 追加转发**

两个页面 script 内追加（index 的 path 用 `/pages/index/index`，about 用 `/pages/about/about`）：

```uts
// #ifdef MP-WEIXIN
onShareAppMessage((): { title: string; path: string } => {
	return { title: storeName.value + ' · 摄影写真', path: '/pages/index/index' }
})
// #endif
```

（`onShareAppMessage` 从 `@dcloudio/uni-app` 导入；若 uni-app x 当前版本无此生命周期导致编译报错，则删除该块，转发能力退化为默认分享，不阻塞验收。）

- [ ] **Step 2: 编译验证**

微信开发者工具中每个核心页面右上角「…」菜单 → 转发：卡片标题与路径正确（详情页带 id）。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: 核心页面转发分享"
```

---

### Task 17: PRD 验收走查与提审准备

**Files:**
- 无新增（按 PRD 第九章逐条人工走查）

- [ ] **Step 1: 验收清单走查（对照 PRD 第九章）**

逐项执行并记录结果：

1. 扫码进入：云开发控制台 → 云函数 `data` 不需要；用微信公众平台「生成小程序码」（scene 留空 → 进首页；scene=`checkin` → 直达打卡页）。打卡页 onLoad 需处理 scene：在 `pages/checkin/checkin.uvue` 补：

```uts
onLoad((option) => {
	// #ifdef MP-WEIXIN
	const scene = decodeURIComponent(option?.scene ?? '')
	if (scene == 'checkin') { /* 已在打卡 Tab，无需跳转；此分支仅为场景码留痕 */ }
	// #endif
})
```

2. 打卡规则：同日重复点击被限制；杀进程重进记录保留；页面有“记录保存在本机”说明。
3. 海报：含店铺码、扫码可进小程序；拒绝相册授权有“去设置”引导。
4. 套餐：下架后顾客端不可见；删除后不出现。
5. 活动：过期自动从轮播消失，详情显示“活动已结束”。
6. 合规：全流程无支付元素、无“购买/下单”字样、无个人信息授权弹窗（相册保存除外）。
7. 管理端：非白名单无入口、写接口 403。

- [ ] **Step 2: 提审准备（人工操作清单）**

1. 微信公众平台 → 版本管理：上传体验版，真机全流程回归一遍。
2. 配置《用户隐私保护指引》：声明不收集用户个人信息；说明“保存海报到相册”的相册写入授权用途；声明店主管理侧 openid 用于身份识别。
3. 类目：生活服务 — 摄影扩印，按平台要求上传资质。
4. 全局搜索代码确认无 `requestPayment`、无“立即购买/下单/支付”文案（`grep` 关键词检查）。
5. 提交审核。

- [ ] **Step 3: 终版提交**

```bash
git add -A && git commit -m "chore: V1.0 验收走查修复与提审准备"
```

---

## 自审记录（Self-Review）

1. **Spec 覆盖**：PRD 4.1.1-4.1.7 → Task 7/8/9/10/11/6；4.2.1-4.2.4 → Task 12/13/14/15；5.x 数据模型 → Task 3/4 与 `utils/cloud.uts`；6.x 非功能 → Task 2/16（性能依赖云函数 + CDN，懒加载通过列表页结构简化为一次性加载，符合 PRD 6.1“一次性加载即可”）；7.x 合规 → Task 4（文本安全）+ Task 17；9.x 验收 → Task 17。无遗漏。
2. **占位符扫描**：无 TBD/TODO；Task 5 占位页与 poster-popup 占位实现均为任务内明确的过渡物，并在后续任务中整体重写。
3. **类型一致性**：`PackageItem/CampaignItem/StoreInfo` 字段在云函数映射（Task 3/4）与服务层（Task 5）两侧一致；云函数入参 `payload.id/status` 等命名与测试用例一致；`listPackagesAdmin` 在 Task 13 增加后由 `adminListPackages()` 调用，命名已对齐。
4. **已知限制**：参数/图文块排序为按钮式（PRD 差异说明第 2 条）；图片机审为 best-effort（差异说明第 3 条）。
