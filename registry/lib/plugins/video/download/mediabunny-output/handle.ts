import { getComponentSettings } from '@/core/settings'
import { Toast } from '@/core/toast'
import { formatPercent } from '@/core/utils/formatters'
import { title as pluginTitle } from '.'
import type { Options } from './types'
import { DownloadVideoAction } from '../../../../components/video/download/types'
import { MediaBunnyLibrary, StreamSaverLibrary } from '@/core/runtime-library'
import { downloadToOPFS, formatProgress, getStreamWithProgress } from './util'

const defaultOptions: Options = {
  mediabunnyFormat: 'mp4',
  mediabunnyFastStart: 'reserve',
  mediabunnyOutputMethod: 'file-system-access',
  mediabunnyInputMethod: 'stream',
}

const pendingCleanupFiles = new Set<string>()

const cleanup = async (filenames?: string | string[]) => {
  // eslint-disable-next-line no-nested-ternary
  const targets = filenames
    ? Array.isArray(filenames)
      ? filenames
      : [filenames]
    : [...pendingCleanupFiles]
  if (targets.length === 0) {
    return
  }
  try {
    const root = await navigator.storage.getDirectory()
    for (const name of targets) {
      await root
        .removeEntry(name)
        .catch(error => console.error(`${pluginTitle} - 清理失败:`, error))
      pendingCleanupFiles.delete(name)
    }
  } catch (error) {
    console.error(`${pluginTitle} - 清理失败:`, error)
  }
}

const showCleanupToast = async (filename: string) => {
  const message = `下载已完成, 输出文件已暂存. <a class="link" data-filename="${filename}">清除缓存</a>`
  const toast = Toast.info(message, pluginTitle, undefined)
  const element = await toast.element
  dqa(element, 'a[data-filename]').forEach(span => {
    span.addEventListener(
      'click',
      () => {
        cleanup(filename)
        toast.close()
      },
      { once: true },
    )
  })
}

window.addEventListener('beforeunload', () => {
  cleanup()
})

async function single(
  name: string,
  videoUrl: string,
  audioUrl: string,
  writableStream: WritableStream,
  isAppendOnly: boolean,
  options: Options,
  pageIndex = 1,
  totalPages = 1,
  duration = 0,
) {
  const toast = Toast.info('', `${pluginTitle} - ${pageIndex} / ${totalPages}`)
  const lines: string[] = []
  const updateToast = () => {
    toast.message = lines.filter(Boolean).join('\n')
  }
  const downloadProgress =
    (line: number, message: string) => (received: number, total: number, speed: number) => {
      lines[line] = `${message}: ${formatProgress(received, total, speed)}`
      updateToast()
    }

  const vFileName = `temp_video_${pageIndex}.m4s`
  const aFileName = `temp_audio_${pageIndex}.m4s`

  const {
    mediabunnyFormat: selectedFormat,
    mediabunnyFastStart: selectedFastStart,
    mediabunnyInputMethod: selectedInputMethod,
  } = options

  try {
    lines[0] = '正在加载混流引擎...'
    updateToast()
    const MediaBunny = await MediaBunnyLibrary
    const {
      ALL_FORMATS,
      BlobSource,
      EncodedAudioPacketSource,
      EncodedPacketSink,
      EncodedVideoPacketSource,
      Input,
      Mp4OutputFormat,
      MkvOutputFormat,
      Output,
      StreamTarget,
      ReadableStreamSource,
    } = MediaBunny

    let vSource: any
    let aSource: any

    if (selectedInputMethod === 'buffer') {
      pendingCleanupFiles.add(vFileName)
      pendingCleanupFiles.add(aFileName)

      const [vHandle, aHandle] = await Promise.all([
        downloadToOPFS(videoUrl, vFileName, downloadProgress(0, '下载视频流')),
        downloadToOPFS(audioUrl, aFileName, downloadProgress(1, '下载音频流')),
      ])

      const [vBlob, aBlob] = await Promise.all([vHandle.getFile(), aHandle.getFile()])
      vSource = new BlobSource(vBlob)
      aSource = new BlobSource(aBlob)

      lines[0] = '下载视频流: 完成'
      lines[1] = '下载音频流: 完成'
    } else {
      lines[0] = '下载视频流: 启动中...'
      lines[1] = '下载音频流: 启动中...'
      updateToast()

      const [vResult, aResult] = await Promise.all([
        getStreamWithProgress(videoUrl, downloadProgress(0, '下载视频流')),
        getStreamWithProgress(audioUrl, downloadProgress(1, '下载音频流')),
      ])
      vSource = new ReadableStreamSource(vResult.stream)
      aSource = new ReadableStreamSource(aResult.stream)
    }

    lines[2] = '初始化混流引擎...'
    updateToast()

    const videoInput = new Input({
      source: vSource,
      formats: ALL_FORMATS,
    })
    const audioInput = new Input({
      source: aSource,
      formats: ALL_FORMATS,
    })

    lines[2] = '正在分析媒体轨道...'
    updateToast()

    const [videoTrack, audioTrack] = await Promise.all([
      videoInput.getPrimaryVideoTrack(),
      audioInput.getPrimaryAudioTrack(),
    ])

    if (!videoTrack) {
      throw new Error('视频文件中找不到视频轨道')
    }
    if (!audioTrack) {
      throw new Error('音频文件中找不到音频轨道')
    }

    const videoDecoderConfig = await videoTrack.getDecoderConfig()
    const audioDecoderConfig = await audioTrack.getDecoderConfig()

    let videoStats: any = null
    let audioStats: any = null

    if (selectedInputMethod === 'buffer') {
      const [vStats, aStats] = await Promise.all([
        videoTrack.computePacketStats(),
        audioTrack.computePacketStats(),
      ])
      videoStats = vStats
      audioStats = aStats
    }

    let target: any
    let mbReadableStream: ReadableStream | null = null

    if (isAppendOnly) {
      const { writable: mbWritable, readable: mbReadable } = new TransformStream({
        transform(chunk: { data: Uint8Array; position: number }, controller) {
          controller.enqueue(chunk.data)
        },
      })
      mbReadableStream = mbReadable
      target = new StreamTarget(mbWritable, { chunked: true, chunkSize: 1024 * 1024 })
    } else {
      target = new StreamTarget(writableStream, { chunked: true, chunkSize: 1024 * 1024 })
    }

    let outputFormat: any
    if (selectedFormat === 'mp4') {
      const fastStart = isAppendOnly ? false : selectedFastStart
      outputFormat = new Mp4OutputFormat({ fastStart })
    } else if (selectedFormat === 'fragmented-mp4') {
      outputFormat = new Mp4OutputFormat({ fastStart: 'fragmented' })
    } else if (selectedFormat === 'mkv') {
      outputFormat = new MkvOutputFormat({ appendOnly: isAppendOnly })
    }

    const output = new Output({
      format: outputFormat,
      target,
    })

    const videoSource = new EncodedVideoPacketSource(videoTrack.codec)
    const audioSource = new EncodedAudioPacketSource(audioTrack.codec)

    output.addVideoTrack(videoSource, {
      rotation: videoTrack.rotation,
      frameRate: videoStats?.averagePacketRate,
      maximumPacketCount: videoStats?.packetCount,
    })
    output.addAudioTrack(audioSource, {
      maximumPacketCount: audioStats?.packetCount,
    })

    const pipePromise = mbReadableStream?.pipeTo(writableStream)

    await output.start()

    let videoProgress = 0
    let audioProgress = 0
    const state = {
      videoFinished: false,
      audioFinished: false,
      videoLastTimestamp: 0,
      audioLastTimestamp: 0,
    }

    const updateMuxProgress = () => {
      const totalProgress = (videoProgress + audioProgress) / 2
      lines[2] = `正在混流: ${formatPercent(totalProgress)}`
      updateToast()
    }

    const videoProcess = async () => {
      const sink = new EncodedPacketSink(videoTrack)
      const meta = { decoderConfig: videoDecoderConfig ?? undefined }
      let count = 0
      for await (const packet of sink.packets()) {
        await videoSource.add(packet, meta)
        state.videoLastTimestamp = packet.timestamp
        count++
        videoProgress = videoStats ? count / videoStats.packetCount : packet.timestamp / duration
        updateMuxProgress()
      }
      state.videoFinished = true
      videoSource.close()
    }

    const audioProcess = async () => {
      const sink = new EncodedPacketSink(audioTrack)
      const meta = { decoderConfig: audioDecoderConfig ?? undefined }
      let count = 0
      for await (const packet of sink.packets()) {
        await audioSource.add(packet, meta)
        state.audioLastTimestamp = packet.timestamp
        count++
        audioProgress = audioStats ? count / audioStats.packetCount : packet.timestamp / duration
        updateMuxProgress()
      }
      state.audioFinished = true
      audioSource.close()
    }

    await Promise.all([videoProcess(), audioProcess()])
    await output.finalize()

    if (pipePromise) {
      await pipePromise
    }

    lines[2] = '混流完成！'
    updateToast()
    toast.duration = 3000

    if (selectedInputMethod === 'buffer') {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(vFileName)
      await root.removeEntry(aFileName)
      pendingCleanupFiles.delete(vFileName)
      pendingCleanupFiles.delete(aFileName)
    }

    videoInput.dispose()
    audioInput.dispose()
  } catch (error) {
    if (selectedInputMethod === 'buffer') {
      try {
        const root = await navigator.storage.getDirectory()
        await root.removeEntry(vFileName)
        await root.removeEntry(aFileName)
        pendingCleanupFiles.delete(vFileName)
        pendingCleanupFiles.delete(aFileName)
      } catch {
        /* ignore */
      }
    }
    throw error
  } finally {
    setTimeout(() => toast.close(), 10000)
  }
}

export async function run(action: DownloadVideoAction) {
  const { infos: pages } = action
  const { options: storedOptions } = getComponentSettings('downloadVideo')
  const options: Options = { ...defaultOptions, ...storedOptions }
  const {
    dashAudioExtension,
    dashFlacAudioExtension,
    dashVideoExtension,
    mediabunnyFormat: selectedFormat,
    mediabunnyOutputMethod: selectedMethod,
  } = options as any

  let directoryHandle: any
  if (
    pages.length > 1 &&
    selectedMethod === 'file-system-access' &&
    'showDirectoryPicker' in unsafeWindow
  ) {
    try {
      directoryHandle = await unsafeWindow.showDirectoryPicker()
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('用户取消了选择文件夹')
      }
      console.error(e)
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const [video, audio] = page.titledFragments

    if (
      !(
        page.fragments.length === 2 &&
        video.extension === dashVideoExtension &&
        (audio.extension === dashAudioExtension || audio.extension === dashFlacAudioExtension)
      )
    ) {
      throw new Error('仅支持 DASH 格式视频和音频')
    }

    const formatExtensions = {
      mp4: '.mp4',
      'fragmented-mp4': '.mp4',
      mkv: '.mkv',
    }
    const extension = formatExtensions[selectedFormat] || '.mp4'
    const filename = video.title.replace(/\.[^/.]+$/, '') + extension
    let writableStream: WritableStream
    let isAppendOnly = false
    let opfsFileHandle: FileSystemFileHandle | null = null

    if (directoryHandle) {
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true })
      writableStream = await fileHandle.createWritable()
    } else if (selectedMethod === 'file-system-access' && 'showSaveFilePicker' in unsafeWindow) {
      try {
        const typeConfigs = {
          mp4: { description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } },
          'fragmented-mp4': {
            description: 'Fragmented MP4 Video',
            accept: { 'video/mp4': ['.mp4'] },
          },
          mkv: { description: 'Matroska Video', accept: { 'video/x-matroska': ['.mkv'] } },
        }
        const saveHandle = await unsafeWindow.showSaveFilePicker({
          suggestedName: filename,
          types: [typeConfigs[selectedFormat] || typeConfigs.mp4],
        })
        writableStream = await saveHandle.createWritable()
      } catch (e) {
        if (e.name === 'AbortError') {
          throw new Error('用户取消了保存')
        }
        throw e
      }
    } else if (selectedMethod === 'opfs') {
      const root = await navigator.storage.getDirectory()
      const tempName = `mux_temp_${Date.now()}${extension}`
      opfsFileHandle = await root.getFileHandle(tempName, { create: true })
      writableStream = await opfsFileHandle.createWritable()
      pendingCleanupFiles.add(tempName)
    } else if (selectedMethod === 'stream-saver') {
      const streamSaver = await StreamSaverLibrary
      writableStream = streamSaver.createWriteStream(filename) as unknown as WritableStream
      isAppendOnly = true
    } else {
      throw new Error('当前浏览器不支持所选的保存方式')
    }

    try {
      await single(
        video.title,
        video.url,
        audio.url,
        writableStream,
        isAppendOnly,
        options,
        i + 1,
        pages.length,
        page.fragments[0].length,
      )

      if (selectedMethod === 'opfs' && opfsFileHandle) {
        const file = await opfsFileHandle.getFile()
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        showCleanupToast(opfsFileHandle.name)
      }
    } catch (e) {
      console.error(e)
      if (!isAppendOnly && 'abort' in writableStream) {
        await (writableStream as any).abort()
      }
      if (selectedMethod === 'opfs' && opfsFileHandle) {
        const root = await navigator.storage.getDirectory()
        await root
          .removeEntry(opfsFileHandle.name)
          .catch(error => console.error(`${pluginTitle} - 清理失败:`, error))
        pendingCleanupFiles.delete(opfsFileHandle.name)
      }
      throw e
    }
  }
}
