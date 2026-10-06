<script setup lang="ts">
/**
 * 模块 2：/reefs/:id/sites 站位列表与水深标记
 * 新增站位并校验经纬度；按水深区间筛选并展开样带列表。
 * 复用 <StatBadge>、<FilterBar>；深链访问时礁区不存在给出友好空态。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Right } from '@element-plus/icons-vue'
import StatBadge from '@/components/common/StatBadge.vue'
import FilterBar from '@/components/common/FilterBar.vue'
import type { FilterModel } from '@/types/filter'
import { buildQuery, queryToNumber } from '@/types/filter'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import BleachTag from '@/components/common/BleachTag.vue'
import RouteMissingPanel from '@/components/common/RouteMissingPanel.vue'
import { useReefStore } from '@/stores/reefStore'
import { useBeltStore } from '@/stores/beltStore'
import { useSurveyStore } from '@/stores/surveyStore'
import { formatLatLng, SUBSTRATES, validateLatLng } from '@/types/site'
import type { Site } from '@/types/site'
import { bleachGrade, bleachIndex } from '@/utils/bleach'
import { initDatabase } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const reefStore = useReefStore()
const beltStore = useBeltStore()
const surveyStore = useSurveyStore()

const reefId = computed(() => String(route.params.id ?? ''))
const reef = computed(() => reefStore.reefById(reefId.value))

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const form = reactive({
  no: '',
  lat: 18.5,
  lng: 110.5,
  depthM: 5,
  substrate: SUBSTRATES[0]
})

/** 站位行：汇总样带数、珊瑚记录数与平均白化指数 */
const rows = computed(() => {
  const sites = reefStore.sitesOfReef(reefId.value).filter((site) => {
    const keyword = reefStore.siteFilter.keyword.trim()
    if (keyword.length > 0 && !`${site.no}${site.substrate}`.includes(keyword)) return false
    if (reefStore.siteFilter.minDepthM !== null && site.depthM < reefStore.siteFilter.minDepthM) return false
    if (reefStore.siteFilter.maxDepthM !== null && site.depthM > reefStore.siteFilter.maxDepthM) return false
    return true
  })
  return sites.map((site) => {
    const belts = beltStore.beltsOfSite(site.id)
    const beltIds = new Set(belts.map((belt) => belt.id))
    const corals = surveyStore.corals.filter((coral) => beltIds.has(coral.beltId))
    const index = bleachIndex(corals)
    return {
      site,
      beltCount: belts.length,
      beltLengthM: belts.reduce((sum, belt) => sum + belt.lengthM, 0),
      coralCount: corals.length,
      bleachIndex: index,
      grade: bleachGrade(index)
    }
  })
})

const filterModel = computed<FilterModel>(() => ({
  keyword: reefStore.siteFilter.keyword,
  minDepthM: reefStore.siteFilter.minDepthM,
  maxDepthM: reefStore.siteFilter.maxDepthM
}))

const stats = computed(() => {
  const sites = reefStore.sitesOfReef(reefId.value)
  const depths = sites.map((site) => site.depthM)
  const belts = beltStore.belts.filter((belt) => sites.some((site) => site.id === belt.siteId))
  return {
    siteCount: sites.length,
    beltCount: belts.length,
    minDepthM: depths.length ? Math.min(...depths) : null,
    maxDepthM: depths.length ? Math.max(...depths) : null,
    avgDepthM: depths.length ? Number((depths.reduce((sum, value) => sum + value, 0) / depths.length).toFixed(2)) : null
  }
})

function openCreate(): void {
  editingId.value = null
  const existing = reefStore.sitesOfReef(reefId.value)
  form.no = `S-${String(existing.length + 1).padStart(2, '0')}`
  form.lat = Number((18.5 + existing.length * 0.01).toFixed(4))
  form.lng = Number((110.5 + existing.length * 0.01).toFixed(4))
  form.depthM = 5
  form.substrate = SUBSTRATES[0]
  dialogVisible.value = true
}

function openEdit(site: Site): void {
  editingId.value = site.id
  form.no = site.no
  form.lat = site.lat
  form.lng = site.lng
  form.depthM = site.depthM
  form.substrate = site.substrate
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!form.no.trim()) {
    ElMessage.warning('请填写站位编号')
    return
  }
  const errors = validateLatLng(form.lat, form.lng)
  if (errors.length > 0) {
    ElMessage.warning(`经纬度校验未通过：${errors.join('；')}`)
    return
  }
  if (!Number.isFinite(form.depthM) || form.depthM < 0) {
    ElMessage.warning('水深应为非负数字（m）')
    return
  }
  const duplicated = reefStore
    .sitesOfReef(reefId.value)
    .some((site) => site.no === form.no.trim() && site.id !== editingId.value)
  if (duplicated) {
    ElMessage.warning(`站位编号「${form.no.trim()}」在本礁区已存在`)
    return
  }
  submitting.value = true
  try {
    const payload = {
      reefId: reefId.value,
      no: form.no.trim(),
      lat: form.lat,
      lng: form.lng,
      depthM: form.depthM,
      substrate: form.substrate
    }
    if (editingId.value) {
      await reefStore.updateSite(editingId.value, payload)
      ElMessage.success('站位已更新')
    } else {
      const created = await reefStore.createSite(payload)
      reefStore.selectSite(created.id)
      ElMessage.success(`站位 ${created.no} 已新增（${formatLatLng(created.lat, created.lng)}）`)
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeSite(site: Site): Promise<void> {
  const beltCount = beltStore.beltsOfSite(site.id).length
  try {
    await ElMessageBox.confirm(
      `删除站位「${site.no}」将同时删除其 ${beltCount} 条样带及全部珊瑚与鱼类记录，确认删除？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await reefStore.removeSite(site.id)
  ElMessage.success('站位及其下级数据已删除')
}

function gotoBelts(site: Site): void {
  reefStore.selectSite(site.id)
  void router.push(`/sites/${site.id}/belts`)
}

function handleFilterChange(): void {
  const query = buildQuery({
    kw: reefStore.siteFilter.keyword,
    minDepth: reefStore.siteFilter.minDepthM,
    maxDepth: reefStore.siteFilter.maxDepthM
  })
  void router.replace({ query })
}

function handleReset(): void {
  reefStore.resetSiteFilter()
  void router.replace({ query: {} })
}

onMounted(() => {
  if (reefStore.reefs.length === 0) void initDatabase()
  const query = route.query
  reefStore.patchSiteFilter({
    keyword: typeof query.kw === 'string' ? query.kw : '',
    minDepthM: queryToNumber(query.minDepth),
    maxDepthM: queryToNumber(query.maxDepth)
  })
})
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <el-skeleton v-if="!reefStore.ready" :rows="5" animated />

    <RouteMissingPanel
      v-else-if="!reef"
      entity-label="礁区"
      :missing-id="reefId"
      fallback-path="/reefs"
      fallback-text="返回礁区台账"
      :candidates="
        reefStore.reefs.slice(0, 3).map((item) => ({
          id: item.id,
          label: `${item.name} 的站位`,
          path: `/reefs/${item.id}/sites`
        }))
      "
    />

    <template v-else>
      <div class="page__head">
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/reefs' }">礁区台账</el-breadcrumb-item>
            <el-breadcrumb-item>{{ reef.name }}</el-breadcrumb-item>
            <el-breadcrumb-item>站位列表</el-breadcrumb-item>
          </el-breadcrumb>
          <h2 class="page__title">
            {{ reef.name }} · 站位列表与水深标记
            <el-tag size="small" effect="plain">{{ reef.protectStatus }}</el-tag>
            <el-tag size="small" type="info" effect="plain">面积 {{ reef.areaKm2 }} km²</el-tag>
          </h2>
          <p class="gb-hint">{{ reef.location }} · 管理单位：{{ reef.manager || '未填写' }}</p>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增站位</el-button>
      </div>

      <div class="gb-stats-row">
        <StatBadge label="站位总数" :value="stats.siteCount" suffix="个" icon="Grid" />
        <StatBadge label="样带总数" :value="stats.beltCount" suffix="条" tone="success" icon="Files" />
        <StatBadge
          label="平均水深"
          :value="stats.avgDepthM === null ? '—' : stats.avgDepthM"
          suffix="m"
          tone="info"
          icon="Odometer"
        />
        <StatBadge
          label="水深范围"
          :value="stats.minDepthM === null ? '—' : `${stats.minDepthM} ~ ${stats.maxDepthM}`"
          suffix="m"
          tone="warning"
          icon="TrendCharts"
        />
      </div>

      <FilterBar
        :model-value="filterModel"
        :number-ranges="[
          { key: 'minDepthM', label: '水深不低于', placeholder: '不限', unit: 'm' },
          { key: 'maxDepthM', label: '水深不超过', placeholder: '不限', unit: 'm' }
        ]"
        keyword-placeholder="搜索站位编号 / 底质"
        @change="handleFilterChange"
        @reset="handleReset"
      />

      <EmptyPanel
        v-if="rows.length === 0"
        :title="reefStore.sitesOfReef(reefId).length === 0 ? '该礁区还没有站位' : '没有符合条件的站位'"
        description="新增站位并录入经纬度与水深后，即可布设样带、开展珊瑚与鱼类普查。"
        action-text="新增站位"
        secondary-text="重置筛选"
        @action="openCreate"
        @secondary="handleReset"
      />

      <el-table v-else :data="rows" border stripe class="gb-table-compact">
        <el-table-column prop="site.no" label="站位编号" width="110" />
        <el-table-column label="经纬度（十进制度）" min-width="200">
          <template #default="{ row }">
            <div class="gb-mono">{{ row.site.lat.toFixed(4) }}, {{ row.site.lng.toFixed(4) }}</div>
            <div class="gb-hint gb-mono">{{ formatLatLng(row.site.lat, row.site.lng) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="水深 (m)" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.site.depthM.toFixed(1) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="site.substrate" label="底质" width="120" />
        <el-table-column label="样带" width="120" align="center">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="gotoBelts(row.site)">
              {{ row.beltCount }} 条 / {{ row.beltLengthM }} m
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="珊瑚记录" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coralCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="平均白化" width="150">
          <template #default="{ row }">
            <BleachTag :level="row.grade" :size="'small'" />
            <span class="gb-hint gb-mono"> {{ row.bleachIndex }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" :icon="Right" @click="gotoBelts(row.site)">样带</el-button>
            <el-button size="small" :icon="Edit" @click="openEdit(row.site)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="removeSite(row.site)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyPanel title="暂无站位" description="点击右上角「新增站位」开始布设。" compact />
        </template>
      </el-table>

      <p class="gb-hint">
        提示：经纬度按十进制度录入（纬度 -90 ~ 90、经度 -180 ~ 180），保存时自动校验；同礁区内站位编号不可重复。
      </p>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑站位' : '新增站位'" width="540px" :close-on-click-modal="false">
      <el-form label-width="104px">
        <el-form-item label="站位编号" required>
          <el-input v-model="form.no" placeholder="如：S-01" maxlength="24" />
        </el-form-item>
        <el-form-item label="纬度" required>
          <el-input-number v-model="form.lat" :min="-90" :max="90" :step="0.0001" :precision="4" controls-position="right" />
          <span class="page__unit">°N</span>
        </el-form-item>
        <el-form-item label="经度" required>
          <el-input-number v-model="form.lng" :min="-180" :max="180" :step="0.0001" :precision="4" controls-position="right" />
          <span class="page__unit">°E</span>
        </el-form-item>
        <el-form-item label="水深" required>
          <el-input-number v-model="form.depthM" :min="0" :max="200" :step="0.1" :precision="1" controls-position="right" />
          <span class="page__unit">m</span>
        </el-form-item>
        <el-form-item label="底质">
          <el-select v-model="form.substrate" class="page__full">
            <el-option v-for="item in SUBSTRATES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '新增并布设样带' }}
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
  font-size: 18px;
  color: #0b5d5a;
}

.page__unit {
  margin-left: 8px;
  font-size: 12px;
  color: #7c9995;
}

.page__full {
  width: 100%;
}
</style>
