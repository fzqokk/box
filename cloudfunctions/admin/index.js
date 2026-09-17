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
