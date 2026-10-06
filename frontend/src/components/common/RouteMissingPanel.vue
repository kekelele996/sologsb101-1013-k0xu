<script setup lang="ts">
/**
 * <RouteMissingPanel> 层级路由友好空态。
 * 直接深链访问 /reefs/:id/sites、/sites/:id/belts、/belts/:id/corals 等路由时，
 * 若 IndexedDB 中查不到该 id，统一渲染本组件（而不是白屏），并提供返回入口与可用 id 快捷跳转。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Back, Link, WarningFilled } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    /** 缺什么就说什么，如「礁区」「站位」「样带」 */
    entityLabel: string
    /** 缺失的 id，原样回显便于排查 */
    missingId?: string
    /** 父级列表路由 */
    fallbackPath: string
    fallbackText?: string
    /** 可用的 id 快捷入口 */
    candidates?: Array<{ id: string; label: string; path: string }>
  }>(),
  {
    missingId: '',
    fallbackText: '返回列表',
    candidates: () => []
  }
)

const router = useRouter()
const missingText = computed(() =>
  props.missingId
    ? `${props.entityLabel}（id: ${props.missingId}）在本地 IndexedDB 中不存在`
    : `${props.entityLabel}在本地 IndexedDB 中不存在`
)

function go(path: string): void {
  void router.push(path)
}
</script>

<template>
  <div class="route-missing">
    <el-icon class="route-missing__icon"><WarningFilled /></el-icon>
    <h3 class="route-missing__title">未找到对应的{{ entityLabel }}</h3>
    <p class="route-missing__desc">
      {{ missingText }}。可能该记录已被删除，或链接来自其他浏览器的本地数据（本应用的数据只保存在当前浏览器 IndexedDB）。
    </p>
    <div class="route-missing__actions">
      <el-button type="primary" :icon="Back" @click="go(fallbackPath)">{{ fallbackText }}</el-button>
      <el-button v-for="candidate in candidates" :key="candidate.id" :icon="Link" @click="go(candidate.path)">
        {{ candidate.label }}
      </el-button>
    </div>
    <slot name="extra" />
  </div>
</template>

<style scoped>
.route-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  background: #fffaf0;
  border: 1px dashed #e0b070;
  border-radius: 12px;
  text-align: center;
}

.route-missing__icon {
  font-size: 36px;
  color: #d68910;
}

.route-missing__title {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 600;
  color: #7a4a06;
}

.route-missing__desc {
  margin: 0;
  max-width: 640px;
  font-size: 13px;
  line-height: 1.8;
  color: #8a6a3a;
}

.route-missing__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}
</style>
