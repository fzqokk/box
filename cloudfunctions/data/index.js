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

      case 'listPackagesAdmin': {
        const res = await db.collection('packages')
          .where({ deleted: false }).orderBy('sort', 'asc').limit(50).get()
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
