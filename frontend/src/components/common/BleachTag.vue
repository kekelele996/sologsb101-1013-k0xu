<script setup lang="ts">
/**
 * <BleachTag> 按无/轻/中/重/死亡渲染底色与图标。
 * 被珊瑚计数页（/belts/:id/corals）与覆盖度汇总页（/coverage）消费。
 */
import { computed } from 'vue'
import { CircleCheckFilled, CircleCloseFilled, InfoFilled, Warning, WarningFilled } from '@element-plus/icons-vue'
import type { BleachLevel } from '@/types/coralRecord'
import { BLEACH_BG, BLEACH_COLOR, BLEACH_ICON, BLEACH_WEIGHT } from '@/utils/bleach'

const props = withDefaults(
  defineProps<{
    level: BleachLevel
    /** 是否显示图标 */
    icon?: boolean
    /** 覆盖长度（cm），传入后一并展示 */
    coverCm?: number
    size?: 'default' | 'small' | 'large'
    /** 是否使用浅色描边风格 */
    plain?: boolean
  }>(),
  {
    icon: true,
    coverCm: undefined,
    size: 'default',
    plain: false
  }
)

const iconComponent = computed(() => {
  const name = BLEACH_ICON[props.level]
  if (name === 'CircleCloseFilled') return CircleCloseFilled
  if (name === 'WarningFilled') return WarningFilled
  if (name === 'Warning') return Warning
  if (name === 'InfoFilled') return InfoFilled
  return CircleCheckFilled
})

const style = computed(() => ({
  color: props.plain ? BLEACH_COLOR[props.level] : '#ffffff',
  backgroundColor: props.plain ? BLEACH_BG[props.level] : BLEACH_COLOR[props.level],
  borderColor: BLEACH_COLOR[props.level]
}))

const tip = computed(() => {
  const weight = BLEACH_WEIGHT[props.level]
  return `白化等级「${props.level}」（权重 ${weight}）${props.coverCm === undefined ? '' : `，覆盖 ${props.coverCm} cm`}`
})

const coverText = computed(() => (props.coverCm === undefined ? '' : `${props.coverCm} cm`))
</script>

<template>
  <el-tooltip :content="tip" placement="top">
    <span class="bleach-tag" :class="[`is-${size}`, { 'is-plain': plain }]" :style="style">
      <el-icon v-if="icon" class="bleach-tag__icon"><component :is="iconComponent" /></el-icon>
      <span class="bleach-tag__text">{{ level }}</span>
      <span v-if="coverText" class="bleach-tag__cover">· {{ coverText }}</span>
    </span>
  </el-tooltip>
</template>

<style scoped>
.bleach-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}

.bleach-tag.is-small {
  padding: 0 8px;
  font-size: 12px;
  line-height: 18px;
}

.bleach-tag.is-large {
  padding: 4px 14px;
  font-size: 15px;
  line-height: 24px;
}

.bleach-tag__icon {
  font-size: 13px;
}

.bleach-tag__cover {
  font-weight: 400;
  opacity: 0.9;
}
</style>
