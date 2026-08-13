import { addTempPlayList } from '@renderer/store/player/action'
import { playList, playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { LIST_IDS } from '@common/constants'
import { getDownloadedFilePath, refreshDownloadedFiles } from '@renderer/store/download/useDownloadedMap'
import { checkPath } from '@common/utils/nodejs'
import { dialog } from '@renderer/plugins/Dialog'

export default ({ props, selectedList, list, removeAllSelect }) => {
  let clickTime = 0
  let clickIndex = -1

  const handlePlayMusic = (index) => {
    playList(props.listId, index)
  }

  const handlePlayMusicLater = (index, single) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(selectedList.value.map(s => ({ listId: props.listId, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ listId: props.listId, musicInfo: list.value[index] }])
    }
  }

  const doubleClickPlay = index => {
    if (
      window.performance.now() - clickTime > 400 ||
      clickIndex !== index
    ) {
      clickTime = window.performance.now()
      clickIndex = index
      return
    }
    handlePlayMusic(index, true)
    clickTime = 0
    clickIndex = -1
  }

  const handlePlayDownloadedFile = async(index) => {
    const musicInfo = list.value[index]
    if (!musicInfo) return
    const filePath = getDownloadedFilePath(musicInfo)
    if (!filePath) return
    if (!await checkPath(filePath)) {
      refreshDownloadedFiles()
      dialog({ message: window.i18n.t('list__play_downloaded_file_missing') })
      return
    }
    const localMusicInfo = {
      id: filePath,
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: 'local',
      interval: musicInfo.interval ?? '',
      meta: {
        albumName: musicInfo.meta?.albumName ?? '',
        filePath,
        songId: filePath,
        picUrl: '',
        ext: filePath.includes('.') ? filePath.split('.').pop() : '',
      },
    }
    const isPlaying = !!playMusicInfo.musicInfo
    addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo: localMusicInfo, isTop: true }])
    if (isPlaying) playNext()
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
    doubleClickPlay,
    handlePlayDownloadedFile,
  }
}
