<script setup lang="ts">
/**
 * 模块 6：/coverage 白化等级评定与覆盖度汇总
 * 汇总各样带的珊瑚覆盖率、白化指数与鱼类密度；查看结构版本并导入导出全量 JSON。
 * 复用 <BleachTag>、<FilterBar>。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { Download, Refresh, Upload } from '@element-plus/icons-vue'
import FilterBar from '@/components/common/FilterBar.vue'
import type { FilterModel } from '@/types/filter'
import { buildQuery, queryToArray, queryToBool } from '@/types/filter'
import BleachTag from '@/components/common/BleachTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import { useReefStore } from '@/stores/reefStore'
import { useSurveyStore } from '@/stores/surveyStore'
import { BLEACH_LEVELS } from '@/types/coralRecord'
import type { BleachLevel } from '@/types/coralRecord'
import { BLEACH_COLOR } from '@/utils/bleach'
import {
  DB_NAME,
  DB_VERSION,
  countAll,
  readLastBackupAt,
  readStampedDbVersion,
  resetDatabase,
  type BackupPayload
} from '@/utils/db'
import {
  buildBackupPayload,
  buildReefSummaries,
  countPayload,
  exportBackupJson,
  importBackup,
  readFileText,
  remapIds,
  validateBackup,
  type CountMap
} from '@/utils/export'

const route = useRoute()
const router = useRouter()
const reefStore = useReefStore()
const surveyStore = useSurveyStore()

const EMPTY_COUNTS: CountMap = { reefs: 0, sites: 0, belts: 0, corals: 0, fishes: 0 }

const counts = ref<CountMap>(EMPTY_COUNTS)
const lastBackupAt = ref<string | null>(null)
const stampedVersion = ref<number>(DB_VERSION)
const reefSummaries = ref<ReturnType<typeof buildReefSummaries>>([])
const overwriteOnImport = ref(true)
const fileList = ref<UploadFile[]>([])
const busy = ref(false)
const notice = ref('')

const filterModel = computed<FilterModel>(() => ({
  keyword: surveyStore.filter.keyword,
  reefIds: surveyStore.filter.reefIds,
  bleachLevels: surveyStore.filter.bleachLevels
}))

const rows = computed(() => surveyStore.filteredCoverageRows)

const totals = computed(() => ({
  belts: rows.value.length,
  coralCount: rows.value.reduce((sum, row) => sum + row.coralCount, 0),
  coverCmTotal: rows.value.reduce((sum, row) => sum + row.coverCmTotal, 0),
  fishTotal: rows.value.reduce((sum, row) => sum + row.fishTotal, 0),
  avgCoveragePct:
    rows.value.length === 0
      ? 0
      : Number((rows.value.reduce((sum, row) => sum + row.coveragePct, 0) / rows.value.length).toFixed(2)),
  avgBleachIndex:
    rows.value.length === 0
      ? 0
      : Number((rows.value.reduce((sum, row) => sum + row.bleachIndex, 0) / rows.value.length).toFixed(2)),
  bleachedBelts: rows.value.filter((row) => row.bleachedSharePct > 0).length
}))

/** 当前筛选结果内的白化等级分布 */
const distribution = computed<Record<BleachLevel, number>>(() => {
  const result: Record<BleachLevel, number> = { 无: 0, 轻: 0, 中: 0, 重: 0, 死亡: 0 }
  BLEACH_LEVELS.forEach((level) => {
    result[level] = Number(rows.value.reduce((sum, row) => sum + row.distribution[level], 0).toFixed(1))
  })
  return result
})

const distributionTotal = computed(() =>
  BLEACH_LEVELS.reduce((sum, level) => sum + distribution.value[level], 0)
)

function barPercent(value: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%'
  return `${Math.min(100, (value / total) * 100).toFixed(1)}%`
}

async function refresh(): Promise<void> {
  counts.value = (await countAll()) as CountMap
  lastBackupAt.value = readLastBackupAt()
  stampedVersion.value = readStampedDbVersion()
  const payload = await buildBackupPayload()
  reefSummaries.value = buildReefSummaries(payload, surveyStore.coverageRows.map((row) => ({
    beltId: row.beltId,
    beltNo: row.beltNo,
    reefId: row.reefId,
    reefName: row.reefName,
    siteId: row.siteId,
    siteNo: row.siteNo,
    lengthM: row.lengthM,
    orientation: row.orientation,
    surveyDate: row.surveyDate,
    observer: row.observer,
    coralCount: row.coralCount,
    coverCmTotal: row.coverCmTotal,
    coveragePct: row.coveragePct,
    bleachIndex: row.bleachIndex,
    grade: row.grade,
    bleachedSharePct: row.bleachedSharePct,
    distribution: row.distribution,
    fishTotal: row.fishTotal,
    invertebrateTotal: row.invertebrateTotal,
    fishDensity: row.fishDensity,
    conclusion: ''
  })))
}

function handleFilterChange(): void {
  void router.replace({
    query: buildQuery({
      kw: surveyStore.filter.keyword,
      reef: surveyStore.filter.reefIds,
      level: surveyStore.filter.bleachLevels,
      bleached: surveyStore.filter.onlyBleached
    })
  })
}

function handleReset(): void {
  surveyStore.resetFilter()
  void router.replace({ query: {} })
}

async function handleExport(): Promise<void> {
  busy.value = true
  try {
    const result = await exportBackupJson()
    await refresh()
    notice.value = `已导出 ${result.fileName}（共 ${Object.values(result.counts).reduce((sum, value) => sum + value, 0)} 条记录）。`
    ElMessage.success(notice.value)
  } finally {
    busy.value = false
  }
}

async function handleImport(): Promise<void> {
  const file = fileList.value[0]?.raw
  if (!file) {
    ElMessage.warning('请先选择备份 JSON 文件')
    return
  }
  busy.value = true
  try {
    const text = await readFileText(file)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      ElMessage.error('文件不是合法的 JSON，无法解析')
      return
    }
    const validation = validateBackup(parsed)
    if (!validation.ok || !validation.payload) {
      ElMessage.error(`备份校验失败：${validation.errors.join('；')}`)
      return
    }
    const payload: BackupPayload = overwriteOnImport.value ? validation.payload : remapIds(validation.payload)
    const summary = countPayload(payload)
    await ElMessageBox.confirm(
      `将导入 ${Object.entries(summary)
        .map(([key, value]) => `${key} ${value} 条`)
        .join('、')}；${overwriteOnImport.value ? '覆盖模式会先清空现有本地数据' : '追加模式会重新分配 id 保留现有数据'}。确认继续？`,
      '导入确认',
      { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' }
    )
    await importBackup(payload, overwriteOnImport.value)
    await refresh()
    notice.value = '导入完成，覆盖度汇总已刷新。'
    ElMessage.success(notice.value)
  } finally {
    busy.value = false
    fileList.value = []
  }
}

async function handleDatabaseReset(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将清空全部本地数据并重新播种演示数据（礁区、站位、样带、珊瑚记录、鱼类计数）。确认继续？',
      '重置本地数据',
      { type: 'warning', confirmButtonText: '清空并重建', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await resetDatabase()
  await refresh()
  notice.value = '本地数据已重置为演示数据。'
  ElMessage.success(notice.value)
}

async function copySummary(): Promise<void> {
  const text = rows.value
    .map(
      (row) =>
        `${row.reefName}｜站位 ${row.siteNo}｜样带 ${row.beltNo}（${row.orientation}向 ${row.lengthM} m）：珊瑚覆盖率 ${row.coveragePct}%，白化指数 ${row.bleachIndex}（${row.grade}），白化占比 ${row.bleachedSharePct}%，鱼类 ${row.fishTotal} 尾（${row.fishDensity} 尾/100m²）`
    )
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    notice.value = '覆盖度结论已复制到剪贴板。'
    ElMessage.success(notice.value)
  } catch {
    notice.value = '当前浏览器不允许读取剪贴板，请手动选中表格内容复制。'
    ElMessage.warning(notice.value)
  }
}

onMounted(() => {
  surveyStore.patchFilter({
    keyword: typeof route.query.kw === 'string' ? route.query.kw : '',
    reefIds: queryToArray(route.query.reef),
    bleachLevels: queryToArray(route.query.level) as BleachLevel[],
    onlyBleached: queryToBool(route.query.bleached)
  })
  void refresh()
})
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <div class="page__head">
      <div>
        <h2 class="page__title">白化等级评定与覆盖度汇总</h2>
        <p class="gb-hint">
          按样带汇总珊瑚覆盖率、白化指数（按覆盖长度加权，0 ~ 4）与鱼类密度，并可按礁区、白化等级筛选；同时提供结构版本查看与 JSON 导入导出。
        </p>
      </div>
      <div class="page__actions">
        <el-button :icon="Refresh" @click="refresh">刷新</el-button>
        <el-button @click="copySummary">复制结论</el-button>
        <el-button type="primary" :icon="Download" :loading="busy" @click="handleExport">导出 JSON</el-button>
      </div>
    </div>

    <el-alert v-if="notice" type="success" :closable="false" show-icon :title="notice" />

    <div class="gb-stats-row">
      <StatBadge label="样带数" :value="totals.belts" suffix="条" icon="Files" />
      <StatBadge label="珊瑚记录" :value="totals.coralCount" suffix="条" tone="info" icon="Histogram" />
      <StatBadge label="覆盖长度合计" :value="totals.coverCmTotal" suffix="cm" tone="success" icon="Odometer" />
      <StatBadge label="平均覆盖率" :value="totals.avgCoveragePct" suffix="%" :percent="Math.min(100, totals.avgCoveragePct)" icon="PieChart" />
      <StatBadge
        label="平均白化指数"
        :value="totals.avgBleachIndex"
        suffix="/ 4"
        :tone="totals.avgBleachIndex > 1 ? 'warning' : 'success'"
        :icon="totals.avgBleachIndex > 1 ? 'WarningFilled' : 'DataLine'"
      />
      <StatBadge label="鱼类合计" :value="totals.fishTotal" suffix="尾" tone="warning" icon="TrendCharts" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="[
        {
          key: 'reefIds',
          label: '礁区',
          options: reefStore.reefs.map((reef) => ({ label: reef.name, value: reef.id }))
        },
        {
          key: 'bleachLevels',
          label: '白化等级',
          options: BLEACH_LEVELS.map((level) => ({ label: level, value: level }))
        }
      ]"
      :has-switch="true"
      switch-label="仅看存在白化的样带"
      :switch-value="surveyStore.filter.onlyBleached"
      keyword-placeholder="搜索礁区 / 站位 / 样带 / 调查人"
      @change="handleFilterChange"
      @reset="handleReset"
    />

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>白化等级分布（覆盖长度 cm）</h3>
        <span class="gb-hint">
          总体白化指数 {{ surveyStore.globalStats.bleachIndex }}（{{ surveyStore.globalStats.grade }}）· 白化占比
          {{ surveyStore.globalStats.bleachedSharePct }}% · 存在白化样带 {{ totals.bleachedBelts }} 条
        </span>
      </div>
      <div class="gb-bars">
        <div v-for="level in BLEACH_LEVELS" :key="`dist-${level}`" class="gb-bar">
          <span>{{ level }}</span>
          <span class="gb-bar__track">
            <span
              class="gb-bar__fill"
              :style="{ background: BLEACH_COLOR[level], width: barPercent(distribution[level], distributionTotal) }"
            ></span>
          </span>
          <span class="gb-mono">{{ distribution[level] }} cm</span>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>按样带的覆盖度成果（{{ rows.length }} 条）</h3>
        <span class="gb-hint">按白化指数降序排列</span>
      </div>

      <EmptyPanel
        v-if="rows.length === 0"
        title="没有符合条件的样带"
        description="请先到礁区台账布设站位与样带，并录入珊瑚分类覆盖与鱼类计数；也可调整当前筛选条件。"
        compact
      />

      <el-table v-else :data="rows" border stripe class="gb-table-compact">
        <el-table-column label="礁区 / 站位" min-width="180">
          <template #default="{ row }">
            <div>{{ row.reefName }}</div>
            <div class="gb-hint">站位 {{ row.siteNo }} · 样带 {{ row.beltNo }}（{{ row.orientation }}向）</div>
          </template>
        </el-table-column>
        <el-table-column label="样带长度" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.lengthM }} m</span>
          </template>
        </el-table-column>
        <el-table-column label="珊瑚记录" width="100" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coralCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="覆盖率" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coveragePct }}%</span>
            <div class="gb-hint gb-mono">{{ row.coverCmTotal }} cm</div>
          </template>
        </el-table-column>
        <el-table-column label="白化评定" width="170">
          <template #default="{ row }">
            <BleachTag :level="row.grade" size="small" />
            <div class="gb-hint gb-mono">指数 {{ row.bleachIndex }} · 白化占比 {{ row.bleachedSharePct }}%</div>
          </template>
        </el-table-column>
        <el-table-column label="白化等级分布 (cm)" min-width="220">
          <template #default="{ row }">
            <div class="page__mini-bars">
              <span
                v-for="level in BLEACH_LEVELS"
                :key="`${row.beltId}-${level}`"
                class="page__mini-bar"
                :style="{
                  background: BLEACH_COLOR[level],
                  width: barPercent(row.distribution[level], row.coverCmTotal),
                  opacity: row.distribution[level] > 0 ? 1 : 0.15
                }"
                :title="`${level}：${row.distribution[level]} cm`"
              ></span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="鱼类" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.fishTotal }} 尾</span>
            <div class="gb-hint gb-mono">{{ row.fishDensity }} 尾/100m²</div>
          </template>
        </el-table-column>
        <el-table-column label="无脊椎动物" width="120" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.invertebrateTotal }} 个</span>
          </template>
        </el-table-column>
        <el-table-column label="调查" min-width="150">
          <template #default="{ row }">
            <div class="gb-mono">{{ row.surveyDate }}</div>
            <div class="gb-hint">{{ row.observer || '未填写调查人' }}</div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>按礁区的白化评定</h3>
        <span class="gb-hint">平均白化指数为礁区内各样带白化指数的算术平均</span>
      </div>
      <el-table :data="reefSummaries" border stripe class="gb-table-compact">
        <el-table-column prop="reefName" label="礁区" min-width="160" />
        <el-table-column prop="protectStatus" label="保护区状态" width="130" />
        <el-table-column label="站位 / 样带" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.siteCount }} / {{ row.beltCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="珊瑚记录" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coralCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="覆盖长度" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.coverCmTotal }} cm</span>
          </template>
        </el-table-column>
        <el-table-column label="平均白化指数" width="160">
          <template #default="{ row }">
            <BleachTag :level="row.grade" size="small" />
            <span class="gb-hint gb-mono"> {{ row.avgBleachIndex }}</span>
          </template>
        </el-table-column>
        <el-table-column label="鱼类计数" width="120" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.fishTotal }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>结构版本与全量 JSON 导入导出</h3>
        <span class="gb-hint">
          导出内容包含 reefs / sites / belts / corals / fishes 五张表 · 最近备份
          {{ lastBackupAt ? new Date(lastBackupAt).toLocaleString('zh-CN') : '尚未备份' }}
        </span>
      </div>

      <el-form label-width="120px">
        <el-form-item label="导入模式">
          <el-radio-group v-model="overwriteOnImport">
            <el-radio :value="true">覆盖（先清空本地数据）</el-radio>
            <el-radio :value="false">追加（重新分配 id）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择备份文件">
          <el-upload
            v-model:file-list="fileList"
            :auto-upload="false"
            :limit="1"
            accept="application/json"
            :on-exceed="() => ElMessage.warning('一次只能选择一个文件')"
          >
            <el-button :icon="Upload">选择 JSON 文件</el-button>
            <template #tip>
              <div class="gb-hint">仅支持本应用导出的备份文件（app 字段为 gbcoralbelt）</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Upload" :loading="busy" @click="handleImport">开始导入</el-button>
          <el-button :icon="Download" @click="handleExport">导出当前数据</el-button>
          <el-button type="danger" plain @click="handleDatabaseReset">清空并重建演示数据</el-button>
        </el-form-item>
      </el-form>

      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="本地库名">{{ DB_NAME }}</el-descriptions-item>
        <el-descriptions-item label="结构版本">v{{ DB_VERSION }}（浏览器记录 v{{ stampedVersion }}）</el-descriptions-item>
        <el-descriptions-item label="礁区 / 站位">{{ counts.reefs }} / {{ counts.sites }}</el-descriptions-item>
        <el-descriptions-item label="样带 / 珊瑚记录">{{ counts.belts }} / {{ counts.corals }}</el-descriptions-item>
        <el-descriptions-item label="鱼类计数">{{ counts.fishes }}</el-descriptions-item>
        <el-descriptions-item label="最近备份时间">
          {{ lastBackupAt ? new Date(lastBackupAt).toLocaleString('zh-CN') : '尚未备份' }}
        </el-descriptions-item>
      </el-descriptions>
      <p class="gb-hint">
        数据仅保存在当前浏览器 IndexedDB 中，换浏览器或清空站点数据后不会自动跟随，请通过 JSON 备份迁移。
      </p>
    </el-card>
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

.page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page__mini-bars {
  display: flex;
  gap: 2px;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: #eef7f6;
}

.page__mini-bar {
  display: block;
  height: 100%;
}
</style>
