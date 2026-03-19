<template>
  <div class="mediabunny-output-config">
    <div class="download-video-config-item" style="flex-wrap: wrap; margin-bottom: 8px">
      <div class="download-video-config-title">输出格式：</div>
      <VDropdown v-model="format" :items="availableFormats" @change="saveOptions">
        <template #item="{ item }">
          {{ formatDisplayNames[item] }}
        </template>
      </VDropdown>
      <div
        v-if="outputMethod === 'stream-saver'"
        class="download-video-config-description"
        style="width: 100%; color: var(--theme-color); font-size: 11px; margin-top: 4px"
      >
        当前输出方式不支持标准 MP4, 已自动切换。
      </div>
    </div>
    <div
      v-if="format === 'mp4'"
      class="download-video-config-item"
      style="flex-wrap: wrap; margin-bottom: 16px"
    >
      <div class="download-video-config-title">快速启动：</div>
      <VDropdown v-model="fastStart" :items="fastStartOptions" @change="saveOptions">
        <template #item="{ item }">
          {{ fastStartDisplayNames[item] }}
        </template>
      </VDropdown>
      <div class="download-video-config-description" style="width: 100%">
        将 MP4 元数据 (moov) 移至文件开头以便在未完全下载时预览。
        <div v-if="fastStart === 'reserve'" style="margin-top: 4px">
          <b>预留空间 (推荐):</b> 在文件头预留 1MB 空间。适合大文件, 性能与兼容性最佳。
        </div>
        <div v-if="fastStart === 'in-memory'" style="margin-top: 4px">
          <b>内存缓存:</b> 在内存中重排元数据。处理超大文件时可能导致浏览器崩溃。
        </div>
        <div v-if="fastStart === 'fragmented'" style="margin-top: 4px">
          <b>分片写入:</b> 使用 fMP4 结构。兼容性好, 但部分旧版播放器无法识别。
        </div>
      </div>
    </div>
    <div class="download-video-config-item" style="flex-wrap: wrap; margin-bottom: 8px">
      <div class="download-video-config-title">输出方式：</div>
      <VDropdown
        v-model="outputMethod"
        :items="availableOutputMethods"
        @change="handleOutputMethodChange"
      >
        <template #item="{ item }">
          {{ outputMethodDisplayNames[item] }}
        </template>
      </VDropdown>
      <div class="download-video-config-description" style="width: 100%">
        决定合并后的视频文件如何“下载”到本地。
        <div v-if="outputMethod === 'file-system-access'" style="margin-top: 4px">
          <b>优点:</b> 性能最佳, 兼容所有快速启动选项。下载完成后文件即在目录中, 无需额外导出。<br />
          <b>缺点:</b> 仅支持Chromium内核浏览器，且每次任务开始时都需要手动确认保存位置。
        </div>
        <div v-if="outputMethod === 'opfs'" style="margin-top: 4px">
          <b>优点:</b> 使用浏览器私有存储暂存, 下载中无需用户干预, 支持所有快速启动选项。<br />
          <b>缺点:</b> 混流完成后会弹出保存框, 大文件在“导出”过程中可能需要较长时间。
        </div>
        <div v-if="outputMethod === 'stream-saver'" style="margin-top: 4px">
          <b>优点:</b> 理论上不占用浏览器额外存储空间, 直接流向下载管理器。<br />
          <b>缺点:</b> <span style="color: #ff3333"><b>不支持标准 MP4</b></span
          >。由于 StreamSaver 的流式特性, 无法在合并结束后回到文件开头写入元数据,
          因此仅能输出不依赖回溯的<b>分片 MP4 (fMP4)</b> 或 MKV<b
            >（但元数据在尾部的MKV的某些功能（例如文件持续时间或进度条）将被禁用或受到影响，请自行测试）。</b
          ><br />）。此外, 若合并过程中浏览器崩溃或标签页被关闭, 生成的文件将因缺少索引而彻底损坏。
        </div>
      </div>
    </div>
    <div class="download-video-config-item" style="flex-wrap: wrap">
      <div class="download-video-config-title">提示：</div>
      <div class="download-video-config-description" style="width: 100%">
        使用浏览器原生 <code>WebCodecs API</code> 进行混流，内存占用极低。目前 MediaBunny
        暂不支持注入封面和弹幕元数据。
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { VDropdown } from '@/ui'
import { getComponentSettings } from '@/core/settings'
import {
  MediaBunnyFastStart,
  MediaBunnyOutputFormat,
  MediaBunnyOutputMethod,
  Options,
} from './types'

const defaultOptions: Options = {
  mediabunnyFormat: 'mp4',
  mediabunnyFastStart: 'reserve',
  mediabunnyOutputMethod: 'file-system-access',
}
const { options: storedOptions } = getComponentSettings('downloadVideo')
const options: Options = { ...defaultOptions, ...storedOptions }

const supportsFileSystemAccess = 'showSaveFilePicker' in unsafeWindow
const supportsOPFS = navigator.storage && 'getDirectory' in navigator.storage
const supportsStreamSaver = true // 脚本已集成

export default Vue.extend({
  components: {
    VDropdown,
  },
  data() {
    const availableOutputMethods: MediaBunnyOutputMethod[] = []
    if (supportsFileSystemAccess) {
      availableOutputMethods.push('file-system-access')
    }
    if (supportsOPFS) {
      availableOutputMethods.push('opfs')
    }
    if (supportsStreamSaver) {
      availableOutputMethods.push('stream-saver')
    }

    let currentOutputMethod = options.mediabunnyOutputMethod
    if (!availableOutputMethods.includes(currentOutputMethod)) {
      currentOutputMethod = availableOutputMethods[0]
    }

    const formats: MediaBunnyOutputFormat[] = ['mp4', 'fragmented-mp4', 'mkv']
    let format = options.mediabunnyFormat
    if (currentOutputMethod === 'stream-saver' && format === 'mp4') {
      format = 'fragmented-mp4'
    }

    return {
      format,
      fastStart: options.mediabunnyFastStart,
      outputMethod: currentOutputMethod,
      formats,
      formatDisplayNames: {
        mp4: 'MP4',
        'fragmented-mp4': '分片 MP4 (Fragmented MP4)',
        mkv: 'MKV',
      },
      fastStartOptions: [false, 'in-memory', 'reserve', 'fragmented'] as MediaBunnyFastStart[],
      fastStartDisplayNames: {
        false: '禁用',
        'in-memory': '内存缓存',
        reserve: '预留空间',
        fragmented: '分片写入',
      },
      availableOutputMethods,
      outputMethodDisplayNames: {
        'file-system-access': 'File System Access API (推荐)',
        opfs: 'OPFS 暂存',
        'stream-saver': 'StreamSaver',
      },
    }
  },
  computed: {
    availableFormats(): MediaBunnyOutputFormat[] {
      if (this.outputMethod === 'stream-saver') {
        return this.formats.filter(f => f !== 'mp4')
      }
      return this.formats
    },
  },
  methods: {
    handleOutputMethodChange() {
      if (this.outputMethod === 'stream-saver' && this.format === 'mp4') {
        this.format = 'fragmented-mp4'
      }
      this.saveOptions()
    },
    saveOptions() {
      options.mediabunnyFormat = this.format
      options.mediabunnyFastStart = this.fastStart
      options.mediabunnyOutputMethod = this.outputMethod
      Object.assign(storedOptions, options)
    },
  },
})
</script>
