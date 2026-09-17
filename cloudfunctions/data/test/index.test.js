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
  mockCloud.getTempFileURL.mockResolvedValue({ fileList: [{ fileID: 'cloud://c1', tempFileURL: 'https://t/c1', status: 0 }] })
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
