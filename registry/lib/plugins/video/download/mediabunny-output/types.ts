export type MediaBunnyOutputFormat = 'mp4' | 'fragmented-mp4' | 'mkv'
export type MediaBunnyFastStart = false | 'in-memory' | 'reserve' | 'fragmented'
export type MediaBunnyOutputMethod = 'file-system-access' | 'opfs' | 'stream-saver'
export type MediaBunnyInputMethod = 'buffer' | 'stream'

export interface Options {
  mediabunnyFormat: MediaBunnyOutputFormat
  mediabunnyFastStart: MediaBunnyFastStart
  mediabunnyOutputMethod: MediaBunnyOutputMethod
  mediabunnyInputMethod: MediaBunnyInputMethod
  mediabunnyInjectCover: boolean
  mediabunnyInjectSubtitles: boolean
}
