import { reactive } from '@common/utils/vueTools'
import { downloadTasksGet } from '@renderer/utils/ipc'
import { getDownloadFilePath } from '@renderer/utils/music'
import { buildSavePath } from '@renderer/store/download/utils'
import { appSetting } from '@renderer/store/setting'
import { joinPath, getFileStats, readDir } from '@common/utils/nodejs'

interface SoftMatchEntry {
  name: string
  singer: string
  interval: string
  normName: string
  normSinger: string
  path: string
}

/**
 * 下载目录中文件真实存在的歌曲文件路径映射
 * key: 歌曲 id（音源 + 歌曲 ID），精确匹配（绿底）
 */
export const downloadedFilePathMap = reactive(new Map<string, string>())

/**
 * 下载目录中文件真实存在的歌曲（按时长索引），用于黄底（时长一致 + 歌名/歌手模糊）
 */
export const downloadedSoftMatchMap = reactive(new Map<string, SoftMatchEntry[]>())

/**
 * 全部软匹配条目，用于红底（歌名/歌手模糊但时长不一致）
 */
export const downloadedSoftMatchList = reactive<SoftMatchEntry[]>([])

const normalizeText = (str: string) => str.trim().toLowerCase().replace(/[\s·、&，,／/\\|（）()\-_]/g, '')
const normalizeSinger = (str: string) => str.split(/[、,&，/\\·]/).map(s => normalizeText(s)).filter(Boolean).sort().join('&')

const createSoftMatchEntry = (musicInfo: { name: string, singer: string, interval?: string | null }, path: string): SoftMatchEntry => ({
  name: musicInfo.name,
  singer: musicInfo.singer,
  interval: musicInfo.interval ?? '',
  normName: normalizeText(musicInfo.name),
  normSinger: normalizeSinger(musicInfo.singer),
  path,
})

const matchEntry = (entry: SoftMatchEntry, normName: string, normSinger: string) => {
  if (!normName || !normSinger) return false
  if (!(entry.normName.includes(normName) || normName.includes(entry.normName))) return false
  const entrySingers = entry.normSinger.split('&')
  const singers = normSinger.split('&')
  return entrySingers.every(singer => singers.includes(singer)) || singers.every(singer => entrySingers.includes(singer))
}

/**
 * 黄底：id 未精确匹配，但存在时长完全相同、且歌名/歌手模糊匹配的已完成下载
 */
export const isDownloadedSoftMatch = (musicInfo: { id: string, name: string, singer: string, interval?: string | null }) => {
  if (downloadedFilePathMap.has(musicInfo.id)) return false
  const list = downloadedSoftMatchMap.get(musicInfo.interval ?? '')
  if (!list?.length) return false
  const normName = normalizeText(musicInfo.name)
  const normSinger = normalizeSinger(musicInfo.singer)
  return list.some(entry => matchEntry(entry, normName, normSinger))
}

/**
 * 红底：id 未精确匹配、黄底不成立，但存在歌名/歌手模糊匹配且时长不一致的已完成下载
 */
export const isDownloadedDurationMismatch = (musicInfo: { id: string, name: string, singer: string, interval?: string | null }) => {
  if (downloadedFilePathMap.has(musicInfo.id)) return false
  if (isDownloadedSoftMatch(musicInfo)) return false
  const normName = normalizeText(musicInfo.name)
  const normSinger = normalizeSinger(musicInfo.singer)
  const interval = musicInfo.interval ?? ''
  return downloadedSoftMatchList.some(entry =>
    entry.interval !== interval &&
    matchEntry(entry, normName, normSinger),
  )
}

/**
 * 获取该歌单条目对应的已下载文件路径：
 * 1. id 精确匹配（绿底）
 * 2. 时长一致且歌名/歌手模糊匹配（黄底）
 * 3. 歌名/歌手模糊匹配但时长不一致（红底）
 */
export const getDownloadedFilePath = (musicInfo: { id: string, name: string, singer: string, interval?: string | null }): string => {
  const exact = downloadedFilePathMap.get(musicInfo.id)
  if (exact) return exact
  const normName = normalizeText(musicInfo.name)
  const normSinger = normalizeSinger(musicInfo.singer)
  const interval = musicInfo.interval ?? ''
  const sameIntervalList = downloadedSoftMatchMap.get(interval)
  const sameIntervalHit = sameIntervalList?.find(entry => matchEntry(entry, normName, normSinger))
  if (sameIntervalHit) return sameIntervalHit.path
  return downloadedSoftMatchList.find(entry => entry.interval !== interval && matchEntry(entry, normName, normSinger))?.path ?? ''
}

/**
 * 解析下载文件真实路径：
 * 1. 原记录路径 / 按当前设置拼接的路径
 * 2. 在下载目录及其一级子目录中按文件名兜底查找（应对目录被改名、移动等历史数据）
 */
const resolveDownloadedFilePath = async(item: LX.Download.ListItem, fileMap: Map<string, string>): Promise<string> => {
  const path = await getDownloadFilePath(item, buildSavePath(item)).catch(() => '')
  if (path) return path
  return fileMap.get(item.metadata.fileName) ?? ''
}

/**
 * 扫描下载目录（含一级子目录），建立 文件名 -> 路径 映射
 */
const buildDownloadedFileMap = async(): Promise<Map<string, string>> => {
  const fileMap = new Map<string, string>()
  const savePath = appSetting['download.savePath']
  const dirs = [savePath]
  try {
    for (const name of await readDir(savePath)) {
      const dir = joinPath(savePath, name)
      const stat = await getFileStats(dir)
      if (stat?.isDirectory()) dirs.push(dir)
    }
  } catch (err) {
    console.log(err)
  }
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = await readDir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!fileMap.has(name)) fileMap.set(name, joinPath(dir, name))
    }
  }
  return fileMap
}

/**
 * 下载任务完成时立即将文件加入映射（不依赖数据库落盘，避免竞态）
 */
export const addDownloadedFile = async(downloadInfo: LX.Download.ListItem) => {
  if (!downloadInfo.isComplate) return
  const path = await getDownloadFilePath(downloadInfo, buildSavePath(downloadInfo)).catch(() => '')
  if (!path) return
  const musicInfo = downloadInfo.metadata.musicInfo
  downloadedFilePathMap.set(musicInfo.id, path)
  const entry = createSoftMatchEntry(musicInfo, path)
  downloadedSoftMatchList.push(entry)
  const key = entry.interval
  const list = downloadedSoftMatchMap.get(key)
  downloadedSoftMatchMap.set(key, list ? [...list, entry] : [entry])
}

/**
 * 刷新已下载文件映射（从下载列表重建）
 */
export const refreshDownloadedFiles = async() => {
  let list: LX.Download.ListItem[] = []
  try {
    list = await downloadTasksGet()
  } catch (err) {
    console.log(err)
    return
  }

  const newMap = new Map<string, string>()
  const newSoftMatchMap = new Map<string, SoftMatchEntry[]>()
  const newSoftMatchList: SoftMatchEntry[] = []
  const fileMap = await buildDownloadedFileMap()
  const tasks: Array<Promise<void>> = []
  for (const item of list) {
    tasks.push(resolveDownloadedFilePath(item, fileMap).then(path => {
      if (!path) return
      const musicInfo = item.metadata.musicInfo
      newMap.set(musicInfo.id, path)
      const entry = createSoftMatchEntry(musicInfo, path)
      newSoftMatchList.push(entry)
      const key = entry.interval
      const softList = newSoftMatchMap.get(key)
      if (softList) softList.push(entry)
      else newSoftMatchMap.set(key, [entry])
    }).catch(() => {}))
  }
  await Promise.all(tasks)

  downloadedFilePathMap.clear()
  for (const [id, path] of newMap) downloadedFilePathMap.set(id, path)
  downloadedSoftMatchMap.clear()
  for (const [key, softList] of newSoftMatchMap) downloadedSoftMatchMap.set(key, softList)
  downloadedSoftMatchList.splice(0, downloadedSoftMatchList.length, ...newSoftMatchList)
}

/**
 * 初始化监听：应用启动时刷新一次，下载列表变化时自动刷新
 */
export const initDownloadedMapListener = () => {
  const handleRefresh = () => {
    void refreshDownloadedFiles()
  }
  window.app_event.on('downloadListUpdate', handleRefresh)
  void refreshDownloadedFiles()
}
