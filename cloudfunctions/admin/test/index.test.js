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
