import { getComponentSettings } from '@/core/settings'
import { Toast } from '@/core/toast'
import { formatPercent } from '@/core/utils/formatters'
import { title as pluginTitle } from '.'
import type { Options } from '../../../../components/video/download'
import { DownloadVideoAction } from '../../../../components/video/download/types'
import { MediaBunnyLibrary } from '@/core/runtime-library'
import { downloadToOPFS, formatProgress } from './util'

async function single(
  name: string,
  videoUrl: string,
  audioUrl: string,
  writableStream: WritableStream,
  isAppendOnly: boolean,
  pageIndex = 1,
  totalPages = 1,
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

  try {
    const fastStart = isAppendOnly ? false : 'reserve'

    const [vHandle, aHandle] = await Promise.all([
      downloadToOPFS(videoUrl, vFileName, downloadProgress(0, '下载视频流')),
      downloadToOPFS(audioUrl, aFileName, downloadProgress(1, '下载音频流')),
    ])

    const vBlob = await vHandle.getFile()
    const aBlob = await aHandle.getFile()

    lines[0] = '下载视频流: 完成'
    lines[1] = '下载音频流: 完成'
    lines[2] = '正在加载混流引擎...'
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
      Output,
      StreamTarget,
    } = MediaBunny

    lines[2] = '初始化混流引擎...'
    updateToast()

    const videoInput = new Input({
      source: new BlobSource(vBlob),
      formats: ALL_FORMATS,
    })
    const audioInput = new Input({
      source: new BlobSource(aBlob),
      formats: ALL_FORMATS,
    })

    const videoTrack = await videoInput.getPrimaryVideoTrack()
    const audioTrack = await audioInput.getPrimaryAudioTrack()

    if (!videoTrack) {
      throw new Error('视频文件中找不到视频轨道')
    }
    if (!audioTrack) {
      throw new Error('音频文件中找不到音频轨道')
    }

    const videoDecoderConfig = await videoTrack.getDecoderConfig()
    const audioDecoderConfig = await audioTrack.getDecoderConfig()

    lines[2] = '正在分析媒体轨道...'
    updateToast()
    const [videoStats, audioStats] = await Promise.all([
      videoTrack.computePacketStats(),
      audioTrack.computePacketStats(),
    ])

    let target: any
    let mbReadableStream: ReadableStream | null = null

    if (isAppendOnly) {
      // StreamTarget 发出的 chunk 是 { data: Uint8Array, position: number } 对象
      // StreamSaver 需要的是 Uint8Array，且不支持 position。
      const { writable: mbWritable, readable: mbReadable } = new TransformStream({
        transform(chunk: { data: Uint8Array; position: number }, controller) {
          controller.enqueue(chunk.data)
        },
      })
      mbReadableStream = mbReadable
      target = new StreamTarget(mbWritable, { chunked: true, chunkSize: 1024 * 1024 })
    } else {
      // FileSystemWritableFileStream 原生支持随机访问, StreamTarget 内部会处理兼容性
      target = new StreamTarget(writableStream, { chunked: true, chunkSize: 1024 * 1024 })
    }

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart }),
      target,
    })

    const videoSource = new EncodedVideoPacketSource(videoTrack.codec)
    const audioSource = new EncodedAudioPacketSource(audioTrack.codec)

    output.addVideoTrack(videoSource, {
      rotation: videoTrack.rotation,
      frameRate: videoStats.averagePacketRate,
      maximumPacketCount: videoStats.packetCount,
    })
    output.addAudioTrack(audioSource, {
      maximumPacketCount: audioStats.packetCount,
    })

    // 如果是 StreamSaver，手动建立 pipe 链路
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
    const MAX_TIME_DIFF = 2

    const updateMuxProgress = () => {
      const totalProgress = (videoProgress + audioProgress) / 2
      lines[2] = `正在混流: ${formatPercent(totalProgress)}`
      updateToast()
    }

    const videoProcess = async () => {
      const sink = new EncodedPacketSink(videoTrack)
      const stats = videoStats
      const meta = { decoderConfig: videoDecoderConfig ?? undefined }
      let count = 0
      for await (const packet of sink.packets()) {
        await videoSource.add(packet, meta)
        state.videoLastTimestamp = packet.timestamp
        count++
        while (
          !state.audioFinished &&
          state.videoLastTimestamp - state.audioLastTimestamp > MAX_TIME_DIFF
        ) {
          await new Promise(r => setTimeout(r, 100))
        }
        videoProgress = count / stats.packetCount
        updateMuxProgress()
      }
      state.videoFinished = true
      videoSource.close()
    }

    const audioProcess = async () => {
      const sink = new EncodedPacketSink(audioTrack)
      const stats = audioStats
      const meta = { decoderConfig: audioDecoderConfig ?? undefined }
      let count = 0
      for await (const packet of sink.packets()) {
        await audioSource.add(packet, meta)
        state.audioLastTimestamp = packet.timestamp
        count++
        while (
          !state.videoFinished &&
          state.audioLastTimestamp - state.videoLastTimestamp > MAX_TIME_DIFF
        ) {
          await new Promise(r => setTimeout(r, 100))
        }
        audioProgress = count / stats.packetCount
        updateMuxProgress()
      }
      state.audioFinished = true
      audioSource.close()
    }

    await Promise.all([videoProcess(), audioProcess()])
    await output.finalize()

    // 等待管道传输完毕
    if (pipePromise) {
      await pipePromise
    }

    lines[2] = '混流完成！'
    updateToast()
    toast.duration = 1000

    const root = await navigator.storage.getDirectory()
    await root.removeEntry(vFileName)
    await root.removeEntry(aFileName)

    videoInput.dispose()
    audioInput.dispose()
  } catch (error) {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(vFileName)
      await root.removeEntry(aFileName)
    } catch {
      /* ignore */
    }
    throw error
  } finally {
    toast.close()
  }
}

export async function run(action: DownloadVideoAction) {
  const { infos: pages } = action
  const { dashAudioExtension, dashFlacAudioExtension, dashVideoExtension } =
    getComponentSettings<Options>('downloadVideo').options

  let directoryHandle: any
  if (pages.length > 1 && 'showDirectoryPicker' in unsafeWindow) {
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

    const filename = video.title
    let writableStream: WritableStream
    let isAppendOnly = false

    if (directoryHandle) {
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true })
      writableStream = await fileHandle.createWritable()
    } else if ('showSaveFilePicker' in unsafeWindow) {
      try {
        const saveHandle = await unsafeWindow.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: 'MP4 Video',
              accept: { 'video/mp4': ['.mp4'] },
            },
          ],
        })

        writableStream = await saveHandle.createWritable()
      } catch (e) {
        if (e.name === 'AbortError') {
          throw new Error('用户取消了保存')
        }
        console.error(e)
        // 由于mp4格式无法做到仅追加写入，所以只能先抛错误
        throw e
        // const streamSaver = await StreamSaverLibrary
        // writableStream = streamSaver.createWriteStream(filename) as unknown as WritableStream
        // isAppendOnly = true
      }
    } else {
      // 由于mp4格式无法做到仅追加写入，所以只能先抛错误
      throw new Error('当前浏览器不支持保存文件')
      // const streamSaver = await StreamSaverLibrary
      // writableStream = streamSaver.createWriteStream(filename) as unknown as WritableStream
      // isAppendOnly = true
    }

    try {
      await single(
        video.title,
        video.url,
        audio.url,
        writableStream,
        isAppendOnly,
        i + 1,
        pages.length,
      )
    } catch (e) {
      console.error(e)
      if (!isAppendOnly && 'abort' in writableStream) {
        await (writableStream as any).abort()
      }
      throw e
    }
  }
}
