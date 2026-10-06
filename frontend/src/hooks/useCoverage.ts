/**
 * useCoverage：按样带或站位汇总活珊瑚 / 死亡珊瑚覆盖、白化评定与鱼类密度。
 * 被珊瑚计数页（/belts/:id/corals）、鱼类计数页（/belts/:id/fishes）
 * 与覆盖度汇总页（/coverage）消费。
 *
 * 口径：珊瑚覆盖率只算活珊瑚（无 / 轻 / 中 / 重），死亡覆盖单列；
 * 白化指数只按无 / 轻 / 中 / 重加权；无珊瑚记录样带不进站位 / 礁区平均。
 */
import { computed, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useReefStore } from '@/stores/reefStore'
import { useBeltStore } from '@/stores/beltStore'
import { useSurveyStore } from '@/stores/surveyStore'
import type { BleachLevel, CoralRecord, CoralForm } from '@/types/coralRecord'
import type { FishCount } from '@/types/fishCount'
import {
  aggregateBleach,
  bleachDistribution,
  fishDensity,
  groupByForm,
  groupByGenus,
  round,
  summarizeCoralCover
} from '@/utils/bleach'

/** 单条样带的覆盖度成果 */
export interface BeltCoverage {
  beltId: string
  beltNo: string
  siteId: string
  siteNo: string
  reefId: string
  reefName: string
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
  /** 活珊瑚白化占比（%） */
  bleachedSharePct: number
  /** 各白化等级累计覆盖长度（含死亡） */
  distribution: Record<BleachLevel, number>
  /** 按属名分组的覆盖长度 */
  byGenus: Array<{ genus: string; coverCm: number }>
  /** 按形态分组的覆盖长度 */
  byForm: Array<{ form: CoralForm; coverCm: number }>
  fishTotal: number
  invertebrateTotal: number
  /** 鱼类密度（尾 / 100 m²） */
  fishDensity: number
}

/** 单个站位的覆盖度汇总 */
export interface SiteCoverage {
  siteId: string
  siteNo: string
  reefId: string
  reefName: string
  depthM: number
  beltCount: number
  /** 有珊瑚记录、参与白化评定的样带数 */
  assessedBeltCount: number
  /** 全死亡样带数 */
  allDeadBeltCount: number
  coralCount: number
  /** 活珊瑚覆盖长度（cm） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 站位平均活珊瑚覆盖率（各样本带活珊瑚覆盖率均值；无记录样带按 0 计） */
  avgCoveragePct: number
  avgBleachIndex: number | null
  grade: BleachLevel | null
  bleachedSharePct: number
  fishTotal: number
  invertebrateTotal: number
  fishDensity: number
}

/** 按白化等级排序的珊瑚记录行（珊瑚计数页表格用） */
export interface CoralRow {
  record: CoralRecord
  /** 占样带长度比例（%） */
  coverSharePct: number
}

export interface UseCoverageResult {
  /** 指定样带的覆盖度成果 */
  beltCoverage: (beltId: string | null | undefined) => ComputedRef<BeltCoverage | null>
  /** 指定站位下全部样带的汇总 */
  siteCoverage: (siteId: string | null | undefined) => ComputedRef<SiteCoverage | null>
  /** 全部样带的覆盖度成果（全死亡优先，再按白化指数降序，无记录样带排末尾） */
  allBeltCoverages: ComputedRef<BeltCoverage[]>
  /** 全部站位的覆盖度汇总 */
  allSiteCoverages: ComputedRef<SiteCoverage[]>
  /** 全局白化等级分布 */
  globalDistribution: ComputedRef<Record<BleachLevel, number>>
  /** 指定样带的珊瑚记录行（按白化等级降序） */
  coralRows: (beltId: string | null | undefined) => ComputedRef<CoralRow[]>
  /** 指定样带的鱼类计数行 */
  fishRows: (beltId: string | null | undefined) => ComputedRef<Array<{ record: FishCount; density: number }>>
}

/** 白化等级排序权重（用于珊瑚记录行排序） */
const BLEACH_WEIGHT_ORDER: Record<BleachLevel, number> = {
  无: 0,
  轻: 1,
  中: 2,
  重: 3,
  死亡: 4
}

/** 样带排序：全死亡样带优先标出，其次按白化指数降序，无记录样带排末尾 */
function compareBeltCoverage(a: BeltCoverage, b: BeltCoverage): number {
  const score = (item: BeltCoverage): number => {
    if (item.coralCount === 0) return -1
    if (item.bleachIndex === null) return 100 // 全死亡
    return item.bleachIndex
  }
  return score(b) - score(a)
}

/**
 * 组合式函数：基于三个 store 的响应式列表派生活 / 死珊瑚覆盖、白化评定与鱼类密度。
 */
export function useCoverage(): UseCoverageResult {
  const reefStore = useReefStore()
  const beltStore = useBeltStore()
  const surveyStore = useSurveyStore()

  const { reefs, sites } = storeToRefs(reefStore)
  const { belts } = storeToRefs(beltStore)
  const { corals, fishes } = storeToRefs(surveyStore)

  const siteOf = (siteId: string) => sites.value.find((site) => site.id === siteId) ?? null
  const reefOf = (reefId: string) => reefs.value.find((reef) => reef.id === reefId) ?? null

  function buildBeltCoverage(beltId: string): BeltCoverage | null {
    const belt = belts.value.find((item) => item.id === beltId)
    if (!belt) return null
    const site = siteOf(belt.siteId)
    const reef = site ? reefOf(site.reefId) : null
    const beltCorals = corals.value.filter((coral) => coral.beltId === belt.id)
    const beltFishes = fishes.value.filter((fish) => fish.beltId === belt.id)
    const summary = summarizeCoralCover(beltCorals, belt.lengthM)
    const fishTotal = beltFishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
    const invertebrateTotal = beltFishes
      .filter((fish) => fish.category === '无脊椎动物')
      .reduce((sum, fish) => sum + fish.count, 0)
    return {
      beltId: belt.id,
      beltNo: belt.no,
      siteId: site?.id ?? '',
      siteNo: site?.no ?? '—',
      reefId: reef?.id ?? '',
      reefName: reef?.name ?? '未知礁区',
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
      byGenus: groupByGenus(beltCorals),
      byForm: groupByForm(beltCorals),
      fishTotal,
      invertebrateTotal,
      fishDensity: fishDensity(fishTotal, belt.lengthM)
    }
  }

  function beltCoverage(beltId: string | null | undefined): ComputedRef<BeltCoverage | null> {
    return computed(() => (beltId ? buildBeltCoverage(beltId) : null))
  }

  const allBeltCoverages = computed<BeltCoverage[]>(() =>
    belts.value
      .map((belt) => buildBeltCoverage(belt.id))
      .filter((item): item is BeltCoverage => item !== null)
      .sort(compareBeltCoverage)
  )

  function buildSiteCoverage(siteId: string): SiteCoverage | null {
    const site = siteOf(siteId)
    if (!site) return null
    const reef = reefOf(site.reefId)
    const siteBelts = belts.value.filter((belt) => belt.siteId === site.id)
    const beltIds = new Set(siteBelts.map((belt) => belt.id))
    const siteCorals = corals.value.filter((coral) => beltIds.has(coral.beltId))
    const siteFishes = fishes.value.filter((fish) => beltIds.has(fish.beltId))
    const beltSummaries = siteBelts.map((belt) => {
      const beltCorals = siteCorals.filter((coral) => coral.beltId === belt.id)
      return { belt, summary: summarizeCoralCover(beltCorals, belt.lengthM) }
    })
    const liveCoverCm = round(
      beltSummaries.reduce((sum, item) => sum + item.summary.liveCoverCm, 0),
      1
    )
    const deadCoverCm = round(
      beltSummaries.reduce((sum, item) => sum + item.summary.deadCoverCm, 0),
      1
    )
    const avgCoveragePct =
      beltSummaries.length === 0
        ? 0
        : round(
            beltSummaries.reduce((sum, item) => sum + item.summary.liveCoveragePct, 0) / beltSummaries.length,
            2
          )
    const aggregate = aggregateBleach(
      beltSummaries.map((item) => ({
        hasRecords: item.summary.coralCount > 0,
        bleachIndex: item.summary.bleachIndex
      }))
    )
    const fishTotal = siteFishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
    const totalBeltLength = siteBelts.reduce((sum, belt) => sum + belt.lengthM, 0)
    const liveCorals = siteCorals.filter((coral) => coral.bleachLevel !== '死亡')
    const liveCoverTotal = liveCorals.reduce((sum, coral) => sum + coral.coverCm, 0)
    const bleachedTotal = liveCorals
      .filter((coral) => coral.bleachLevel !== '无')
      .reduce((sum, coral) => sum + coral.coverCm, 0)
    return {
      siteId: site.id,
      siteNo: site.no,
      reefId: reef?.id ?? '',
      reefName: reef?.name ?? '未知礁区',
      depthM: site.depthM,
      beltCount: siteBelts.length,
      assessedBeltCount: aggregate.assessedBeltCount,
      allDeadBeltCount: aggregate.allDeadBeltCount,
      coralCount: siteCorals.length,
      liveCoverCm,
      deadCoverCm,
      avgCoveragePct,
      avgBleachIndex: aggregate.avgBleachIndex,
      grade: aggregate.grade,
      bleachedSharePct: liveCoverTotal > 0 ? round((bleachedTotal / liveCoverTotal) * 100, 1) : 0,
      fishTotal,
      invertebrateTotal: siteFishes
        .filter((fish) => fish.category === '无脊椎动物')
        .reduce((sum, fish) => sum + fish.count, 0),
      fishDensity: fishDensity(fishTotal, totalBeltLength)
    }
  }

  function siteCoverage(siteId: string | null | undefined): ComputedRef<SiteCoverage | null> {
    return computed(() => (siteId ? buildSiteCoverage(siteId) : null))
  }

  const allSiteCoverages = computed<SiteCoverage[]>(() =>
    sites.value
      .map((site) => buildSiteCoverage(site.id))
      .filter((item): item is SiteCoverage => item !== null)
      .sort((a, b) => (b.avgBleachIndex ?? -1) - (a.avgBleachIndex ?? -1))
  )

  const globalDistribution = computed<Record<BleachLevel, number>>(() => bleachDistribution(corals.value))

  function coralRows(beltId: string | null | undefined): ComputedRef<CoralRow[]> {
    return computed(() => {
      if (!beltId) return []
      const belt = belts.value.find((item) => item.id === beltId)
      const beltLengthCm = belt ? belt.lengthM * 100 : 0
      return corals.value
        .filter((coral) => coral.beltId === beltId)
        .map((record) => ({
          record,
          coverSharePct: beltLengthCm > 0 ? round((record.coverCm / beltLengthCm) * 100, 1) : 0
        }))
        .sort((a, b) => {
          const weightDiff =
            BLEACH_WEIGHT_ORDER[b.record.bleachLevel] - BLEACH_WEIGHT_ORDER[a.record.bleachLevel]
          if (weightDiff !== 0) return weightDiff
          return b.record.coverCm - a.record.coverCm
        })
    })
  }

  function fishRows(beltId: string | null | undefined): ComputedRef<Array<{ record: FishCount; density: number }>> {
    return computed(() => {
      if (!beltId) return []
      const belt = belts.value.find((item) => item.id === beltId)
      const lengthM = belt?.lengthM ?? 0
      return fishes.value
        .filter((fish) => fish.beltId === beltId)
        .map((record) => ({ record, density: fishDensity(record.count, lengthM) }))
        .sort((a, b) => b.record.count - a.record.count)
    })
  }

  return {
    beltCoverage,
    siteCoverage,
    allBeltCoverages,
    allSiteCoverages,
    globalDistribution,
    coralRows,
    fishRows
  }
}
