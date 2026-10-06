<script setup lang="ts">
/**
 * <EmptyPanel> 空数据引导与新建入口。
 * 被全部列表页消费；列表为空、筛选无结果、层级路由 id 不存在时统一使用。
 */
import { computed } from 'vue'
import { Box, FolderOpened, MagicStick, Plus } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    actionText?: string
    secondaryText?: string
    showSeed?: boolean
    compact?: boolean
  }>(),
  {
    title: '暂无数据',
    description: '当前筛选条件下没有记录，可调整条件或新建一条。',
    actionText: '',
    secondaryText: '',
    showSeed: false,
    compact: false
  }
)

const emit = defineEmits<{
  (event: 'action'): void
  (event: 'secondary'): void
  (event: 'seed'): void
}>()

const iconComponent = computed(() => (props.showSeed ? MagicStick : props.actionText ? Box : FolderOpened))
</script>

<template>
  <div class="empty-panel" :class="{ 'is-compact': compact }">
    <el-icon class="empty-panel__icon"><component :is="iconComponent" /></el-icon>
    <h3 class="empty-panel__title">{{ title }}</h3>
    <p class="empty-panel__desc">{{ description }}</p>
    <div class="empty-panel__actions">
      <el-button v-if="actionText" type="primary" :icon="Plus" @click="emit('action')">{{ actionText }}</el-button>
      <el-button v-if="secondaryText" @click="emit('secondary')">{{ secondaryText }}</el-button>
      <el-button v-if="showSeed" type="success" plain :icon="MagicStick" @click="emit('seed')">生成样例数据</el-button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 44px 24px;
  background: #f4fbfa;
  border: 1px dashed #9ec9c3;
  border-radius: 12px;
  text-align: center;
}

.empty-panel.is-compact {
  padding: 24px 16px;
}

.empty-panel__icon {
  font-size: 34px;
  color: #6aa8a1;
}

.empty-panel__title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: #10312f;
}

.empty-panel__desc {
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.75;
  color: #4c6663;
}

.empty-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
</style>
