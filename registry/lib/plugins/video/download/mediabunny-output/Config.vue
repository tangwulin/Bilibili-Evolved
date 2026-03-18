<template>
  <div class="mediabunny-output-config">
    <div class="download-video-config-item" style="flex-wrap: wrap">
      <div class="download-video-config-title">提示：</div>
      <div class="download-video-config-description" style="width: 100%">
        使用浏览器原生接口进行混流，内存占用极低。由于 MediaBunny 限制，目前仅支持输出 MP4
        格式，且不支持附加元数据和封面。
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default Vue.extend({
  // 目前暂无配置项
})
</script>
