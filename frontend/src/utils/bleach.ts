/**
 * 白化工具：白化等级排序权重、白化指数换算与配色映射。
 * 页面、store 与数据库播种共用同一套算法。
 */
import type { BleachLevel, CoralForm } from '@/types/coralRecord'

/** 保留小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 白化等级权重：无 0、轻 1、中 2、重 3、死亡 4 */
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
 * 白化指数：按覆盖长度加权的平均白化等级（0 ~ 4）。
 * 传入每条记录的覆盖长度与白化等级，返回加权平均并保留 2 位小数。
 */
export function bleachIndex(records: Array<{ coverCm: number; bleachLevel: BleachLevel }>): number {
  const totalCover = records.reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  if (totalCover <= 0) return 0
  const weighted = records.reduce(
    (sum, record) => sum + Math.max(0, record.coverCm) * BLEACH_WEIGHT[record.bleachLevel],
    0
  )
  return round(weighted / totalCover, 2)
}

/** 白化等级定级：由白化指数换算成礁区总体等级（参考珊瑚白化分级习惯） */
export function bleachGrade(index: number): BleachLevel {
  if (index <= 0.05) return '无'
  if (index <= 1) return '轻'
  if (index <= 2) return '中'
  if (index <= 3) return '重'
  return '死亡'
}

/**
 * 珊瑚覆盖率（%）：样带内珊瑚覆盖长度合计 / 样带长度 × 100。
 * 样带长度以米传入，覆盖长度以厘米累计。
 */
export function coralCoveragePct(coverCmTotal: number, beltLengthM: number): number {
  const beltLengthCm = beltLengthM * 100
  if (beltLengthCm <= 0) return 0
  return round((coverCmTotal / beltLengthCm) * 100, 2)
}

/** 白化占比（%）：白化等级非「无」的覆盖长度占珊瑚总覆盖长度的比例 */
export function bleachedSharePct(records: Array<{ coverCm: number; bleachLevel: BleachLevel }>): number {
  const totalCover = records.reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  if (totalCover <= 0) return 0
  const bleached = records
    .filter((record) => record.bleachLevel !== '无')
    .reduce((sum, record) => sum + Math.max(0, record.coverCm), 0)
  return round((bleached / totalCover) * 100, 1)
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
