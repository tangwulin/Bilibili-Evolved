import { Toast } from '@/core/toast'
import { PluginMetadata } from '@/plugins/plugin'
import { DownloadVideoOutput } from '../../../../components/video/download/types'
import { run } from './handle'

export const title = '浏览器混流输出'
const desc = '使用 MediaBunny 在浏览器中流式下载并合并音视频, 极低内存占用, 支持超大视频'

export const plugin: PluginMetadata = {
  name: 'downloadVideo.outputs.mediabunny',
  displayName: `下载视频 - ${title}`,
  description: desc,
  author: [
    {
      name: 'Grant Howard',
      link: 'https://github.com/the1812',
    },
  ],
  setup: ({ addData }) => {
    addData('downloadVideo.outputs', (outputs: DownloadVideoOutput[]) => {
      outputs.push({
        name: 'mediabunny',
        displayName: 'MediaBunny (Beta)',
        description: `${desc}。运行过程中请勿关闭页面。使用 OPFS 进行流式处理，理论上支持无限大的视频合并。`,
        runAction: async action => {
          try {
            await run(action)
          } catch (error) {
            console.error(error)
            Toast.error(String(error), title)
          }
        },
        component: () => import('./Config.vue').then(m => m.default),
      })
    })
  },
}
