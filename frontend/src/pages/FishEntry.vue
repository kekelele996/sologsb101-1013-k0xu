<script setup lang="ts">
/**
 * 模块 5：/belts/:id/fishes 鱼类与无脊椎动物计数
 * 按科名与体长段汇总并折算密度；支持批量粘贴与批量改类别，
 * 深链访问时样带不存在给出友好空态。复用 <StatBadge>、<EmptyPanel>。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DocumentCopy, Edit, Plus } from '@element-plus/icons-vue'
import StatBadge from '@/components/common/StatBadge.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import RouteMissingPanel from '@/components/common/RouteMissingPanel.vue'
import { useReefStore } from '@/stores/reefStore'
import { useBeltStore } from '@/stores/beltStore'
import { useSurveyStore } from '@/stores/surveyStore'
import {
  COMMON_FAMILIES,
  COUNT_CATEGORIES,
  parseFishPaste,
  SIZE_CLASSES
} from '@/types/fishCount'
import type { CountCategory, FishCount, SizeClass } from '@/types/fishCount'
import { fishDensity } from '@/utils/bleach'
import { initDatabase } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const reefStore = useReefStore()
const beltStore = useBeltStore()
const surveyStore = useSurveyStore()

const beltId = computed(() => String(route.params.id ?? ''))
const belt = computed(() => beltStore.beltById(beltId.value))
const site = computed(() => (belt.value ? reefStore.siteById(belt.value.siteId) : null))
const reef = computed(() => (site.value ? reefStore.reefById(site.value.reefId) : null))

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const pasteVisible = ref(false)
const pasteText = ref('')
const pasteErrors = ref<string[]>([])
const selectedIds = ref<string[]>([])
const categoryFilter = ref<CountCategory | '全部'>('全部')
const form = reactive({
  family: '',
  count: 1,
  sizeClass: '11-20cm' as SizeClass,
  category: '鱼类' as CountCategory
})

const records = computed(() => {
  const list = surveyStore.fishesOfBelt(beltId.value)
  if (categoryFilter.value === '全部') return list
  return list.filter((record) => record.category === categoryFilter.value)
})

/** 按科名 + 体长段汇总 */
const summary = computed(() => surveyStore.fishSummaryOfBelt(beltId.value))

/** 按体长段汇总（鱼类与无脊椎动物合计） */
const sizeSummary = computed(() =>
  SIZE_CLASSES.map((sizeClass) => {
    const list = surveyStore.fishesOfBelt(beltId.value).filter((record) => record.sizeClass === sizeClass)
    return {
      sizeClass,
      count: list.reduce((sum, record) => sum + record.count, 0),
      species: list.length
    }
  })
)

const stats = computed(() => {
  const list = surveyStore.fishesOfBelt(beltId.value)
  const fishTotal = list.filter((record) => record.category === '鱼类').reduce((sum, record) => sum + record.count, 0)
  const invertebrateTotal = list
    .filter((record) => record.category === '无脊椎动物')
    .reduce((sum, record) => sum + record.count, 0)
  const lengthM = belt.value?.lengthM ?? 0
  return {
    recordCount: list.length,
    fishTotal,
    invertebrateTotal,
    total: fishTotal + invertebrateTotal,
    fishDensity: fishDensity(fishTotal, lengthM),
    invertebrateDensity: fishDensity(invertebrateTotal, lengthM),
    familyCount: new Set(list.map((record) => record.family)).size
  }
})

function openCreate(): void {
  editingId.value = null
  form.family = ''
  form.count = 1
  form.sizeClass = '11-20cm'
  form.category = categoryFilter.value === '全部' ? '鱼类' : categoryFilter.value
  dialogVisible.value = true
}

function openEdit(record: FishCount): void {
  editingId.value = record.id
  form.family = record.family
  form.count = record.count
  form.sizeClass = record.sizeClass
  form.category = record.category
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!form.family.trim()) {
    ElMessage.warning('请填写科名')
    return
  }
  if (!Number.isInteger(form.count) || form.count < 0) {
    ElMessage.warning('数量应为非负整数')
    return
  }
  submitting.value = true
  try {
    const payload = {
      family: form.family.trim(),
      count: form.count,
      sizeClass: form.sizeClass,
      category: form.category
    }
    if (editingId.value) {
      await surveyStore.updateFish(editingId.value, payload)
      ElMessage.success('计数记录已更新')
    } else {
      await surveyStore.createFish(beltId.value, payload)
      ElMessage.success('计数记录已新增，密度已重算')
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeRecord(record: FishCount): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除「${record.family}（${record.sizeClass}）」${record.count} 的计数记录？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  await surveyStore.removeFish(record.id)
  selectedIds.value = selectedIds.value.filter((id) => id !== record.id)
  ElMessage.success('计数记录已删除')
}

function toggleSelect(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function toggleSelectAll(): void {
  selectedIds.value =
    selectedIds.value.length === records.value.length ? [] : records.value.map((record) => record.id)
}

async function bulkSetCategory(category: CountCategory): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要批量改类别的记录')
    return
  }
  const now = Date.now()
  await Promise.all(
    selectedIds.value.map((id) => surveyStore.updateFish(id, { category, updatedAt: now } as never))
  )
  ElMessage.success(`已批量将 ${selectedIds.value.length} 条记录改为「${category}」`)
  selectedIds.value = []
}

function openPaste(): void {
  pasteText.value = ''
  pasteErrors.value = []
  pasteVisible.value = true
}

function previewPaste(): void {
  const parsed = parseFishPaste(pasteText.value)
  pasteErrors.value = parsed.errors
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    ElMessage.warning('请先粘贴内容，每行格式「科名,数量,体长段[,类别]」')
  }
}

async function importPaste(): Promise<void> {
  const parsed = parseFishPaste(pasteText.value)
  pasteErrors.value = parsed.errors
  if (parsed.rows.length === 0) {
    ElMessage.warning('没有可导入的有效行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将用 ${parsed.rows.length} 行数据覆盖该样带现有 ${surveyStore.fishesOfBelt(beltId.value).length} 条计数记录，确认导入？`,
      '批量导入确认',
      { type: 'warning', confirmButtonText: '覆盖导入', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const count = await surveyStore.importFishRows(beltId.value, parsed.rows)
  pasteVisible.value = false
  ElMessage.success(`已导入 ${count} 条计数记录`)
}

function barPercent(value: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%'
  return `${Math.min(100, (value / total) * 100).toFixed(1)}%`
}

function gotoCoral(): void {
  void router.push(`/belts/${beltId.value}/corals`)
}

onMounted(() => {
  if (reefStore.reefs.length === 0) void initDatabase()
  if (belt.value) beltStore.selectBelt(belt.value.id)
})
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <el-skeleton v-if="!beltStore.ready" :rows="5" animated />

    <RouteMissingPanel
      v-else-if="!belt"
      entity-label="样带"
      :missing-id="beltId"
      fallback-path="/reefs"
      fallback-text="返回礁区台账"
      :candidates="
        beltStore.belts.slice(0, 3).map((item) => ({
          id: item.id,
          label: `样带 ${item.no} 的鱼类计数`,
          path: `/belts/${item.id}/fishes`
        }))
      "
    />

    <template v-else>
      <div class="page__head">
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/reefs' }">礁区台账</el-breadcrumb-item>
            <el-breadcrumb-item v-if="reef" :to="{ path: `/reefs/${reef.id}/sites` }">{{ reef.name }} 站位</el-breadcrumb-item>
            <el-breadcrumb-item v-if="site" :to="{ path: `/sites/${site.id}/belts` }">站位 {{ site.no }} 样带</el-breadcrumb-item>
            <el-breadcrumb-item>鱼类与无脊椎动物计数</el-breadcrumb-item>
          </el-breadcrumb>
          <h2 class="page__title">
            样带 {{ belt.no }} · 鱼类与无脊椎动物计数
            <el-tag size="small" effect="plain">{{ belt.orientation }}向</el-tag>
            <el-tag size="small" type="info" effect="plain">长 {{ belt.lengthM }} m × 宽 1 m</el-tag>
          </h2>
          <p class="gb-hint">
            按科名与体长段逐条录入数量，密度按「尾 / 100 m²」折算（样带宽度按 1 m 计）；可按类别筛选与批量改判。
          </p>
        </div>
        <div class="page__actions">
          <el-button :icon="DocumentCopy" @click="openPaste">批量粘贴</el-button>
          <el-button @click="gotoCoral">← 珊瑚计数</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增计数记录</el-button>
        </div>
      </div>

      <div class="gb-stats-row">
        <StatBadge label="计数记录" :value="stats.recordCount" suffix="条" icon="DataLine" />
        <StatBadge label="鱼类合计" :value="stats.fishTotal" suffix="尾" tone="info" icon="Histogram" />
        <StatBadge label="无脊椎动物" :value="stats.invertebrateTotal" suffix="个" tone="warning" icon="PieChart" />
        <StatBadge label="鱼类密度" :value="stats.fishDensity" suffix="尾/100m²" tone="success" icon="TrendCharts" />
        <StatBadge label="科名数" :value="stats.familyCount" suffix="科" tone="default" icon="Files" />
      </div>

      <el-card v-if="stats.recordCount > 0" shadow="never" class="gb-panel">
        <div class="gb-panel-title">
          <h3>汇总视图</h3>
          <div class="page__bulk">
            <span class="gb-hint">批量改类别：</span>
            <el-button v-for="category in COUNT_CATEGORIES" :key="category" size="small" @click="bulkSetCategory(category)">
              {{ category }}
            </el-button>
          </div>
        </div>
        <div class="page__grid">
          <div>
            <h4 class="page__sub">按体长段汇总</h4>
            <div class="gb-bars">
              <div v-for="item in sizeSummary" :key="item.sizeClass" class="gb-bar">
                <span>{{ item.sizeClass }}</span>
                <span class="gb-bar__track">
                  <span
                    class="gb-bar__fill"
                    :style="{ background: '#3f9ec4', width: barPercent(item.count, stats.total) }"
                  ></span>
                </span>
                <span class="gb-mono">{{ item.count }} 尾 · {{ item.species }} 条记录</span>
              </div>
            </div>
          </div>
          <div>
            <h4 class="page__sub">按科名汇总（含体长段明细）</h4>
            <el-table :data="summary" border size="small" class="gb-table-compact">
              <el-table-column prop="family" label="科名" min-width="120" />
              <el-table-column prop="category" label="类别" width="110" />
              <el-table-column label="0-10cm" width="90" align="right">
                <template #default="{ row }">
                  <span class="gb-mono">{{ row.bySize['0-10cm'] }}</span>
                </template>
              </el-table-column>
              <el-table-column label="11-20cm" width="90" align="right">
                <template #default="{ row }">
                  <span class="gb-mono">{{ row.bySize['11-20cm'] }}</span>
                </template>
              </el-table-column>
              <el-table-column label="21-30cm" width="90" align="right">
                <template #default="{ row }">
                  <span class="gb-mono">{{ row.bySize['21-30cm'] }}</span>
                </template>
              </el-table-column>
              <el-table-column label="&gt;30cm" width="90" align="right">
                <template #default="{ row }">
                  <span class="gb-mono">{{ row.bySize['>30cm'] }}</span>
                </template>
              </el-table-column>
              <el-table-column label="合计" width="90" align="right">
                <template #default="{ row }">
                  <span class="gb-mono">{{ row.total }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-card>

      <div class="page__filter">
        <span class="gb-hint">类别筛选：</span>
        <el-radio-group v-model="categoryFilter" size="small">
          <el-radio-button value="全部">全部</el-radio-button>
          <el-radio-button v-for="category in COUNT_CATEGORIES" :key="category" :value="category">{{ category }}</el-radio-button>
        </el-radio-group>
        <el-button size="small" text type="primary" @click="toggleSelectAll">
          {{ selectedIds.length === records.length && records.length > 0 ? '取消全选' : '全选本页' }}
        </el-button>
        <span class="gb-hint">已选 {{ selectedIds.length }} 条</span>
      </div>

      <EmptyPanel
        v-if="records.length === 0"
        title="该样带还没有计数记录"
        description="按科名与体长段逐条录入鱼类与无脊椎动物数量；也可以批量粘贴导入整段摸底数据。"
        action-text="新增计数记录"
        secondary-text="批量粘贴导入"
        @action="openCreate"
        @secondary="openPaste"
      />

      <el-table v-else :data="records" border stripe class="gb-table-compact">
        <el-table-column label="选择" width="70" align="center">
          <template #default="{ row }">
            <el-checkbox :model-value="selectedIds.includes(row.id)" @change="() => toggleSelect(row.id)" />
          </template>
        </el-table-column>
        <el-table-column prop="family" label="科名" min-width="140" />
        <el-table-column label="类别" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.category === '鱼类' ? 'primary' : 'warning'" effect="plain">
              {{ row.category }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sizeClass" label="体长段" width="120" />
        <el-table-column label="数量" width="100" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="折算密度" width="150" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ fishDensity(row.count, belt.lengthM) }} 尾/100m²</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="removeRecord(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyPanel title="暂无计数记录" description="点击右上角「新增计数记录」开始录入。" compact />
        </template>
      </el-table>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑计数记录' : '新增计数记录'" width="540px" :close-on-click-modal="false">
      <el-form label-width="104px">
        <el-form-item label="类别" required>
          <el-radio-group v-model="form.category">
            <el-radio-button v-for="category in COUNT_CATEGORIES" :key="category" :value="category">{{ category }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="科名" required>
          <el-input v-model="form.family" list="family-options" placeholder="如：雀鲷科" maxlength="30" />
          <datalist id="family-options">
            <option v-for="family in COMMON_FAMILIES[form.category]" :key="family" :value="family"></option>
          </datalist>
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.count" :min="0" :max="100000" controls-position="right" />
          <span class="page__unit">{{ form.category === '鱼类' ? '尾' : '个' }}</span>
        </el-form-item>
        <el-form-item label="体长段" required>
          <el-radio-group v-model="form.sizeClass">
            <el-radio-button v-for="item in SIZE_CLASSES" :key="item" :value="item">{{ item }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '新增记录' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pasteVisible" title="批量粘贴导入计数记录" width="620px">
      <p class="gb-hint">
        每行一条，格式「科名,数量,体长段[,类别]」，逗号 / 制表符 / 分号均可。示例：<br />
        <span class="gb-mono">雀鲷科,46,0-10cm,鱼类</span><br />
        <span class="gb-mono">海胆科;12;0-10cm;无脊椎动物</span><br />
        <span class="gb-mono">鹦嘴鱼科,7,21-30cm</span>
      </p>
      <el-input v-model="pasteText" type="textarea" :rows="8" placeholder="雀鲷科,46,0-10cm,鱼类" />
      <div v-if="pasteErrors.length > 0" class="page__errors">
        <el-alert v-for="(error, index) in pasteErrors" :key="index" type="warning" :title="error" :closable="false" show-icon />
      </div>
      <template #footer>
        <el-button @click="pasteVisible = false">取消</el-button>
        <el-button @click="previewPaste">解析预览</el-button>
        <el-button type="primary" @click="importPaste">覆盖导入</el-button>
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

.page__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.page__sub {
  margin: 0 0 8px;
  font-size: 13px;
  color: #4c6663;
}

.page__bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.page__filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.page__unit {
  margin-left: 8px;
  font-size: 12px;
  color: #7c9995;
}

.page__errors {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  max-height: 160px;
  overflow: auto;
}
</style>
