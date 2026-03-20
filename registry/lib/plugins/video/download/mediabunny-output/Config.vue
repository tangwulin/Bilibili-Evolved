<template>
  <div class="mediabunny-output-config">
    <div class="download-video-config-item" style="flex-wrap: wrap">
      <div class="download-video-config-title">提示：</div>
      <div class="download-video-config-description" style="width: 100%">
        使用浏览器原生 <code>WebCodecs API</code> 进行混流，内存占用极低。
      </div>
    </div>
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
        将 MP4 元数据 (moov) 移至文件开头以降低大文件的第一帧播放延迟和便于在文件未完全下载时预览。
        <div v-if="fastStart === 'reserve'" style="margin-top: 4px">
          <b>预留空间 (推荐):</b> 在文件头预留一定空间。适合大文件, 性能与兼容性最佳。
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
      <div class="download-video-config-title">源获取方式：</div>
      <VDropdown v-model="inputMethod" :items="inputMethodOptions" @change="saveOptions">
        <template #item="{ item }">
          {{ inputMethodDisplayNames[item] }}
        </template>
      </VDropdown>
      <div class="download-video-config-description" style="width: 100%">
        决定如何获取视频和音频流。
        <div v-if="inputMethod === 'stream'" style="margin-top: 4px">
          <b>边下边合并 (流式):</b>
          实时将网络流喂给混流引擎。边下边存, 几乎不占用额外磁盘空间。适合网络稳定的环境。
        </div>
        <div v-if="inputMethod === 'buffer'" style="margin-top: 4px">
          <b>下载后合并 (暂存):</b>
          先将流完整下载到浏览器存储中, 再进行混流。支持多线程加速下载, 稳定性高、速度极快,
          但合并时需要两倍的剩余磁盘空间。
        </div>
      </div>
    </div>
    <div
      v-if="inputMethod === 'buffer'"
      class="download-video-config-item"
      style="flex-wrap: wrap; margin-bottom: 8px"
    >
      <div class="download-video-config-title">多线程下载：</div>
      <VDropdown v-model="multithread" :items="multithreadOptions" @change="saveOptions">
        <template #item="{ item }">
          {{ multithreadDisplayNames[item] }}
        </template>
      </VDropdown>
      <div class="download-video-config-description" style="width: 100%">
        使用 Web Worker 并发下载视频分片，大幅提升下载速度。
        <div v-if="multithread === 'auto'" style="margin-top: 4px">
          <b>自动探测 (推荐):</b> 自动检测文件大小和服务器特性以决定是否开启分片。
        </div>
        <div v-if="multithread === 'disable'" style="margin-top: 4px">
          <b>禁用:</b>
          回退到单线程下载，适用于网络或浏览器的连接数受限的情况（推荐在同时下载多个文件时选择此选项）。
        </div>
        <div v-if="multithread === 'force'" style="margin-top: 4px">
          <b>强制开启:</b> 无视探测结果强制分片。如果服务器不支持可能导致任务卡死。
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
        决定合并后的视频文件如何“导出”到本地。
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
          ><br />此外, 若合并过程中浏览器崩溃或标签页被关闭, 生成的文件将因缺少索引而彻底损坏。
        </div>
      </div>
    </div>
    <div
      class="download-video-config-item"
      style="flex-direction: row; width: 100%; margin-bottom: 8px"
    >
      <div
        class="download-video-config-title"
        style="flex-shrink: 0; display: flex; flex-wrap: nowrap"
      >
        注入封面：
      </div>
      <div style="display: flex; gap: 16px; width: 100%">
        <SwitchBox v-model="injectCover" @change="saveOptions" />
      </div>
    </div>
    <div
      class="download-video-config-item"
      style="flex-direction: column; width: 100%; margin-bottom: 8px"
    >
      <div style="width: 100%; display: flex; flex-direction: row">
        <div
          class="download-video-config-title"
          style="flex-shrink: 0; display: flex; flex-wrap: nowrap"
        >
          注入字幕：
        </div>
        <div style="display: flex; gap: 16px; width: 100%">
          <SwitchBox v-model="injectSubtitles" @change="saveOptions" />
        </div>
      </div>
      <template v-if="injectSubtitles">
        <div class="subtitle-selection-header">
          <div class="subtitle-selection-title">选择语言:</div>
          <div class="subtitle-selection-actions">
            <VButton
              type="transparent"
              title="全选"
              @click="forEachSubtitle(it => (it.checked = true))"
            >
              <VIcon :size="16" icon="mdi-checkbox-multiple-marked-circle" />
            </VButton>
            <VButton
              type="transparent"
              title="全不选"
              @click="forEachSubtitle(it => (it.checked = false))"
            >
              <VIcon :size="16" icon="mdi-checkbox-multiple-blank-circle-outline" />
            </VButton>
            <VButton
              type="transparent"
              title="反选"
              @click="forEachSubtitle(it => (it.checked = !it.checked))"
            >
              <VIcon :size="16" icon="mdi-circle-slice-4" />
            </VButton>
          </div>
        </div>
        <div class="subtitle-selection-items">
          <div v-if="subtitles.length === 0" class="subtitle-selection-empty">
            <VEmpty />
          </div>
          <div v-for="s of subtitles" :key="s.lan" class="subtitle-selection-item">
            <CheckBox v-model="s.checked" @change="handleSubtitleChange">
              {{ s.lan_doc }} ({{ s.lan }})
            </CheckBox>
          </div>
        </div>
        <div
          v-if="selectedSubtitleLans.length > 0"
          class="download-video-config-item subtitle-default-select"
        >
          <div class="download-video-config-title">默认字幕：</div>
          <VDropdown v-model="defaultSubtitle" :items="selectedSubtitleLans" @change="saveOptions">
            <template #item="{ item }">
              {{ getSubtitleDoc(item) }}
            </template>
          </VDropdown>
        </div>
      </template>
      <div class="download-video-config-description" style="width: 100%">
        目前受 MediaBunny 的功能限制，仅能添加 WebVTT 格式的字幕，请自行确认兼容性。
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { SwitchBox, VDropdown, VButton, VIcon, CheckBox, VEmpty } from '@/ui'
import { getComponentSettings } from '@/core/settings'
import { getSubtitleList, SubtitleInfo } from '../../../../components/video/subtitle/download/utils'
import {
  MediaBunnyFastStart,
  MediaBunnyInputMethod,
  MediaBunnyOutputFormat,
  MediaBunnyOutputMethod,
  MediaBunnyMultithread,
  Options,
} from './types'

const defaultOptions: Options = {
  mediabunnyFormat: 'mp4',
  mediabunnyFastStart: 'reserve',
  mediabunnyOutputMethod: 'file-system-access',
  mediabunnyInputMethod: 'buffer',
  mediabunnyMultithread: 'auto',
  mediabunnyInjectCover: true,
  mediabunnyInjectSubtitles: true,
  mediabunnySubtitleLanguages: [],
  mediabunnyDefaultSubtitle: '',
}
const { options: storedOptions } = getComponentSettings('downloadVideo')
const options: Options = { ...defaultOptions, ...storedOptions }

const supportsFileSystemAccess = 'showSaveFilePicker' in unsafeWindow
const supportsOPFS = navigator.storage && 'getDirectory' in navigator.storage
const supportsStreamSaver = true // 脚本已集成

export default Vue.extend({
  components: {
    VDropdown,
    SwitchBox,
    VButton,
    VIcon,
    CheckBox,
    VEmpty,
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
      inputMethod: options.mediabunnyInputMethod,
      multithread: options.mediabunnyMultithread,
      injectCover: options.mediabunnyInjectCover,
      injectSubtitles: options.mediabunnyInjectSubtitles,
      subtitleLanguages: options.mediabunnySubtitleLanguages,
      defaultSubtitle: options.mediabunnyDefaultSubtitle,
      subtitles: [] as (SubtitleInfo & { checked: boolean })[],
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
      inputMethodOptions: ['stream', 'buffer'] as MediaBunnyInputMethod[],
      inputMethodDisplayNames: {
        stream: '边下边合并 (流式)',
        buffer: '下载后合并 (暂存)',
      },
      multithreadOptions: ['auto', 'disable', 'force'] as MediaBunnyMultithread[],
      multithreadDisplayNames: {
        auto: '自动探测 (推荐)',
        disable: '禁用',
        force: '强制开启',
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
    selectedSubtitleLans(): string[] {
      return this.subtitles.filter(s => s.checked).map(s => s.lan)
    },
  },
  mounted() {
    this.fetchSubtitles()
    if (typeof coreApis !== 'undefined') {
      coreApis.observer.videoChange(() => this.fetchSubtitles())
    }
  },
  methods: {
    async fetchSubtitles() {
      try {
        const { aid = unsafeWindow.aid, cid = unsafeWindow.cid } = unsafeWindow
        if (!aid || !cid) {
          return
        }
        const list = await getSubtitleList(aid, cid)
        this.subtitles = list.map(s => ({
          ...s,
          checked: this.subtitleLanguages.includes(s.lan),
        }))
        if (this.defaultSubtitle && !this.selectedSubtitleLans.includes(this.defaultSubtitle)) {
          this.defaultSubtitle = this.selectedSubtitleLans[0] || ''
        } else if (!this.defaultSubtitle && this.selectedSubtitleLans.length > 0) {
          this.defaultSubtitle = this.selectedSubtitleLans[0]
        }
      } catch (e) {
        console.error('获取字幕列表失败', e)
      }
    },
    handleSubtitleChange() {
      this.subtitleLanguages = this.selectedSubtitleLans
      if (this.defaultSubtitle && !this.selectedSubtitleLans.includes(this.defaultSubtitle)) {
        this.defaultSubtitle = this.selectedSubtitleLans[0] || ''
      } else if (!this.defaultSubtitle && this.selectedSubtitleLans.length > 0) {
        this.defaultSubtitle = this.selectedSubtitleLans[0]
      }
      this.saveOptions()
    },
    getSubtitleDoc(lan: string) {
      const s = this.subtitles.find(it => it.lan === lan)
      return s ? `${s.lan_doc} (${s.lan})` : lan
    },
    forEachSubtitle(action: (item: any) => void) {
      this.subtitles.forEach(action)
      this.handleSubtitleChange()
    },
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
      options.mediabunnyInputMethod = this.inputMethod
      options.mediabunnyMultithread = this.multithread
      options.mediabunnyInjectCover = this.injectCover
      options.mediabunnyInjectSubtitles = this.injectSubtitles
      options.mediabunnySubtitleLanguages = this.subtitleLanguages
      options.mediabunnyDefaultSubtitle = this.defaultSubtitle
      Object.assign(storedOptions, options)
    },
  },
})
</script>

<style lang="scss" scoped>
@import 'common';
.subtitle-selection {
  &-header {
    @include h-center();
    margin-top: 8px;
    margin-bottom: 4px;
    width: 100%;
  }
  &-title {
    flex-grow: 1;
    font-size: 12px;
    opacity: 0.8;
  }
  &-actions {
    @include h-center();
    .be-button {
      padding: 2px;
    }
  }
  &-items {
    max-height: 120px;
    overflow: auto;
    width: 100%;
    border: 1px solid #8884;
    border-radius: 4px;
    padding: 4px;
    @include no-scrollbar();

    .be-check-box {
      padding: 2px 4px;
    }
  }
  &-empty {
    padding: 8px;
    text-align: center;
  }
}
.subtitle-default-select {
  width: 100%;
  margin-top: 8px;
}
</style>
