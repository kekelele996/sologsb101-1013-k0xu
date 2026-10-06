/**
 * 普查 store：维护珊瑚与鱼类筛选条件、录入草稿与覆盖度派生值。
 * 覆盖 /belts/:id/corals、/belts/:id/fishes 与 /coverage 三页。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db, createId, watchTable } from '@/utils/db'
import type { BleachLevel, CoralForm, CoralRecord } from '@/types/coralRecord'
import type { CountCategory, FishCount, SizeClass } from '@/types/fishCount'
import type { Reef } from '@/types/reef'
import type { Site } from '@/types/site'
import type { Belt } from '@/types/belt'
import {
  aggregateBleach,
  bleachDistribution,
  bleachedSharePct,
  fishDensity,
  round,
  summarizeCoralCover
} from '@/utils/bleach'

/** 覆盖度汇总页筛选条件 */
export interface SurveyFilterState {
  keyword: string
  reefIds: string[]
  bleachLevels: BleachLevel[]
  /** 是否只看存在白化（轻 / 中 / 重）或死亡覆盖的样带 */
  onlyBleached: boolean
}

export function createEmptySurveyFilter(): SurveyFilterState {
  return {
    keyword: '',
    reefIds: [],
    bleachLevels: [],
    onlyBleached: false
  }
}

/** 覆盖度汇总行 */
export interface CoverageSummaryRow {
  beltId: string
  beltNo: string
  reefId: string
  reefName: string
  siteId: string
  siteNo: string
  lengthM: number
  orientation: string
  surveyDate: string
  observer: string
  coralCount: number
  /** 全部珊瑚覆盖长度合计（含死亡，cm） */
  coverCmTotal: number
  /** 活珊瑚覆盖长度（cm，无 / 轻 / 中 / 重） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 活珊瑚覆盖率（%，不含死亡） */
  liveCoveragePct: number
  /** 死亡覆盖率（%） */
  deadCoveragePct: number
  /** 白化指数 0 ~ 3；全死亡 / 无记录为 null */
  bleachIndex: number | null
  /** 总体白化等级；无记录为 null，全死亡为「死亡」 */
  grade: BleachLevel | null
  bleachedSharePct: number
  distribution: Record<BleachLevel, number>
  fishTotal: number
  invertebrateTotal: number
  fishDensity: number
}

export const useSurveyStore = defineStore('survey', () => {
  const corals = ref<CoralRecord[]>([])
  const fishes = ref<FishCount[]>([])
  const reefs = ref<Reef[]>([])
  const sites = ref<Site[]>([])
  const belts = ref<Belt[]>([])
  const ready = ref(false)
  const error = ref<string | null>(null)
  const filter = ref<SurveyFilterState>(createEmptySurveyFilter())
  /** 珊瑚录入草稿（跨页面保留） */
  const coralDraft = ref({
    genus: '',
    form: '枝状' as CoralForm,
    coverCm: 100,
    bleachLevel: '无' as BleachLevel,
    remark: ''
  })
  /** 鱼类计数草稿 */
  const fishDraft = ref({
    family: '',
    count: 1,
    sizeClass: '11-20cm' as SizeClass,
    category: '鱼类' as CountCategory
  })

  let started = false

  function start(): void {
    if (started) return
    started = true
    watchTable<CoralRecord>(() => db.corals).subscribe((rows) => {
      corals.value = rows
      ready.value = true
      error.value = null
    })
    watchTable<FishCount>(() => db.fishes).subscribe((rows) => {
      fishes.value = rows
    })
    watchTable<Reef>(() => db.reefs).subscribe((rows) => {
      reefs.value = rows
    })
    watchTable<Site>(() => db.sites).subscribe((rows) => {
      sites.value = rows
    })
    watchTable<Belt>(() => db.belts).subscribe((rows) => {
      belts.value = rows
    })
  }

  /** 某样带的珊瑚记录（按白化等级降序、覆盖长度降序） */
  function coralsOfBelt(beltId: string | null | undefined): CoralRecord[] {
    if (!beltId) return []
    const order: Record<BleachLevel, number> = { 无: 0, 轻: 1, 中: 2, 重: 3, 死亡: 4 }
    return corals.value
      .filter((coral) => coral.beltId === beltId)
      .sort((a, b) => {
        const diff = order[b.bleachLevel] - order[a.bleachLevel]
        if (diff !== 0) return diff
        return b.coverCm - a.coverCm
      })
  }

  /** 某样带的鱼类/无脊椎动物计数 */
  function fishesOfBelt(beltId: string | null | undefined): FishCount[] {
    if (!beltId) return []
    return fishes.value
      .filter((fish) => fish.beltId === beltId)
      .sort((a, b) => b.count - a.count)
  }

  /** 样带 id → 珊瑚记录数 / 鱼类记录数（样带列表回显用） */
  const beltRecordCounts = computed<Record<string, { coralCount: number; fishCount: number }>>(() => {
    const counts: Record<string, { coralCount: number; fishCount: number }> = {}
    belts.value.forEach((belt) => {
      counts[belt.id] = {
        coralCount: corals.value.filter((coral) => coral.beltId === belt.id).length,
        fishCount: fishes.value.filter((fish) => fish.beltId === belt.id).length
      }
    })
    return counts
  })

  /** 覆盖度汇总行（全部样带） */
  const coverageRows = computed<CoverageSummaryRow[]>(() =>
    belts.value
      .map((belt) => {
        const site = sites.value.find((item) => item.id === belt.siteId)
        const reef = site ? reefs.value.find((item) => item.id === site.reefId) : undefined
        const beltCorals = corals.value.filter((coral) => coral.beltId === belt.id)
        const beltFishes = fishes.value.filter((fish) => fish.beltId === belt.id)
        const summary = summarizeCoralCover(beltCorals, belt.lengthM)
        const fishTotal = beltFishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
        return {
          beltId: belt.id,
          beltNo: belt.no,
          reefId: reef?.id ?? '',
          reefName: reef?.name ?? '未知礁区',
          siteId: site?.id ?? '',
          siteNo: site?.no ?? '—',
          lengthM: belt.lengthM,
          orientation: belt.orientation,
          surveyDate: belt.surveyDate,
          observer: belt.observer,
          coralCount: summary.coralCount,
          coverCmTotal: summary.coverCmTotal,
          liveCoverCm: summary.liveCoverCm,
          deadCoverCm: summary.deadCoverCm,
          liveCoveragePct: summary.liveCoveragePct,
          deadCoveragePct: summary.deadCoveragePct,
          bleachIndex: summary.bleachIndex,
          grade: summary.grade,
          bleachedSharePct: summary.bleachedSharePct,
          distribution: summary.distribution,
          fishTotal,
          invertebrateTotal: beltFishes
            .filter((fish) => fish.category === '无脊椎动物')
            .reduce((sum, fish) => sum + fish.count, 0),
          fishDensity: fishDensity(fishTotal, belt.lengthM)
        }
      })
      .sort((a, b) => {
        // 全死亡样带优先标出，其次按白化指数降序，无珊瑚记录样带排末尾
        const score = (row: CoverageSummaryRow): number => {
          if (row.coralCount === 0) return -1
          if (row.bleachIndex === null) return 100
          return row.bleachIndex
        }
        return score(b) - score(a)
      })
  )

  /** 按筛选条件过滤后的覆盖度行 */
  const filteredCoverageRows = computed<CoverageSummaryRow[]>(() =>
    coverageRows.value.filter((row) => {
      const keyword = filter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${row.reefName}${row.siteNo}${row.beltNo}${row.observer}`
        if (!haystack.includes(keyword)) return false
      }
      if (filter.value.reefIds.length > 0 && !filter.value.reefIds.includes(row.reefId)) return false
      if (filter.value.bleachLevels.length > 0) {
        const matched = filter.value.bleachLevels.some((level) => row.distribution[level] > 0)
        if (!matched) return false
      }
      // 「仅看存在白化」：活珊瑚出现轻 / 中 / 重，或有死亡覆盖
      if (
        filter.value.onlyBleached &&
        row.bleachedSharePct <= 0 &&
        row.distribution.死亡 <= 0
      )
        return false
      return true
    })
  )

  const hasFilter = computed<boolean>(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.reefIds.length > 0 ||
      filter.value.bleachLevels.length > 0 ||
      filter.value.onlyBleached
  )

  /** 全局白化等级分布与总体指数（按有活珊瑚的样带指数平均，无记录样带不计） */
  const globalStats = computed(() => {
    const distribution = bleachDistribution(corals.value)
    const deadCoverCm = distribution.死亡
    const liveCoverCm = round(
      corals.value
        .filter((coral) => coral.bleachLevel !== '死亡')
        .reduce((sum, coral) => sum + coral.coverCm, 0),
      1
    )
    const coverCmTotal = round(liveCoverCm + deadCoverCm, 1)
    const aggregate = aggregateBleach(
      coverageRows.value.map((row) => ({
        hasRecords: row.coralCount > 0,
        bleachIndex: row.bleachIndex
      }))
    )
    return {
      coralCount: corals.value.length,
      fishCount: fishes.value.length,
      coverCmTotal,
      liveCoverCm,
      deadCoverCm,
      assessedBeltCount: aggregate.assessedBeltCount,
      allDeadBeltCount: aggregate.allDeadBeltCount,
      bleachIndex: aggregate.avgBleachIndex,
      grade: aggregate.grade,
      bleachedSharePct: bleachedSharePct(corals.value),
      distribution
    }
  })

  function patchFilter(patch: Partial<SurveyFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptySurveyFilter()
  }

  function patchCoralDraft(patch: Partial<typeof coralDraft.value>): void {
    coralDraft.value = { ...coralDraft.value, ...patch }
  }

  function patchFishDraft(patch: Partial<typeof fishDraft.value>): void {
    fishDraft.value = { ...fishDraft.value, ...patch }
  }

  /* ------------------------------ 珊瑚记录 ------------------------------ */

  async function createCoral(
    beltId: string,
    payload: Omit<CoralRecord, 'id' | 'createdAt' | 'updatedAt' | 'beltId'>
  ): Promise<CoralRecord> {
    const now = Date.now()
    const row: CoralRecord = { ...payload, beltId, id: createId('cor'), createdAt: now, updatedAt: now }
    await db.corals.put(row)
    return row
  }

  async function updateCoral(id: string, patch: Partial<CoralRecord>): Promise<void> {
    await db.corals.update(id, { ...patch, updatedAt: Date.now() } as never)
  }

  async function removeCoral(id: string): Promise<void> {
    await db.corals.delete(id)
  }

  /** 批量导入粘贴行（替换该样带原有珊瑚记录） */
  async function importCoralRows(
    beltId: string,
    rows: Array<{ genus: string; form: CoralForm; coverCm: number; bleachLevel: BleachLevel }>
  ): Promise<number> {
    const now = Date.now()
    const records: CoralRecord[] = rows.map((row, index) => ({
      id: createId('cor'),
      beltId,
      genus: row.genus,
      form: row.form,
      coverCm: row.coverCm,
      bleachLevel: row.bleachLevel,
      remark: '',
      createdAt: now + index,
      updatedAt: now + index
    }))
    await db.transaction('rw', [db.corals], async () => {
      await db.corals.where('beltId').equals(beltId).delete()
      if (records.length > 0) await db.corals.bulkPut(records)
    })
    return records.length
  }

  /** 批量改写白化等级 */
  async function bulkSetBleachLevel(ids: string[], bleachLevel: BleachLevel): Promise<number> {
    const now = Date.now()
    await db.corals
      .where('id')
      .anyOf(ids)
      .modify((coral) => {
        coral.bleachLevel = bleachLevel
        coral.updatedAt = now
      })
    return ids.length
  }

  /* ------------------------------ 鱼类计数 ------------------------------ */

  async function createFish(
    beltId: string,
    payload: Omit<FishCount, 'id' | 'createdAt' | 'updatedAt' | 'beltId'>
  ): Promise<FishCount> {
    const now = Date.now()
    const row: FishCount = { ...payload, beltId, id: createId('fsh'), createdAt: now, updatedAt: now }
    await db.fishes.put(row)
    return row
  }

  async function updateFish(id: string, patch: Partial<FishCount>): Promise<void> {
    await db.fishes.update(id, { ...patch, updatedAt: Date.now() } as never)
  }

  async function removeFish(id: string): Promise<void> {
    await db.fishes.delete(id)
  }

  /** 批量导入粘贴行（替换该样带原有计数） */
  async function importFishRows(
    beltId: string,
    rows: Array<{ family: string; count: number; sizeClass: SizeClass; category: CountCategory }>
  ): Promise<number> {
    const now = Date.now()
    const records: FishCount[] = rows.map((row, index) => ({
      id: createId('fsh'),
      beltId,
      family: row.family,
      count: row.count,
      sizeClass: row.sizeClass,
      category: row.category,
      createdAt: now + index,
      updatedAt: now + index
    }))
    await db.transaction('rw', [db.fishes], async () => {
      await db.fishes.where('beltId').equals(beltId).delete()
      if (records.length > 0) await db.fishes.bulkPut(records)
    })
    return records.length
  }

  /** 按科名与体长段汇总某样带计数 */
  function fishSummaryOfBelt(beltId: string | null | undefined): Array<{
    family: string
    category: CountCategory
    total: number
    bySize: Record<SizeClass, number>
  }> {
    if (!beltId) return []
    const map = new Map<string, { family: string; category: CountCategory; total: number; bySize: Record<SizeClass, number> }>()
    fishesOfBelt(beltId).forEach((fish) => {
      const bucket =
        map.get(fish.family) ??
        { family: fish.family, category: fish.category, total: 0, bySize: { '0-10cm': 0, '11-20cm': 0, '21-30cm': 0, '>30cm': 0 } }
      bucket.total += fish.count
      bucket.bySize[fish.sizeClass] += fish.count
      map.set(fish.family, bucket)
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }

  return {
    corals,
    fishes,
    reefs,
    sites,
    belts,
    ready,
    error,
    filter,
    coralDraft,
    fishDraft,
    beltRecordCounts,
    coverageRows,
    filteredCoverageRows,
    hasFilter,
    globalStats,
    start,
    coralsOfBelt,
    fishesOfBelt,
    fishSummaryOfBelt,
    patchFilter,
    resetFilter,
    patchCoralDraft,
    patchFishDraft,
    createCoral,
    updateCoral,
    removeCoral,
    importCoralRows,
    bulkSetBleachLevel,
    createFish,
    updateFish,
    removeFish,
    importFishRows
  }
})
