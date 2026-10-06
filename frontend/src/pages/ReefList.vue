<script setup lang="ts">
/**
 * 模块 1：/reefs 礁区台账
 * 新建礁区、按保护区状态筛选；卡片汇总站位总数与本礁区平均白化指数。
 * 复用 <FilterBar>、<EmptyPanel>。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, MagicStick, Plus, Right } from '@element-plus/icons-vue'
import FilterBar from '@/components/common/FilterBar.vue'
import type { FilterModel } from '@/types/filter'
import { buildQuery, queryToArray, queryToNumber } from '@/types/filter'
import StatBadge from '@/components/common/StatBadge.vue'
import BleachTag from '@/components/common/BleachTag.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import { useReefStore } from '@/stores/reefStore'
import { useBeltStore } from '@/stores/beltStore'
import { useSurveyStore } from '@/stores/surveyStore'
import { AREA_BUCKETS, createEmptyReefFilter, PROTECT_STATUSES } from '@/types/reef'
import type { ProtectStatus, Reef } from '@/types/reef'
import { bleachGrade, bleachIndex } from '@/utils/bleach'
import { initDatabase } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const reefStore = useReefStore()
const beltStore = useBeltStore()
const surveyStore = useSurveyStore()

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const areaBucket = ref(AREA_BUCKETS[0].label)
const form = reactive({
  name: '',
  location: '',
  areaKm2: 10,
  protectStatus: '实验区' as ProtectStatus,
  manager: ''
})

/** 礁区卡片：汇总站位/样带/珊瑚记录数与平均白化指数 */
const cards = computed(() =>
  reefStore.filteredReefs.map((reef: Reef) => {
    const sites = reefStore.sites.filter((site) => site.reefId === reef.id)
    const siteIds = new Set(sites.map((site) => site.id))
    const belts = beltStore.belts.filter((belt) => siteIds.has(belt.siteId))
    const beltIds = new Set(belts.map((belt) => belt.id))
    const corals = surveyStore.corals.filter((coral) => beltIds.has(coral.beltId))
    const fishes = surveyStore.fishes.filter((fish) => beltIds.has(fish.beltId))
    const index = bleachIndex(corals)
    return {
      reef,
      siteCount: sites.length,
      beltCount: belts.length,
      coralCount: corals.length,
      fishTotal: fishes.reduce((sum, fish) => sum + fish.count, 0),
      bleachIndex: index,
      grade: bleachGrade(index)
    }
  })
)

const filterModel = computed<FilterModel>(() => ({
  keyword: reefStore.filter.keyword,
  protectStatuses: reefStore.filter.protectStatuses,
  minAreaKm2: reefStore.filter.minAreaKm2,
  maxAreaKm2: reefStore.filter.maxAreaKm2
}))

const totals = computed(() => ({
  reefs: cards.value.length,
  sites: cards.value.reduce((sum, card) => sum + card.siteCount, 0),
  belts: cards.value.reduce((sum, card) => sum + card.beltCount, 0),
  corals: cards.value.reduce((sum, card) => sum + card.coralCount, 0),
  avgBleachIndex:
    cards.value.length === 0
      ? 0
      : Number((cards.value.reduce((sum, card) => sum + card.bleachIndex, 0) / cards.value.length).toFixed(2))
}))

async function syncQuery(): Promise<void> {
  const query = buildQuery({
    kw: reefStore.filter.keyword,
    status: reefStore.filter.protectStatuses,
    minArea: reefStore.filter.minAreaKm2,
    maxArea: reefStore.filter.maxAreaKm2
  })
  await router.replace({ query })
}

function applyQuery(): void {
  const query = route.query
  reefStore.patchFilter({
    keyword: typeof query.kw === 'string' ? query.kw : '',
    protectStatuses: queryToArray(query.status) as ProtectStatus[],
    minAreaKm2: queryToNumber(query.minArea),
    maxAreaKm2: queryToNumber(query.maxArea)
  })
  const bucket = AREA_BUCKETS.find(
    (item) => item.min === reefStore.filter.minAreaKm2 && item.max === reefStore.filter.maxAreaKm2
  )
  areaBucket.value = bucket ? bucket.label : AREA_BUCKETS[0].label
}

function handleFilterChange(): void {
  void syncQuery()
}

function handleBucketChange(label: string): void {
  const bucket = AREA_BUCKETS.find((item) => item.label === label)
  reefStore.patchFilter({ minAreaKm2: bucket?.min ?? null, maxAreaKm2: bucket?.max ?? null })
  void syncQuery()
}

function handleReset(): void {
  reefStore.resetFilter()
  areaBucket.value = AREA_BUCKETS[0].label
  void syncQuery()
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.location = ''
  form.areaKm2 = 10
  form.protectStatus = '实验区'
  form.manager = ''
  dialogVisible.value = true
}

function openEdit(reef: Reef): void {
  editingId.value = reef.id
  form.name = reef.name
  form.location = reef.location
  form.areaKm2 = reef.areaKm2
  form.protectStatus = reef.protectStatus
  form.manager = reef.manager
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请填写礁区名称')
    return
  }
  if (!Number.isFinite(form.areaKm2) || form.areaKm2 <= 0) {
    ElMessage.warning('面积应为大于 0 的数字（km²）')
    return
  }
  submitting.value = true
  try {
    if (editingId.value) {
      await reefStore.updateReef(editingId.value, { ...form })
      ElMessage.success('礁区信息已更新')
    } else {
      const created = await reefStore.createReef({ ...form })
      reefStore.selectReef(created.id)
      ElMessage.success('礁区已新建，可进入站位布设')
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeReef(reef: Reef): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除礁区「${reef.name}」将同时删除其站位、样带、珊瑚记录与鱼类计数，确认删除？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await reefStore.removeReef(reef.id)
  ElMessage.success('礁区及其下级数据已删除')
}

function gotoSites(reef: Reef): void {
  reefStore.selectReef(reef.id)
  void router.push(`/reefs/${reef.id}/sites`)
}

async function reseed(): Promise<void> {
  await initDatabase()
  ElMessage.success('已按需补齐演示数据（幂等播种）')
}

onMounted(() => {
  applyQuery()
  if (reefStore.reefs.length === 0) void reseed()
})

watch(
  () => route.query,
  () => {
    if (route.path !== '/reefs') return
    applyQuery()
  }
)
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <div class="page__head">
      <div>
        <h2 class="page__title">礁区台账</h2>
        <p class="gb-hint">
          维护礁区基本信息与保护区状态，卡片汇总站位总数、样带条数与平均白化指数。点击「站位布设」进入子页面。
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建礁区</el-button>
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="[
        {
          key: 'protectStatuses',
          label: '保护区状态',
          options: PROTECT_STATUSES.map((item) => ({ label: item, value: item }))
        }
      ]"
      keyword-placeholder="搜索礁区名 / 位置 / 管理单位"
      @change="handleFilterChange"
      @reset="handleReset"
    >
      <template #extra>
        <div class="page__bucket">
          <span class="page__bucket-label">礁区面积</span>
          <el-select :model-value="areaBucket" class="page__bucket-select" @change="handleBucketChange">
            <el-option v-for="bucket in AREA_BUCKETS" :key="bucket.label" :label="bucket.label" :value="bucket.label" />
          </el-select>
        </div>
      </template>
      <template #actions>
        <el-button size="small" :icon="MagicStick" @click="reseed">补齐演示数据</el-button>
      </template>
    </FilterBar>

    <div class="gb-stats-row">
      <StatBadge label="筛选后礁区" :value="totals.reefs" suffix="个" icon="Odometer" />
      <StatBadge label="站位总数" :value="totals.sites" suffix="个" tone="info" icon="Grid" />
      <StatBadge label="样带总数" :value="totals.belts" suffix="条" tone="success" icon="Files" />
      <StatBadge label="珊瑚记录" :value="totals.corals" suffix="条" icon="Histogram" />
      <StatBadge
        label="平均白化指数"
        :value="totals.avgBleachIndex"
        suffix="/ 4"
        :tone="totals.avgBleachIndex > 1 ? 'warning' : 'success'"
        :icon="totals.avgBleachIndex > 1 ? 'WarningFilled' : 'DataLine'"
      />
    </div>

    <EmptyPanel
      v-if="cards.length === 0"
      :title="reefStore.hasFilter ? '没有符合条件的礁区' : '还没有礁区'"
      :description="
        reefStore.hasFilter
          ? '当前筛选条件（保护区状态 / 面积 / 关键字）下没有礁区，可重置条件或新建一个礁区。'
          : '新建第一个礁区后即可布设站位、样带并录入珊瑚分类覆盖与鱼类计数。'
      "
      action-text="新建礁区"
      secondary-text="重置筛选"
      @action="openCreate"
      @secondary="handleReset"
    />

    <div v-else class="reef-grid">
      <el-card v-for="card in cards" :key="card.reef.id" shadow="hover" class="reef-card">
        <template #header>
          <div class="reef-card__head">
            <div>
              <strong class="reef-card__name">{{ card.reef.name }}</strong>
              <el-tag size="small" effect="plain" class="reef-card__status">{{ card.reef.protectStatus }}</el-tag>
            </div>
            <BleachTag :level="card.grade" size="small" />
          </div>
        </template>

        <div class="reef-card__stats">
          <StatBadge label="站位" :value="card.siteCount" suffix="个" size="small" tone="info" icon="Grid" />
          <StatBadge label="样带" :value="card.beltCount" suffix="条" size="small" icon="Files" />
          <StatBadge label="珊瑚记录" :value="card.coralCount" suffix="条" size="small" tone="success" icon="Histogram" />
          <StatBadge
            label="白化指数"
            :value="card.bleachIndex"
            suffix="/ 4"
            size="small"
            :tone="card.bleachIndex > 1 ? 'warning' : 'success'"
            icon="TrendCharts"
          />
        </div>

        <div class="reef-card__meta">
          <span>面积 <b class="gb-mono">{{ card.reef.areaKm2 }}</b> km²</span>
          <span>鱼获计数 <b class="gb-mono">{{ card.fishTotal }}</b></span>
          <span v-if="card.reef.manager">管理单位：{{ card.reef.manager }}</span>
        </div>

        <p v-if="card.reef.location" class="reef-card__location">{{ card.reef.location }}</p>

        <div class="reef-card__actions">
          <el-button type="primary" size="small" :icon="Right" @click="gotoSites(card.reef)">站位布设</el-button>
          <el-button size="small" :icon="Edit" @click="openEdit(card.reef)">编辑</el-button>
          <el-button size="small" type="danger" plain :icon="Delete" @click="removeReef(card.reef)">删除</el-button>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑礁区' : '新建礁区'" width="540px" :close-on-click-modal="false">
      <el-form label-width="100px">
        <el-form-item label="礁区名称" required>
          <el-input v-model="form.name" placeholder="如：清澜湾珊瑚礁区" maxlength="40" show-word-limit />
        </el-form-item>
        <el-form-item label="位置">
          <el-input v-model="form.location" placeholder="如：海南文昌清澜湾东侧 3.5 km 海域" maxlength="80" />
        </el-form-item>
        <el-form-item label="面积" required>
          <el-input-number v-model="form.areaKm2" :min="0.01" :max="100000" :step="0.1" :precision="2" controls-position="right" />
          <span class="page__unit">km²</span>
        </el-form-item>
        <el-form-item label="保护区状态" required>
          <el-radio-group v-model="form.protectStatus">
            <el-radio-button v-for="status in PROTECT_STATUSES" :key="status" :value="status">{{ status }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="管理单位">
          <el-input v-model="form.manager" placeholder="如：清澜湾海洋保护站" maxlength="60" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '新建并布设站位' }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.page__title {
  margin: 0 0 4px;
  font-size: 19px;
  color: #0b5d5a;
}

.page__bucket {
  display: flex;
  align-items: center;
  gap: 6px;
}

.page__bucket-label {
  font-size: 13px;
  color: #4c6663;
}

.page__bucket-select {
  width: 160px;
}

.page__unit {
  margin-left: 8px;
  font-size: 12px;
  color: #7c9995;
}

.reef-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}

.reef-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reef-card__name {
  font-size: 16px;
  color: #10312f;
}

.reef-card__status {
  margin-left: 8px;
}

.reef-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.reef-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: #4c6663;
}

.reef-card__location {
  margin: 8px 0 0;
  font-size: 12px;
  color: #7c9995;
  line-height: 1.7;
}

.reef-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
</style>
