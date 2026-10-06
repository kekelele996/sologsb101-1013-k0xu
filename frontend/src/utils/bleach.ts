/**
 * 白化工具：白化等级排序权重、白化指数换算与配色映射。
 * 页面、store 与数据库播种共用同一套算法。
 *
 * 口径说明：
 * - 「珊瑚覆盖率」只统计活珊瑚（无 / 轻 / 中 / 重），死亡覆盖单列（deadCoverCm / 死亡覆盖率）。
 * - 白化指数只按无 0 / 轻 1 / 中 2 / 重 3 四级做覆盖长度加权（0 ~ 3）；
 *   死亡记录不参与白化指数，全死亡样带指数无值（null）。
 * - 没有珊瑚记录的样带不产出白化评定，也不进入站位 / 礁区平均。
 */
import type { BleachLevel, CoralForm } from '@/types/coralRecord'

/** 保留小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 参与白化指数计算的白化等级（死亡不计指数） */
export const BLEACH_LIVE_LEVELS: ReadonlyArray<BleachLevel> = ['无', '轻', '中', '重']

/**
 * 白化等级权重：无 0、轻 1、中 2、重 3，死亡不参与指数（权重标记为 4 仅用于排序配色）。
 */
export const BLEACH_WEIGHT: Record<BleachLevel, number> = {
  无: 0,
  轻: 1,
  中: 2,
  重: 3,
  死亡: 4
}

/** 白化等级配色 */
export const BLEACH_COLOR: Record<BleachLevel, string> = {
  无: '#1e8449',
  轻: '#7ab648',
  中: '#d68910',
  重: '#e07b39',
  死亡: '#7b241c'
}

/** 白化等级浅色底 */
export const BLEACH_BG: Record<BleachLevel, string> = {
  无: '#eaf6ee',
  轻: '#f0f7e8',
  中: '#fdf3e3',
  重: '#fdeee4',
  死亡: '#f6e4e2'
}

/** 白化等级图标（Element Plus 图标组件名） */
export const BLEACH_ICON: Record<BleachLevel, string> = {
  无: 'CircleCheckFilled',
  轻: 'InfoFilled',
  中: 'WarningFilled',
  重: 'Warning',
  死亡: 'CircleCloseFilled'
}

/** 白化等级排序权重：重者优先（死亡排最末位的「最重」，仅用于记录行排序） */
export function compareBleach(a: BleachLevel, b: BleachLevel, coverA = 0, coverB = 0): number {
  const diff = BLEACH_WEIGHT[b] - BLEACH_WEIGHT[a]
  if (diff !== 0) return diff
  return coverB - coverA
}

/** 珊瑚形态配色（用于覆盖率图表） */
export const FORM_COLOR: Record<CoralForm, string> = {
  枝状: '#0b5d5a',
  块状: '#3f9ec4',
  叶状: '#7ab648',
  软珊瑚: '#d68910'
}

type CoverRecord = { coverCm: number; bleachLevel: BleachLevel }

function toCover(value: number): number {
  return Math.max(0, value || 0)
}

/**
 * 白化指数：按活珊瑚覆盖长度加权的平均白化等级（0 ~ 3，仅无 / 轻 / 中 / 重）。
 * 死亡记录不参与；没有活珊瑚覆盖时返回 null（全死亡或无记录样带无指数）。
 */
export function bleachIndex(records: CoverRecord[]): number | null {
  const live = records.filter((record) => record.bleachLevel !== '死亡')
  const totalCover = live.reduce((sum, record) => sum + toCover(record.coverCm), 0)
  if (totalCover <= 0) return null
  const weighted = live.reduce(
    (sum, record) => sum + toCover(record.coverCm) * BLEACH_WEIGHT[record.bleachLevel],
    0
  )
  return round(weighted / totalCover, 2)
}

/**
 * 白化等级定级：
 * - null：没有活珊瑚记录（无记录样带，不进任何平均）
 * - 「死亡」：有珊瑚记录但活珊瑚覆盖为 0（全死亡样带）
 * - 其余按指数换算成无 / 轻 / 中 / 重。
 */
export function bleachGrade(index: number | null, hasRecords = false): BleachLevel | null {
  if (index === null) return hasRecords ? '死亡' : null
  if (index <= 0.05) return '无'
  if (index <= 1) return '轻'
  if (index <= 2) return '中'
  return '重'
}

/**
 * 活珊瑚覆盖率（%）：活珊瑚（无 / 轻 / 中 / 重）覆盖长度合计 / 样带长度 × 100。
 * 死亡覆盖不计入珊瑚覆盖率。
 * 样带长度以米传入，覆盖长度以厘米累计。
 */
export function coralCoveragePct(liveCoverCmTotal: number, beltLengthM: number): number {
  const beltLengthCm = beltLengthM * 100
  if (beltLengthCm <= 0) return 0
  return round((liveCoverCmTotal / beltLengthCm) * 100, 2)
}

/** 死亡覆盖率（%）：死亡珊瑚覆盖长度 / 样带长度 × 100，单列展示。 */
export function deadCoveragePct(deadCoverCmTotal: number, beltLengthM: number): number {
  const beltLengthCm = beltLengthM * 100
  if (beltLengthCm <= 0) return 0
  return round((deadCoverCmTotal / beltLengthCm) * 100, 2)
}

/**
 * 白化占比（%）：活珊瑚中白化等级非「无」（轻 / 中 / 重）的覆盖长度占活珊瑚覆盖的比例。
 * 死亡不计入白化占比（死亡覆盖另行单列）。
 */
export function bleachedSharePct(records: CoverRecord[]): number {
  const live = records.filter((record) => record.bleachLevel !== '死亡')
  const totalCover = live.reduce((sum, record) => sum + toCover(record.coverCm), 0)
  if (totalCover <= 0) return 0
  const bleached = live
    .filter((record) => record.bleachLevel !== '无')
    .reduce((sum, record) => sum + toCover(record.coverCm), 0)
  return round((bleached / totalCover) * 100, 1)
}

/** 按白化等级累计覆盖长度（无 / 轻 / 中 / 重 / 死亡） */
export function bleachDistribution(records: CoverRecord[]): Record<BleachLevel, number> {
  const distribution: Record<BleachLevel, number> = { 无: 0, 轻: 0, 中: 0, 重: 0, 死亡: 0 }
  records.forEach((record) => {
    distribution[record.bleachLevel] = round(distribution[record.bleachLevel] + toCover(record.coverCm), 1)
  })
  return distribution
}

/** 单样带 / 一组珊瑚记录的覆盖度口径成果（活珊瑚与死亡分列） */
export interface CoralCoverSummary {
  coralCount: number
  /** 全部珊瑚覆盖长度合计（含死亡，cm） */
  coverCmTotal: number
  /** 活珊瑚（无 / 轻 / 中 / 重）覆盖长度（cm） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 活珊瑚覆盖率（%，不含死亡） */
  liveCoveragePct: number
  /** 死亡覆盖率（%） */
  deadCoveragePct: number
  /** 白化指数 0 ~ 3；全死亡 / 无记录时为 null */
  bleachIndex: number | null
  /** 总体白化等级；无记录为 null，全死亡为「死亡」 */
  grade: BleachLevel | null
  /** 活珊瑚白化占比（%） */
  bleachedSharePct: number
  /** 各白化等级累计覆盖长度（含死亡） */
  distribution: Record<BleachLevel, number>
}

/**
 * 汇总一组珊瑚记录的覆盖度成果：
 * 活珊瑚覆盖率与死亡覆盖率分列；白化指数只按无 / 轻 / 中 / 重计算。
 */
export function summarizeCoralCover(
  records: CoverRecord[],
  beltLengthM: number
): CoralCoverSummary {
  const distribution = bleachDistribution(records)
  const coverCmTotal = round(
    records.reduce((sum, record) => sum + toCover(record.coverCm), 0),
    1
  )
  const deadCoverCm = distribution.死亡
  const liveCoverCm = round(coverCmTotal - deadCoverCm, 1)
  const index = bleachIndex(records)
  return {
    coralCount: records.length,
    coverCmTotal,
    liveCoverCm,
    deadCoverCm,
    liveCoveragePct: coralCoveragePct(liveCoverCm, beltLengthM),
    deadCoveragePct: deadCoveragePct(deadCoverCm, beltLengthM),
    bleachIndex: index,
    grade: bleachGrade(index, records.length > 0),
    bleachedSharePct: bleachedSharePct(records),
    distribution
  }
}

/** 参与站位 / 礁区白化评定汇总的样带口径行 */
export interface BleachAggregateItem {
  /** 样带是否有珊瑚记录（无记录样带不进平均） */
  hasRecords: boolean
  /** 白化指数；全死亡 / 无记录为 null */
  bleachIndex: number | null
}

/** 站位 / 礁区白化评定成果 */
export interface BleachAggregate {
  /** 有珊瑚记录的样带数（参与评定） */
  assessedBeltCount: number
  /** 有活珊瑚、贡献指数的样带数 */
  liveBeltCount: number
  /** 全死亡样带数（活珊瑚覆盖率 0、指数无值） */
  allDeadBeltCount: number
  /** 平均白化指数：有活珊瑚样带指数的算术平均；全部无指数时为 null */
  avgBleachIndex: number | null
  /** 总体等级：全部参评样带均为全死亡时记「死亡」；无参评样带为 null */
  grade: BleachLevel | null
}

/**
 * 站位 / 礁区白化评定：
 * 无珊瑚记录样带不进平均；全死亡样带标「死亡」但不贡献指数；
 * 其余样带指数算术平均，按指数换算总体等级。
 */
export function aggregateBleach(items: BleachAggregateItem[]): BleachAggregate {
  const assessed = items.filter((item) => item.hasRecords)
  const live = assessed.filter((item) => item.bleachIndex !== null)
  const allDead = assessed.filter((item) => item.bleachIndex === null)
  const avgBleachIndex =
    live.length === 0
      ? null
      : round(
          live.reduce((sum, item) => sum + (item.bleachIndex ?? 0), 0) / live.length,
          2
        )
  let grade: BleachLevel | null = null
  if (assessed.length > 0) {
    grade = live.length === 0 ? '死亡' : bleachGrade(avgBleachIndex, false)
  }
  return {
    assessedBeltCount: assessed.length,
    liveBeltCount: live.length,
    allDeadBeltCount: allDead.length,
    avgBleachIndex,
    grade
  }
}

/** 鱼类密度（尾 / 100 m²）：计数 / （样带长度 × 1 m 宽）× 100 */
export function fishDensity(count: number, beltLengthM: number, beltWidthM = 1): number {
  const area = beltLengthM * beltWidthM
  if (area <= 0) return 0
  return round((count / area) * 100, 2)
}

/** 按属名分组汇总覆盖长度 */
export function groupByGenus(
  records: Array<{ genus: string; coverCm: number }>
): Array<{ genus: string; coverCm: number }> {
  const map = new Map<string, number>()
  records.forEach((record) => {
    map.set(record.genus, (map.get(record.genus) ?? 0) + record.coverCm)
  })
  return Array.from(map.entries())
    .map(([genus, coverCm]) => ({ genus, coverCm: round(coverCm, 1) }))
    .sort((a, b) => b.coverCm - a.coverCm)
}

/** 按形态分组汇总覆盖长度 */
export function groupByForm(
  records: Array<{ form: CoralForm; coverCm: number }>
): Array<{ form: CoralForm; coverCm: number }> {
  const map = new Map<CoralForm, number>()
  records.forEach((record) => {
    map.set(record.form, (map.get(record.form) ?? 0) + record.coverCm)
  })
  return Array.from(map.entries())
    .map(([form, coverCm]) => ({ form, coverCm: round(coverCm, 1) }))
    .sort((a, b) => b.coverCm - a.coverCm)
}
