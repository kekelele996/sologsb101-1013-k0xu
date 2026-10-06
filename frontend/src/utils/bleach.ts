/**
 * 白化工具：白化等级排序权重、白化指数换算与配色映射。
 * 页面、store 与数据库播种共用同一套算法。
 */
import type { BleachLevel, CoralForm } from '@/types/coralRecord'

/** 活珊瑚白化等级：白化指数只按无/轻/中/重加权，死亡不参与 */
export const LIVE_BLEACH_LEVELS = ['无', '轻', '中', '重'] as const
export type LiveBleachLevel = (typeof LIVE_BLEACH_LEVELS)[number]

/** 死亡等级常量：覆盖率与白化指数均把死亡与活珊瑚分开处理 */
export const DEAD_LEVEL: BleachLevel = '死亡'

/** 保留小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 白化等级权重：无 0、轻 1、中 2、重 3。
 * 死亡不参与白化指数加权，仅用于记录排序，权重保留为 4。
 */
export const BLEACH_WEIGHT: Record<BleachLevel, number> = {
  无: 0,
  轻: 1,
  中: 2,
  重: 3,
  死亡: 4
}

export function isLiveBleachLevel(level: BleachLevel): level is LiveBleachLevel {
  return level !== DEAD_LEVEL
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

/** 白化等级排序权重：重者优先 */
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

/**
 * 白化指数：活珊瑚按覆盖长度加权的平均白化等级（0 ~ 3）。
 * 死亡珊瑚与白化无关，不参与加权：
 * - 样带没有活珊瑚（含无记录、全为死亡）时记 0，配合 hasLiveCorals / allDead 标识区分；
 * - 总体等级只输出 无/轻/中/重。
 */
export function bleachIndex(records: Array<{ coverCm: number; bleachLevel: BleachLevel }>): number {
  const liveRecords = records.filter((record) => record.bleachLevel !== DEAD_LEVEL)
  const totalLiveCover = liveRecords.reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  if (totalLiveCover <= 0) return 0
  const weighted = liveRecords.reduce(
    (sum, record) => sum + Math.max(0, record.coverCm) * BLEACH_WEIGHT[record.bleachLevel],
    0
  )
  return round(weighted / totalLiveCover, 2)
}

/** 白化等级定级：由白化指数换算成礁区总体等级，只取 无/轻/中/重 */
export function bleachGrade(index: number): LiveBleachLevel {
  if (index <= 0.05) return '无'
  if (index <= 1) return '轻'
  if (index <= 2) return '中'
  return '重'
}

/**
 * 活珊瑚覆盖率（%）：活珊瑚（无/轻/中/重）覆盖长度合计 / 样带长度 × 100。
 * 死亡珊瑚不计入覆盖率。样带长度以米传入，覆盖长度以厘米累计。
 */
export function liveCoralCoveragePct(liveCoverCm: number, beltLengthM: number): number {
  const beltLengthCm = beltLengthM * 100
  if (beltLengthCm <= 0) return 0
  return round((liveCoverCm / beltLengthCm) * 100, 2)
}

/** 死亡珊瑚覆盖率（%）：死亡珊瑚覆盖长度合计 / 样带长度 × 100 */
export function deadCoralCoveragePct(deadCoverCm: number, beltLengthM: number): number {
  const beltLengthCm = beltLengthM * 100
  if (beltLengthCm <= 0) return 0
  return round((deadCoverCm / beltLengthCm) * 100, 2)
}

/** 白化占比（%）：白化（轻/中/重）覆盖长度占活珊瑚覆盖长度的比例；死亡不计 */
export function bleachedSharePct(records: Array<{ coverCm: number; bleachLevel: BleachLevel }>): number {
  const liveRecords = records.filter((record) => record.bleachLevel !== DEAD_LEVEL)
  const totalLiveCover = liveRecords.reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  if (totalLiveCover <= 0) return 0
  const bleached = liveRecords
    .filter((record) => record.bleachLevel !== '无')
    .reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  return round((bleached / totalLiveCover) * 100, 1)
}

/** 白化等级分布（含死亡）：各等级累计覆盖长度 */
export type BleachDistribution = Record<BleachLevel, number>

/** 一组珊瑚记录的活/死覆盖长度与白化评定，供样带、站位、礁区与导出共用同一口径 */
export interface CoralSummary {
  /** 活珊瑚覆盖长度（cm，无/轻/中/重） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 活+死覆盖长度合计（cm，分布条分母） */
  coverCmTotal: number
  /** 是否存在珊瑚记录（含死亡） */
  hasCorals: boolean
  /** 是否存在活珊瑚记录 */
  hasLiveCorals: boolean
  /** 有珊瑚记录且全部死亡 */
  allDead: boolean
  /** 各白化等级（含死亡）累计覆盖长度 */
  distribution: BleachDistribution
  /** 白化指数（仅活珊瑚加权，无活珊瑚记 0） */
  bleachIndex: number
  /** 总体等级（无活珊瑚记「无」，配合 allDead 标记） */
  grade: LiveBleachLevel
  /** 白化占比（%，占活珊瑚） */
  bleachedSharePct: number
}

/** 汇总一组珊瑚记录的覆盖长度（活/死分开）与白化评定 */
export function summarizeCorals(
  records: Array<{ coverCm: number; bleachLevel: BleachLevel }>,
  levels: readonly BleachLevel[]
): CoralSummary {
  const distribution = { 无: 0, 轻: 0, 中: 0, 重: 0, 死亡: 0 } as BleachDistribution
  levels.forEach((level) => {
    distribution[level] = round(
      records.filter((record) => record.bleachLevel === level).reduce((sum, record) => sum + record.coverCm, 0),
      1
    )
  })
  const liveCoverCm = round(
    records.filter((record) => record.bleachLevel !== DEAD_LEVEL).reduce((sum, record) => sum + record.coverCm, 0),
    1
  )
  const deadCoverCm = round(distribution[DEAD_LEVEL], 1)
  const coverCmTotal = round(liveCoverCm + deadCoverCm, 1)
  const hasCorals = records.length > 0
  const hasLiveCorals = liveCoverCm > 0
  const index = bleachIndex(records)
  return {
    liveCoverCm,
    deadCoverCm,
    coverCmTotal,
    hasCorals,
    hasLiveCorals,
    allDead: hasCorals && !hasLiveCorals,
    distribution,
    bleachIndex: index,
    grade: bleachGrade(index),
    bleachedSharePct: bleachedSharePct(records)
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
