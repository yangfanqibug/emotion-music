/**
 * 数据接口统一出口
 * ------------------------------------------------------------------
 * UI 层只需 `import { searchOnline, loadLocalCatalog } from '../api/index.js'`
 * 其它模块也可以直接从 './music.js' 精确引入。
 */
export {
  // 在线（iTunes Search API）
  searchItunes,
  searchOnline,
  buildQueryForEmotion,
  getOnlineStatus,
  // 本地曲库
  loadLocalCatalog,
  // 辅助
  clearMusicCache,
  formatDuration,
  // 常量
  ITUNES_ENDPOINT,
  LOCAL_CATALOG_URL,
  REQUEST_TIMEOUT_MS,
  CACHE_TTL_MS,
  ONLINE_PROVIDER,
} from './music.js'
