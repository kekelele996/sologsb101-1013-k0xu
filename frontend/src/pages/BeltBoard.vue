<script setup lang="ts">
/**
 * 模块 3：/sites/:id/belts 样带布设
 * 录长度/朝向/调查日期并回显已录记录数；朝向排序校验，深链访问时站位不存在给出友好空态。
 * 复用 <StatBadge>、<EmptyPanel>。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Right, Warning } from '@element-plus/icons-vue'
import StatBadge from '@/components/common/StatBadge.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import BleachTag from '@/components/common/BleachTag.vue'
import RouteMissingPanel from '@/components/common/RouteMissingPanel.vue'
import { useReefStore } from '@/stores/reefStore'
import { ORIENTATION_ORDER, useBeltStore } from '@/stores/beltStore'
import { useSurveyStore } from '@/stores/surveyStore'
import { BELT_LENGTH_PRESETS, ORIENTATIONS } from '@/types/belt'
import type { Belt, Orientation } from '@/types/belt'
import { bleachGrade, bleachIndex, coralCoveragePct, fishDensity } from '@/utils/bleach'
import { initDatabase } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const reefStore = useReefStore()
const beltStore = useBeltStore()
const surveyStore = useSurveyStore()

const siteId = computed(() => String(route.params.id ?? ''))
const site = computed(() => reefStore.siteById(siteId.value))
const reef = computed(() => (site.value ? reefStore.reefById(site.value.reefId) : null))

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const form = reactive({
  no: '',
  lengthM: 50,
  orientation: '北' as Orientation,
  surveyDate: new Date().toISOString().slice(0, 10),
  observer: ''
})

/** 样带行：回显珊瑚记录数、鱼类记录数、覆盖率与白化指数 */
const rows = computed(() =>
  beltStore.beltsOfSite(siteId.value).map((belt) => {
    const corals = surveyStore.coralsOfBelt(belt.id)
    const fishes = surveyStore.fishesOfBelt(belt.id)
    const coverCmTotal = corals.reduce((sum, coral) => sum + coral.coverCm, 0)
    const index = bleachIndex(corals)
    const fishTotal = fishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
    return {
      belt,
      coralCount: corals.length,
      fishCount: fishes.length,
      coverCmTotal,
      coveragePct: coralCoveragePct(coverCmTotal, belt.lengthM),
      bleachIndex: index,
      grade: bleachGrade(index),
      fishDensity: fishDensity(fishTotal, belt.lengthM)
    }
  })
)

const conflicts = computed(() => beltStore.findBeltConflicts(siteId.value))

const stats = computed(() => {
  const belts = beltStore.beltsOfSite(siteId.value)
  const totalLength = belts.reduce((sum, belt) => sum + belt.lengthM, 0)
  const coralCount = belts.reduce((sum, belt) => sum + surveyStore.coralsOfBelt(belt.id).length, 0)
  const fishCount = belts.reduce((sum, belt) => sum + surveyStore.fishesOfBelt(belt.id).length, 0)
  return {
    beltCount: belts.length,
    totalLength,
    coralCount,
    fishCount,
    orientationCount: new Set(belts.map((belt) => belt.orientation)).size
  }
})

function nextNo(): string {
  const numbers = beltStore
    .beltsOfSite(siteId.value)
    .map((belt) => Number(belt.no.replace(/[^0-9]/g, '')))
    .filter((value) => Number.isFinite(value))
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1
  return `T-${String(next).padStart(2, '0')}`
}

function openCreate(): void {
  editingId.value = null
  const existing = beltStore.beltsOfSite(siteId.value)
  form.no = nextNo()
  form.lengthM = existing[0]?.lengthM ?? 50
  form.orientation = ORIENTATIONS[existing.length % ORIENTATIONS.length]
  form.surveyDate = new Date().toISOString().slice(0, 10)
  form.observer = existing[0]?.observer ?? ''
  dialogVisible.value = true
}

function openEdit(belt: Belt): void {
  editingId.value = belt.id
  form.no = belt.no
  form.lengthM = belt.lengthM
  form.orientation = belt.orientation
  form.surveyDate = belt.surveyDate
  form.observer = belt.observer
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!form.no.trim()) {
    ElMessage.warning('请填写样带编号')
    return
  }
  if (!Number.isFinite(form.lengthM) || form.lengthM <= 0) {
    ElMessage.warning('样带长度应为大于 0 的数字（m）')
    return
  }
  if (!form.surveyDate) {
    ElMessage.warning('请选择调查日期')
    return
  }
  const duplicated = beltStore
    .beltsOfSite(siteId.value)
    .some((belt) => belt.no === form.no.trim() && belt.orientation === form.orientation && belt.id !== editingId.value)
  if (duplicated) {
    ElMessage.warning(`同一朝向（${form.orientation}）下样带编号「${form.no.trim()}」已存在`)
    return
  }
  submitting.value = true
  try {
    const payload = {
      no: form.no.trim(),
      lengthM: form.lengthM,
      orientation: form.orientation,
      surveyDate: form.surveyDate,
      observer: form.observer.trim()
    }
    if (editingId.value) {
      await beltStore.updateBelt(editingId.value, payload)
      ElMessage.success('样带已更新')
    } else {
      const created = await beltStore.createBelt(siteId.value, payload)
      beltStore.selectBelt(created.id)
      ElMessage.success(`样带 ${created.no}（${created.orientation}向 ${created.lengthM} m）已布设，可录入底质与珊瑚计数`)
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeBelt(belt: Belt): Promise<void> {
  const counts = surveyStore.beltRecordCounts[belt.id] ?? { coralCount: 0, fishCount: 0 }
  try {
    await ElMessageBox.confirm(
      `删除样带「${belt.no}」将同时删除其 ${counts.coralCount} 条珊瑚记录与 ${counts.fishCount} 条计数记录，确认删除？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await beltStore.removeBelt(belt.id)
  ElMessage.success('样带及其记录已删除')
}

async function applyOrientationOrder(): Promise<void> {
  const belts = beltStore.beltsOfSite(siteId.value)
  if (belts.length === 0) {
    ElMessage.warning('当前站位还没有样带')
    return
  }
  const ordered = [...belts].sort(
    (a, b) => ORIENTATION_ORDER[a.orientation] - ORIENTATION_ORDER[b.orientation]
  )
  ElMessage.success(
    `朝向排序校验通过：${ordered.map((belt) => `${belt.orientation}向 ${belt.no}`).join(' → ')}`
  )
}

function gotoCorals(belt: Belt): void {
  beltStore.selectBelt(belt.id)
  void router.push(`/belts/${belt.id}/corals`)
}

function gotoFishes(belt: Belt): void {
  beltStore.selectBelt(belt.id)
  void router.push(`/belts/${belt.id}/fishes`)
}

onMounted(() => {
  if (reefStore.reefs.length === 0) void initDatabase()
  if (site.value) reefStore.selectSite(site.value.id)
})
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <el-skeleton v-if="!reefStore.ready" :rows="5" animated />

    <RouteMissingPanel
      v-else-if="!site"
      entity-label="站位"
      :missing-id="siteId"
      fallback-path="/reefs"
      fallback-text="返回礁区台账"
      :candidates="
        reefStore.sites.slice(0, 3).map((item) => ({
          id: item.id,
          label: `站位 ${item.no} 的样带`,
          path: `/sites/${item.id}/belts`
        }))
      "
    />

    <template v-else>
      <div class="page__head">
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/reefs' }">礁区台账</el-breadcrumb-item>
            <el-breadcrumb-item v-if="reef" :to="{ path: `/reefs/${reef.id}/sites` }">{{ reef.name }} 站位</el-breadcrumb-item>
            <el-breadcrumb-item>样带布设</el-breadcrumb-item>
          </el-breadcrumb>
          <h2 class="page__title">
            站位 {{ site.no }} · 样带布设
            <el-tag size="small" effect="plain">水深 {{ site.depthM }} m</el-tag>
            <el-tag size="small" type="info" effect="plain">{{ site.substrate }}</el-tag>
          </h2>
          <p class="gb-hint">
            布设样带后录入长度、朝向与调查日期；同朝向内样带编号不可重复，列表按北 → 东 → 南 → 西排序。
          </p>
        </div>
        <div class="page__actions">
          <el-button :icon="Warning" @click="applyOrientationOrder">朝向排序校验</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增样带</el-button>
        </div>
      </div>

      <div class="gb-stats-row">
        <StatBadge label="样带条数" :value="stats.beltCount" suffix="条" icon="Files" />
        <StatBadge label="累计长度" :value="stats.totalLength" suffix="m" tone="info" icon="Odometer" />
        <StatBadge label="珊瑚记录" :value="stats.coralCount" suffix="条" tone="success" icon="Histogram" />
        <StatBadge label="计数记录" :value="stats.fishCount" suffix="条" tone="warning" icon="DataLine" />
      </div>

      <el-alert
        v-if="conflicts.length > 0"
        type="warning"
        show-icon
        :closable="false"
        :title="`朝向排序校验提示：${conflicts.join('、')} 存在重复编号，请调整后再开展普查`"
      />

      <EmptyPanel
        v-if="rows.length === 0"
        title="该站位还没有样带"
        description="新增第一条样带并录入长度与朝向，随后即可录入底质、珊瑚分类覆盖与鱼类计数。"
        action-text="新增样带"
        @action="openCreate"
      />

      <el-table v-else :data="rows" border stripe class="gb-table-compact">
        <el-table-column prop="belt.no" label="样带编号" width="110" />
        <el-table-column label="朝向" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.belt.orientation }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="长度 (m)" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.belt.lengthM }}</span>
          </template>
        </el-table-column>
        <el-table-column label="调查日期" width="130">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.belt.surveyDate }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="belt.observer" label="调查人" width="110" />
        <el-table-column label="珊瑚记录" width="120" align="center">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="gotoCorals(row.belt)">
              {{ row.coralCount }} 条
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="鱼类计数" width="120" align="center">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="gotoFishes(row.belt)">
              {{ row.fishCount }} 条
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="珊瑚覆盖率" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coveragePct }}%</span>
            <div class="gb-hint gb-mono">{{ row.coverCmTotal }} cm</div>
          </template>
        </el-table-column>
        <el-table-column label="白化" width="150">
          <template #default="{ row }">
            <BleachTag :level="row.grade" size="small" />
            <div class="gb-hint gb-mono">指数 {{ row.bleachIndex }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" :icon="Right" @click="gotoCorals(row.belt)">珊瑚</el-button>
            <el-button size="small" @click="gotoFishes(row.belt)">鱼类</el-button>
            <el-button size="small" :icon="Edit" @click="openEdit(row.belt)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="removeBelt(row.belt)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyPanel title="暂无样带" description="点击右上角「新增样带」开始布设。" compact />
        </template>
      </el-table>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑样带' : '布设样带'" width="540px" :close-on-click-modal="false">
      <el-form label-width="104px">
        <el-form-item label="样带编号" required>
          <el-input v-model="form.no" placeholder="如：T-01" maxlength="24" />
        </el-form-item>
        <el-form-item label="长度" required>
          <el-input-number v-model="form.lengthM" :min="1" :max="1000" :step="1" controls-position="right" />
          <span class="page__unit">m</span>
          <div class="page__presets">
            <el-button
              v-for="preset in BELT_LENGTH_PRESETS"
              :key="preset"
              size="small"
              text
              type="primary"
              @click="form.lengthM = preset"
            >
              {{ preset }} m
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="朝向" required>
          <el-radio-group v-model="form.orientation">
            <el-radio-button v-for="item in ORIENTATIONS" :key="item" :value="item">{{ item }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="调查日期" required>
          <el-date-picker v-model="form.surveyDate" type="date" value-format="YYYY-MM-DD" placeholder="选择调查日期" />
        </el-form-item>
        <el-form-item label="调查人">
          <el-input v-model="form.observer" placeholder="如：林之遥" maxlength="20" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '布设并录入记录' }}
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

.page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page__unit {
  margin-left: 8px;
  font-size: 12px;
  color: #7c9995;
}

.page__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 4px;
}
</style>
