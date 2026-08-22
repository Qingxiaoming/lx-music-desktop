import { useRouter } from '@common/utils/vueRouter'
import musicSdk from '@renderer/utils/musicSdk'
import { openUrl, clipboardWriteText, trashItem } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { addListMusics, removeListMusics, updateListMusicsPosition } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'
import { formatMusicName, toOldMusicInfo } from '@renderer/utils/index'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
import { playNext, playListById } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { getDownloadedFilePath, refreshDownloadedFiles } from '@renderer/store/download/useDownloadedMap'
import { removeDownloadTasks } from '@renderer/store/download/action'
import { downloadTasksGet } from '@renderer/utils/ipc'
import { checkPath } from '@common/utils/nodejs'


export default ({ props, list, selectedList, removeAllSelect }) => {
  const router = useRouter()
  const t = useI18n()

  const handleSearch = index => {
    const info = list.value[index]
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  const handleOpenMusicDetail = index => {
    const minfo = list.value[index]
    const url = musicSdk[minfo.source]?.getMusicDetailPageUrl(toOldMusicInfo(minfo))
    if (!url) return
    openUrl(url)
  }

  const handleCopyName = index => {
    const minfo = list.value[index]
    clipboardWriteText(formatMusicName(appSetting['download.fileName'], minfo.name, minfo.singer))
  }

  const handleDislikeMusic = async(index) => {
    const minfo = list.value[index]
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
    if (hasDislike(playMusicInfo.musicInfo)) {
      playNext(true)
    }
  }

  const handleRemoveMusic = async(index, single) => {
    if (selectedList.value.length && !single) {
      const confirm = await (selectedList.value.length > 1
        ? dialog.confirm({
          message: t('lists__remove_music_tip', { len: selectedList.value.length }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        : Promise.resolve(true)
      )
      if (!confirm) return
      removeListMusics({ listId: props.listId, ids: selectedList.value.map(m => m.id) })
      removeAllSelect()
    } else {
      removeListMusics({ listId: props.listId, ids: [list.value[index].id] })
    }
  }

  const handleDeleteLocalFile = async(index) => {
    const minfo = list.value[index]
    if (!minfo) return
    const filePath = getDownloadedFilePath(minfo)
    if (!filePath) return
    try {
      await trashItem(filePath)
    } catch (err) {
      console.log(err)
      dialog({ message: t('list__delete_local_file_failed') })
      return
    }
    try {
      const fileName = filePath.split(/[/\\]/).pop()
      const tasks = await downloadTasksGet()
      const ids = tasks.filter(task => task.metadata.fileName === fileName).map(task => task.id)
      if (ids.length) await removeDownloadTasks(ids)
    } catch (err) {
      console.log(err)
    }
    refreshDownloadedFiles()
  }

  const handleReplaceWithLocalFile = async(index) => {
    const musicInfo = list.value[index]
    if (!musicInfo || musicInfo.source == 'local') return
    const filePath = getDownloadedFilePath(musicInfo)
    if (!filePath) return
    if (!await checkPath(filePath)) {
      refreshDownloadedFiles()
      dialog({ message: t('list__play_downloaded_file_missing') })
      return
    }

    const oldId = musicInfo.id
    const oldIdx = list.value.findIndex(m => m.id == oldId)
    const [localMusicInfo] = await window.lx.worker.main.createLocalMusicInfos([filePath])
    if (!localMusicInfo) {
      dialog({ message: t('list__replace_with_local_file_failed') })
      return
    }

    await removeListMusics({ listId: props.listId, ids: [oldId] })
    await addListMusics(props.listId, [localMusicInfo])
    if (oldIdx > -1) {
      await updateListMusicsPosition({ listId: props.listId, ids: [localMusicInfo.id], position: oldIdx })
    }
    if (playMusicInfo.listId == props.listId && playMusicInfo.musicInfo?.id == oldId) {
      playListById(props.listId, localMusicInfo.id)
    }
  }

  return {
    handleSearch,
    handleOpenMusicDetail,
    handleCopyName,
    handleDislikeMusic,
    handleRemoveMusic,
    handleDeleteLocalFile,
    handleReplaceWithLocalFile,
  }
}
