import type { DouyinAccountPreview, DouyinVideoItem, DouyinVideoPage } from '../../shared/tikhub'

export interface TikHubClientOptions {
  endpoint: string
  apiToken: string
  timeoutSeconds: number
  onUsage?: (entry: {
    path: string
    ok: boolean
    statusCode?: number | null
    message?: string | null
  }) => void
}

const SKIP_USAGE_LOG_PREFIX = '/api/v1/tikhub/user/'

interface TikHubEnvelope {
  code?: number
  message?: string
  message_zh?: string
  data?: unknown
  api_key_data?: {
    api_key_name?: string
  }
  user_data?: {
    email?: string
    balance?: number
    free_credit?: number
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return 0
}

function firstUrlFromList(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  for (const entry of raw) {
    const url = asString(entry)
    if (url && /^https?:\/\//i.test(url)) return url
  }
  return null
}

function pickUrlCandidate(candidate: unknown): string | null {
  if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate
  const record = asRecord(candidate)
  if (!record) return null
  return (
    firstUrlFromList(record.url_list) ??
    asString(record.url) ??
    asString(record.uri)
  )
}

function pickAvatar(user: Record<string, unknown>): string | null {
  const candidates = [
    user.avatar_larger,
    user.avatar_medium,
    user.avatar_thumb,
    user.avatar_url,
    user.avatar,
  ]
  for (const candidate of candidates) {
    const url = pickUrlCandidate(candidate)
    if (url) return url
  }
  return null
}

function pickCover(video: Record<string, unknown>, item: Record<string, unknown>): string | null {
  const candidates = [
    video.cover,
    video.origin_cover,
    video.dynamic_cover,
    video.ai_static_cover,
    video.cover_url,
    item.cover,
    item.origin_cover,
    item.dynamic_cover,
    item.cover_url,
  ]
  for (const candidate of candidates) {
    const url = pickUrlCandidate(candidate)
    if (url) return url
  }
  return null
}

export function parseDouyinUserProfile(
  data: unknown,
  sourceInput: string,
): DouyinAccountPreview {
  const root = asRecord(data) ?? {}
  const user =
    asRecord(root.user) ??
    asRecord(asRecord(root.user_info)?.user) ??
    asRecord(root.user_info) ??
    root

  const secUserId =
    asString(user.sec_uid) ??
    asString(user.sec_user_id) ??
    asString(root.sec_uid) ??
    asString(root.sec_user_id)
  if (!secUserId) throw new Error('未能解析抖音用户 sec_user_id')

  const nickname =
    asString(user.nickname) ?? asString(user.nick_name) ?? asString(root.nickname) ?? '未命名账号'
  const uniqueId =
    asString(user.unique_id) ??
    asString(user.uniqueId) ??
    asString(user.short_id) ??
    asString(root.unique_id)
  const uid = asString(user.uid) ?? asString(user.user_id) ?? asString(root.uid)

  return {
    secUserId,
    uid,
    uniqueId,
    nickname,
    avatarUrl: pickAvatar(user),
    signature: asString(user.signature) ?? asString(user.desc),
    followerCount: asNumber(user.follower_count ?? user.mplatform_followers_count),
    followingCount: asNumber(user.following_count),
    awemeCount: asNumber(user.aweme_count),
    totalFavorited: asNumber(user.total_favorited ?? user.total_favorited_count),
    profileUrl: `https://www.douyin.com/user/${secUserId}`,
    sourceInput,
  }
}

function pickPlayUrl(video: Record<string, unknown>): string | null {
  const direct =
    firstUrlFromList(asRecord(video.play_addr)?.url_list) ??
    firstUrlFromList(asRecord(video.play_addr_h264)?.url_list) ??
    firstUrlFromList(asRecord(video.play_addr_265)?.url_list) ??
    firstUrlFromList(asRecord(video.download_addr)?.url_list) ??
    asString(video.play_url) ??
    asString(video.download_url)
  if (direct) return direct

  const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : []
  for (const entry of bitRates) {
    const row = asRecord(entry)
    if (!row) continue
    const url =
      firstUrlFromList(asRecord(row.play_addr)?.url_list) ??
      firstUrlFromList(asRecord(row.download_addr)?.url_list)
    if (url) return url
  }
  return null
}

function parseVideoItem(raw: unknown): DouyinVideoItem | null {
  const item = asRecord(raw)
  if (!item) return null
  const awemeId = asString(item.aweme_id) ?? asString(item.awemeId)
  if (!awemeId) return null
  const stats = asRecord(item.statistics) ?? {}
  const video = asRecord(item.video) ?? {}

  return {
    awemeId,
    description: asString(item.desc) ?? asString(item.description) ?? '',
    coverUrl: pickCover(video, item),
    playUrl: pickPlayUrl(video) ?? pickPlayUrl(item),
    createTime: asNumber(item.create_time) || null,
    diggCount: asNumber(stats.digg_count ?? item.digg_count),
    commentCount: asNumber(stats.comment_count ?? item.comment_count),
    shareCount: asNumber(stats.share_count ?? item.share_count),
    playCount: asNumber(stats.play_count ?? item.play_count),
    durationMs: asNumber(video.duration ?? item.duration) || null,
  }
}

export function parseDouyinVideoPage(data: unknown): DouyinVideoPage {
  const root = asRecord(data) ?? {}
  const list =
    (Array.isArray(root.aweme_list) && root.aweme_list) ||
    (Array.isArray(root.videos) && root.videos) ||
    (Array.isArray(root.list) && root.list) ||
    []

  const items = list
    .map((entry) => parseVideoItem(entry))
    .filter((entry): entry is DouyinVideoItem => Boolean(entry))

  return {
    items,
    maxCursor: asString(root.max_cursor) ?? asString(root.cursor) ?? '0',
    hasMore: Boolean(root.has_more ?? root.hasMore),
  }
}

async function requestJson(
  options: TikHubClientOptions,
  path: string,
  init: {
    method?: 'GET' | 'POST'
    query?: Record<string, string | number | undefined>
    body?: unknown
  } = {},
): Promise<TikHubEnvelope> {
  const endpoint = options.endpoint.replace(/\/+$/, '')
  const url = new URL(`${endpoint}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000)
  const shouldLog = !path.startsWith(SKIP_USAGE_LOG_PREFIX)
  const method = init.method ?? 'GET'

  const logUsage = (entry: {
    ok: boolean
    statusCode?: number | null
    message?: string | null
  }): void => {
    if (!shouldLog || !options.onUsage) return
    try {
      options.onUsage({ path, ...entry })
    } catch {
      // Usage logging must never break API calls.
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: TikHubEnvelope = {}
    try {
      payload = text ? (JSON.parse(text) as TikHubEnvelope) : {}
    } catch {
      const message = text || `TikHub 返回了无法解析的响应（HTTP ${String(response.status)}）`
      logUsage({ ok: false, statusCode: response.status, message })
      throw new Error(message)
    }

    if (!response.ok) {
      const message =
        payload.message_zh ||
        payload.message ||
        `TikHub 请求失败（HTTP ${String(response.status)}）`
      logUsage({ ok: false, statusCode: response.status, message })
      throw new Error(message)
    }

    if (typeof payload.code === 'number' && payload.code !== 200) {
      const message =
        payload.message_zh || payload.message || `TikHub 返回错误码 ${String(payload.code)}`
      logUsage({ ok: false, statusCode: response.status, message })
      throw new Error(message)
    }

    logUsage({ ok: true, statusCode: response.status, message: null })
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const message = 'TikHub 请求超时，请检查网络或调大超时时间'
      logUsage({ ok: false, statusCode: null, message })
      throw new Error(message)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchTikHubUserInfo(options: TikHubClientOptions): Promise<{
  email?: string
  balance?: number
  freeCredit?: number
  apiKeyName?: string
}> {
  const payload = await requestJson(options, '/api/v1/tikhub/user/get_user_info', {})
  return {
    email: payload.user_data?.email,
    balance: payload.user_data?.balance,
    freeCredit: payload.user_data?.free_credit,
    apiKeyName: payload.api_key_data?.api_key_name,
  }
}

function pickOptionalNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    if (record[key] === undefined || record[key] === null) continue
    return asNumber(record[key])
  }
  return undefined
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function unwrapDailyUsagePayload(data: unknown): Record<string, unknown> {
  let value: unknown = data
  if (typeof value === 'string' && value.trim()) {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return {}
    }
  }

  const today = localDateKey()
  if (Array.isArray(value)) {
    for (const entry of value) {
      const row = asRecord(entry)
      if (!row) continue
      const date =
        asString(row.date) ??
        asString(row.day) ??
        asString(row.usage_date) ??
        asString(row.stat_date)
      if (!date || date === today || date.startsWith(today)) return row
    }
    const last = asRecord(value[value.length - 1])
    return last ?? {}
  }

  const root = asRecord(value)
  if (!root) return {}

  // 形如 { "2026-11-11": { requests: 12 }, ... }
  const todayBucket = asRecord(root[today])
  if (todayBucket) return todayBucket

  // 已是单日对象
  if (
    root.requests !== undefined ||
    root.request_count !== undefined ||
    root.total_requests !== undefined ||
    root.cost !== undefined
  ) {
    return root
  }

  // 再兜一层 data / usage / today
  return (
    asRecord(root.data) ??
    asRecord(root.usage) ??
    asRecord(root.today) ??
    asRecord(root.daily_usage) ??
    root
  )
}

export async function fetchTikHubDailyUsage(options: TikHubClientOptions): Promise<{
  todayRequests?: number
  todayCostUsd?: number
  raw: unknown
}> {
  const payload = await requestJson(options, '/api/v1/tikhub/user/get_user_daily_usage', {})
  const data = payload.data ?? payload
  const record = unwrapDailyUsagePayload(data)

  return {
    todayRequests: pickOptionalNumber(record, [
      'requests',
      'request_count',
      'total_requests',
      'request',
      'count',
      'calls',
      'api_calls',
      'success_count',
    ]),
    todayCostUsd: pickOptionalNumber(record, [
      'cost',
      'spend',
      'amount',
      'total_cost',
      'cost_usd',
      'usd',
    ]),
    raw: data,
  }
}

export async function extractSecUserId(
  options: TikHubClientOptions,
  profileUrl: string,
): Promise<string> {
  const payload = await requestJson(options, '/api/v1/douyin/web/get_sec_user_id', {
    query: { url: profileUrl },
  })
  if (typeof payload.data === 'string' && payload.data.trim()) return payload.data.trim()
  const record = asRecord(payload.data)
  const sec =
    asString(record?.sec_user_id) ??
    asString(record?.sec_uid) ??
    asString(record?.data)
  if (!sec) throw new Error('未能从链接提取 sec_user_id，请确认是抖音主页或分享链接')
  return sec
}

export async function fetchUserProfileBySecUserId(
  options: TikHubClientOptions,
  secUserId: string,
  sourceInput: string,
): Promise<{ preview: DouyinAccountPreview; raw: unknown }> {
  const payload = await requestJson(options, '/api/v1/douyin/web/handler_user_profile', {
    query: { sec_user_id: secUserId },
  })
  return {
    preview: parseDouyinUserProfile(payload.data, sourceInput),
    raw: payload.data,
  }
}

export async function fetchUserProfileByUniqueId(
  options: TikHubClientOptions,
  uniqueId: string,
  sourceInput: string,
): Promise<{ preview: DouyinAccountPreview; raw: unknown }> {
  const payload = await requestJson(options, '/api/v1/douyin/web/handler_user_profile_v2', {
    query: { unique_id: uniqueId },
  })
  return {
    preview: parseDouyinUserProfile(payload.data, sourceInput),
    raw: payload.data,
  }
}

export async function fetchUserPostVideos(
  options: TikHubClientOptions,
  secUserId: string,
  maxCursor = '0',
  count = 12,
): Promise<DouyinVideoPage> {
  const payload = await requestJson(options, '/api/v1/douyin/web/fetch_user_post_videos', {
    query: {
      sec_user_id: secUserId,
      max_cursor: maxCursor,
      count,
      filter_type: '0',
    },
  })
  return parseDouyinVideoPage(payload.data)
}

export interface DouyinSearchVideoItem extends DouyinVideoItem {
  authorNickname: string
  authorUniqueId: string | null
  authorSecUid: string | null
  authorAvatarUrl: string | null
  authorFollowerCount: number
  authorAwemeCount: number
  authorSignature: string | null
  shareUrl: string | null
}

export interface DouyinSearchUserItem {
  nickname: string
  uniqueId: string | null
  secUid: string | null
  avatarUrl: string | null
  signature: string | null
  followerCount: number
  awemeCount: number
  profileUrl: string
}

export interface DouyinCommentItem {
  cid: string | null
  author: string
  avatarUrl: string | null
  content: string
  diggCount: number
  replyCount: number
  replies: DouyinCommentItem[]
}

function parseSearchVideoItem(raw: unknown): DouyinSearchVideoItem | null {
  const wrapper = asRecord(raw) ?? {}
  const data = asRecord(wrapper.data) ?? wrapper
  const aweme =
    asRecord(data.aweme_info) ??
    asRecord(wrapper.aweme_info) ??
    (asNumber(wrapper.type ?? data.type) === 1 ? data : null)
  if (!aweme) return null

  const base = parseVideoItem(aweme)
  if (!base) return null

  const author = asRecord(aweme.author) ?? {}
  const nickname =
    asString(author.nickname) ?? asString(author.nick_name) ?? '未知作者'
  const uniqueId =
    asString(author.unique_id) ?? asString(author.short_id) ?? asString(author.uid)
  const secUid = asString(author.sec_uid) ?? asString(author.sec_user_id)

  return {
    ...base,
    authorNickname: nickname,
    authorUniqueId: uniqueId,
    authorSecUid: secUid,
    authorAvatarUrl: pickAvatar(author),
    authorFollowerCount: asNumber(
      author.follower_count ?? author.mplatform_followers_count ?? author.fans_count,
    ),
    authorAwemeCount: asNumber(author.aweme_count ?? author.video_count),
    authorSignature: asString(author.signature) ?? asString(author.desc),
    shareUrl:
      asString(aweme.share_url) ??
      (base.awemeId ? `https://www.douyin.com/video/${base.awemeId}` : null),
  }
}

export function parseDouyinSearchVideos(data: unknown): DouyinSearchVideoItem[] {
  const root = asRecord(data) ?? {}
  const list =
    (Array.isArray(root.business_data) && root.business_data) ||
    (Array.isArray(root.aweme_list) && root.aweme_list) ||
    (Array.isArray(root.data) && root.data) ||
    []

  return list
    .map((entry) => parseSearchVideoItem(entry))
    .filter((entry): entry is DouyinSearchVideoItem => Boolean(entry))
}

/** 按 aweme_id 拉取单条视频（含封面与可播直链） */
export async function fetchOneVideo(
  options: TikHubClientOptions,
  awemeId: string,
): Promise<DouyinVideoItem | null> {
  const payload = await requestJson(options, '/api/v1/douyin/app/v3/fetch_one_video', {
    query: { aweme_id: awemeId },
  })
  const root = asRecord(payload.data) ?? {}
  const aweme =
    asRecord(root.aweme_detail) ??
    asRecord(root.aweme) ??
    (asString(root.aweme_id) ? root : null)
  if (!aweme) return null
  return parseVideoItem(aweme)
}

function pickSearchPageMeta(data: unknown): {
  cursor: number | string
  searchId: string
  backtrace: string
  hasMore: boolean
} {
  const root = asRecord(data) ?? {}
  const nested = asRecord(root.data) ?? {}
  const cursorRaw = root.cursor ?? root.max_cursor ?? nested.cursor ?? nested.max_cursor ?? 0
  const hasMoreRaw = root.has_more ?? root.hasMore ?? nested.has_more ?? nested.hasMore
  return {
    cursor:
      typeof cursorRaw === 'number' || typeof cursorRaw === 'string' ? cursorRaw : String(cursorRaw),
    searchId: asString(root.search_id) ?? asString(nested.search_id) ?? '',
    backtrace: asString(root.backtrace) ?? asString(nested.backtrace) ?? '',
    hasMore:
      hasMoreRaw === true ||
      hasMoreRaw === 1 ||
      hasMoreRaw === '1' ||
      String(hasMoreRaw).toLowerCase() === 'true',
  }
}

export async function fetchVideoSearch(
  options: TikHubClientOptions,
  keyword: string,
  opts?: { sortType?: '0' | '1' | '2'; publishTime?: string; pages?: number },
): Promise<DouyinSearchVideoItem[]> {
  const pages = Math.max(1, Math.min(opts?.pages ?? 1, 10))
  const collected: DouyinSearchVideoItem[] = []
  const seen = new Set<string>()
  let cursor: number | string = 0
  let searchId = ''
  let backtrace = ''

  for (let page = 0; page < pages; page += 1) {
    const payload = await requestJson(options, '/api/v1/douyin/search/fetch_video_search_v2', {
      method: 'POST',
      body: {
        keyword,
        cursor,
        sort_type: opts?.sortType ?? '1',
        publish_time: opts?.publishTime ?? '0',
        filter_duration: '0',
        content_type: '1',
        search_id: searchId,
        backtrace,
      },
    })
    const beforeCount = collected.length
    const batch = parseDouyinSearchVideos(payload.data)
    for (const item of batch) {
      const key = item.awemeId || `${item.authorNickname}-${item.description.slice(0, 24)}`
      if (!key || seen.has(key)) continue
      seen.add(key)
      collected.push(item)
    }

    const meta = pickSearchPageMeta(payload.data)
    if (meta.searchId) searchId = meta.searchId
    if (meta.backtrace) backtrace = meta.backtrace

    const gained = collected.length - beforeCount
    // 本页无新增，或明确没有更多，则停
    if (!batch.length || gained === 0) break
    if (!meta.hasMore && page > 0) break

    const next = meta.cursor
    if (next === cursor && page > 0) break
    cursor = next
  }

  return collected
}

function parseSearchUserItem(raw: unknown): DouyinSearchUserItem | null {
  const wrapper = asRecord(raw) ?? {}
  const user =
    asRecord(wrapper.user_info) ??
    asRecord(asRecord(wrapper.user)?.user_info) ??
    asRecord(wrapper.user) ??
    wrapper
  const nickname = asString(user.nickname) ?? asString(user.nick_name)
  if (!nickname) return null
  const secUid = asString(user.sec_uid) ?? asString(user.sec_user_id)
  const uniqueId =
    asString(user.unique_id) ?? asString(user.short_id) ?? asString(user.uid)
  return {
    nickname,
    uniqueId,
    secUid,
    avatarUrl: pickAvatar(user),
    signature: asString(user.signature),
    followerCount: asNumber(
      user.follower_count ?? user.mplatform_followers_count ?? user.fans_count,
    ),
    awemeCount: asNumber(user.aweme_count ?? user.video_count),
    profileUrl: secUid
      ? `https://www.douyin.com/user/${secUid}`
      : `https://www.douyin.com/search/${encodeURIComponent(uniqueId || nickname)}`,
  }
}

export function parseDouyinSearchUsers(data: unknown): DouyinSearchUserItem[] {
  const root = asRecord(data) ?? {}
  const list =
    (Array.isArray(root.user_list) && root.user_list) ||
    (Array.isArray(root.business_data) && root.business_data) ||
    (Array.isArray(root.user_list_v2) && root.user_list_v2) ||
    (Array.isArray(root.data) && root.data) ||
    []
  return list
    .map((entry) => parseSearchUserItem(entry))
    .filter((entry): entry is DouyinSearchUserItem => Boolean(entry))
}

export async function fetchUserSearch(
  options: TikHubClientOptions,
  keyword: string,
): Promise<DouyinSearchUserItem[]> {
  const payload = await requestJson(options, '/api/v1/douyin/search/fetch_user_search_v2', {
    method: 'POST',
    body: {
      keyword,
      cursor: 0,
      search_id: '',
    },
  })
  return parseDouyinSearchUsers(payload.data)
}

function parseCommentItem(raw: unknown, depth = 0): DouyinCommentItem | null {
  const item = asRecord(raw)
  if (!item) return null
  const user = asRecord(item.user) ?? asRecord(item.user_info) ?? {}
  const content =
    asString(item.text) ?? asString(item.content) ?? asString(item.comment_text) ?? ''
  if (!content) return null
  const replyRaw =
    (Array.isArray(item.reply_comment) && item.reply_comment) ||
    (Array.isArray(item.reply_list) && item.reply_list) ||
    (Array.isArray(item.replies) && item.replies) ||
    []
  const replies =
    depth >= 6
      ? []
      : replyRaw
          .map((entry) => parseCommentItem(entry, depth + 1))
          .filter((entry): entry is DouyinCommentItem => Boolean(entry))
  const replyCount = asNumber(
    item.reply_comment_total ?? item.reply_count ?? item.reply_comment_count ?? replies.length,
  )
  return {
    cid: asString(item.cid) ?? asString(item.comment_id),
    author: asString(user.nickname) ?? asString(user.nick_name) ?? '用户',
    avatarUrl: pickAvatar(user),
    content,
    diggCount: asNumber(item.digg_count ?? item.like_count),
    replyCount: Math.max(replyCount, replies.length),
    replies,
  }
}

export function parseDouyinComments(data: unknown): DouyinCommentItem[] {
  const root = asRecord(data) ?? {}
  const list =
    (Array.isArray(root.comments) && root.comments) ||
    (Array.isArray(root.comment_list) && root.comment_list) ||
    (Array.isArray(root.list) && root.list) ||
    []
  return list
    .map((entry) => parseCommentItem(entry))
    .filter((entry): entry is DouyinCommentItem => Boolean(entry))
}

export async function fetchVideoComments(
  options: TikHubClientOptions,
  awemeId: string,
  count = 20,
): Promise<DouyinCommentItem[]> {
  const payload = await requestJson(options, '/api/v1/douyin/web/fetch_video_comments', {
    query: {
      aweme_id: awemeId,
      cursor: 0,
      count: Math.min(count, 30),
    },
  })
  return parseDouyinComments(payload.data)
}
