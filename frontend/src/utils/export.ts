/**
 * 备份导入导出：整库 JSON 快照的组装、校验、下载与导入；
 * 以及按礁区/站位汇总的覆盖度结论生成。
 */
import {
  db,
  DB_NAME,
  DB_VERSION,
  createId,
  clearAllTables,
  stampBackupTime,
  type BackupPayload
} from '@/utils/db'
import {
  BLEACH_LEVELS,
  type BleachLevel
} from '@/types/coralRecord'
import {
  bleachGrade,
  bleachIndex,
  deadCoralCoveragePct,
  fishDensity,
  liveCoralCoveragePct,
  round,
  summarizeCorals
} from '@/utils/bleach'
import type { LiveBleachLevel } from '@/utils/bleach'

/** 备份集合键名 */
export const BACKUP_KEYS = ['reefs', 'sites', 'belts', 'corals', 'fishes'] as const
export type BackupKey = (typeof BACKUP_KEYS)[number]

export type CountMap = Record<BackupKey, number>

/** 组装当前本地数据的完整快照 */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const [reefs, sites, belts, corals, fishes] = await Promise.all([
    db.reefs.toArray(),
    db.sites.toArray(),
    db.belts.toArray(),
    db.corals.toArray(),
    db.fishes.toArray()
  ])
  return {
    app: 'gbcoralbelt',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    reefs,
    sites,
    belts,
    corals,
    fishes
  }
}

/** 校验外部 JSON 是否为本站可识别的备份文件 */
export function validateBackup(input: unknown): { ok: boolean; errors: string[]; payload: BackupPayload | null } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], payload: null }
  }
  const obj = input as Partial<BackupPayload>
  if (obj.app !== undefined && obj.app !== 'gbcoralbelt') {
    errors.push('app 字段应为 gbcoralbelt，文件来源不明')
  }
  for (const key of BACKUP_KEYS) {
    if (!Array.isArray(obj[key])) errors.push(`${key} 字段缺失或不是数组`)
  }
  if (errors.length > 0) return { ok: false, errors, payload: null }
  const payload: BackupPayload = {
    app: 'gbcoralbelt',
    dbVersion: typeof obj.dbVersion === 'number' ? obj.dbVersion : DB_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    reefs: obj.reefs ?? [],
    sites: obj.sites ?? [],
    belts: obj.belts ?? [],
    corals: obj.corals ?? [],
    fishes: obj.fishes ?? []
  }
  return { ok: true, errors, payload }
}

/** 统计快照各表行数 */
export function countPayload(payload: BackupPayload): CountMap {
  return {
    reefs: payload.reefs.length,
    sites: payload.sites.length,
    belts: payload.belts.length,
    corals: payload.corals.length,
    fishes: payload.fishes.length
  }
}

/** 导出 JSON 文件到浏览器下载目录 */
export async function exportBackupJson(): Promise<{ fileName: string; counts: CountMap }> {
  const payload = await buildBackupPayload()
  const fileName = `${DB_NAME}-backup-v${payload.dbVersion}-${payload.exportedAt
    .slice(0, 19)
    .replace(/[:T]/g, '')}.json`
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  stampBackupTime(payload.exportedAt)
  return { fileName, counts: countPayload(payload) }
}

/** 读取用户选择的备份文件文本 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

/** 导入快照：overwrite=true 先清空全部表，否则按主键合并 */
export async function importBackup(payload: BackupPayload, overwrite: boolean): Promise<CountMap> {
  if (overwrite) await clearAllTables()
  await db.transaction('rw', [db.reefs, db.sites, db.belts, db.corals, db.fishes], async () => {
    await db.reefs.bulkPut(payload.reefs)
    await db.sites.bulkPut(payload.sites)
    await db.belts.bulkPut(payload.belts)
    await db.corals.bulkPut(payload.corals)
    await db.fishes.bulkPut(payload.fishes)
  })
  return countPayload(payload)
}

/** 追加式导入：为导入数据重新分配 id，避免覆盖现有档案 */
export function remapIds(payload: BackupPayload): BackupPayload {
  const reefMap = new Map<string, string>()
  const siteMap = new Map<string, string>()
  const beltMap = new Map<string, string>()

  const reefs = payload.reefs.map((reef) => {
    const id = createId('reef')
    reefMap.set(reef.id, id)
    return { ...reef, id }
  })
  const sites = payload.sites.map((site) => {
    const id = createId('site')
    siteMap.set(site.id, id)
    return { ...site, id, reefId: reefMap.get(site.reefId) ?? site.reefId }
  })
  const belts = payload.belts.map((belt) => {
    const id = createId('belt')
    beltMap.set(belt.id, id)
    return { ...belt, id, siteId: siteMap.get(belt.siteId) ?? belt.siteId }
  })
  const corals = payload.corals.map((coral) => ({
    ...coral,
    id: createId('cor'),
    beltId: beltMap.get(coral.beltId) ?? coral.beltId
  }))
  const fishes = payload.fishes.map((fish) => ({
    ...fish,
    id: createId('fsh'),
    beltId: beltMap.get(fish.beltId) ?? fish.beltId
  }))
  return { ...payload, reefs, sites, belts, corals, fishes }
}

/** 白化等级分布：各等级（含死亡）累计覆盖长度 */
export type BleachDistribution = Record<BleachLevel, number>

/** 覆盖度结论行：按样带汇总活/死珊瑚覆盖率、白化占比与鱼类密度 */
export interface CoverageLine {
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
  /** 活珊瑚覆盖长度（cm） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 活+死覆盖长度合计（cm） */
  coverCmTotal: number
  /** 活珊瑚覆盖率（%，死亡不计入） */
  liveCoveragePct: number
  /** 死亡珊瑚覆盖率（%） */
  deadCoveragePct: number
  /** 是否有珊瑚记录（含死亡） */
  hasCorals: boolean
  /** 有珊瑚记录且全部死亡 */
  allDead: boolean
  /** 白化指数 0 ~ 3（仅活珊瑚加权） */
  bleachIndex: number
  /** 总体白化等级（无/轻/中/重） */
  grade: LiveBleachLevel
  /** 白化占比（%，占活珊瑚覆盖长度） */
  bleachedSharePct: number
  distribution: BleachDistribution
  fishTotal: number
  invertebrateTotal: number
  /** 鱼类密度（尾 / 100 m²） */
  fishDensity: number
  conclusion: string
}

/** 按样带生成覆盖度结论行 */
export function buildCoverageLines(payload: BackupPayload): CoverageLine[] {
  const reefById = new Map(payload.reefs.map((reef) => [reef.id, reef]))
  const siteById = new Map(payload.sites.map((site) => [site.id, site]))
  const coralsByBelt = new Map<string, typeof payload.corals>()
  payload.corals.forEach((coral) => {
    const list = coralsByBelt.get(coral.beltId) ?? []
    list.push(coral)
    coralsByBelt.set(coral.beltId, list)
  })
  const fishesByBelt = new Map<string, typeof payload.fishes>()
  payload.fishes.forEach((fish) => {
    const list = fishesByBelt.get(fish.beltId) ?? []
    list.push(fish)
    fishesByBelt.set(fish.beltId, list)
  })

  return payload.belts
    .map((belt) => {
      const site = siteById.get(belt.siteId)
      const reef = site ? reefById.get(site.reefId) : undefined
      const corals = coralsByBelt.get(belt.id) ?? []
      const fishes = fishesByBelt.get(belt.id) ?? []
      const summary = summarizeCorals(corals, BLEACH_LEVELS)
      const liveCoveragePct = liveCoralCoveragePct(summary.liveCoverCm, belt.lengthM)
      const deadCoveragePct = deadCoralCoveragePct(summary.deadCoverCm, belt.lengthM)
      const fishTotal = fishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
      const invertebrateTotal = fishes
        .filter((fish) => fish.category === '无脊椎动物')
        .reduce((sum, fish) => sum + fish.count, 0)
      const conclusion = buildBeltConclusion(summary, liveCoveragePct, deadCoveragePct)
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
        coralCount: corals.length,
        liveCoverCm: summary.liveCoverCm,
        deadCoverCm: summary.deadCoverCm,
        coverCmTotal: summary.coverCmTotal,
        liveCoveragePct,
        deadCoveragePct,
        hasCorals: summary.hasCorals,
        allDead: summary.allDead,
        bleachIndex: summary.bleachIndex,
        grade: summary.grade,
        bleachedSharePct: summary.bleachedSharePct,
        distribution: summary.distribution,
        fishTotal,
        invertebrateTotal,
        fishDensity: fishDensity(fishTotal, belt.lengthM),
        conclusion
      }
    })
    // 无珊瑚记录的样带不参与白化排名，统一排到最后；其余按白化指数降序
    .sort((a, b) => {
      if (a.hasCorals !== b.hasCorals) return a.hasCorals ? -1 : 1
      return b.bleachIndex - a.bleachIndex
    })
}

/**
 * 单条样带的覆盖度结论文案：
 * - 无珊瑚记录：提示未录入，且不参与礁区白化指数；
 * - 全死亡：活珊瑚覆盖率 0，单列死亡覆盖；
 * - 正常：活珊瑚覆盖率（另附死亡覆盖），白化指数/占比只按无/轻/中/重算。
 */
export function buildBeltConclusion(
  summary: {
    hasCorals: boolean
    allDead: boolean
    bleachIndex: number
    grade: LiveBleachLevel
    bleachedSharePct: number
  },
  liveCoveragePct: number,
  deadCoveragePct: number
): string {
  if (!summary.hasCorals) {
    return '该样带尚未录入珊瑚记录，活珊瑚覆盖率记 0%，不参与礁区白化指数'
  }
  if (summary.allDead) {
    return `样带珊瑚全部死亡：活珊瑚覆盖率 0%，死亡覆盖 ${deadCoveragePct}%，不计入礁区白化指数`
  }
  const deadPart = deadCoveragePct > 0 ? `，另有死亡覆盖 ${deadCoveragePct}%` : ''
  if (summary.grade === '无') {
    return `活珊瑚覆盖率 ${liveCoveragePct}%${deadPart}，未见白化`
  }
  return `活珊瑚覆盖率 ${liveCoveragePct}%${deadPart}，白化指数 ${summary.bleachIndex}（${summary.grade}），白化占比 ${summary.bleachedSharePct}%`
}

/** 按礁区汇总：站位/样带数量、平均白化指数（无珊瑚记录样带不参与）与活/死覆盖 */
export interface ReefSummary {
  reefId: string
  reefName: string
  protectStatus: string
  siteCount: number
  beltCount: number
  /** 有珊瑚记录（含死亡）的样带数 */
  surveyedBeltCount: number
  coralCount: number
  /** 活珊瑚覆盖长度（cm） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 活+死覆盖长度合计（cm） */
  coverCmTotal: number
  /** 全部样带珊瑚均已死亡 */
  allDead: boolean
  avgBleachIndex: number
  grade: LiveBleachLevel
  fishTotal: number
}

export function buildReefSummaries(payload: BackupPayload, lines: CoverageLine[]): ReefSummary[] {
  return payload.reefs.map((reef) => {
    const siteIds = new Set(payload.sites.filter((site) => site.reefId === reef.id).map((site) => site.id))
    const beltIds = new Set(payload.belts.filter((belt) => siteIds.has(belt.siteId)).map((belt) => belt.id))
    const corals = payload.corals.filter((coral) => beltIds.has(coral.beltId))
    const lines4Reef = lines.filter((line) => line.reefId === reef.id)
    // 没有珊瑚记录的样带不进礁区白化指数
    const ratedLines = lines4Reef.filter((line) => line.hasCorals && !line.allDead)
    const avgBleachIndex =
      ratedLines.length === 0
        ? 0
        : round(ratedLines.reduce((sum, line) => sum + line.bleachIndex, 0) / ratedLines.length, 2)
    const liveCoverCm = round(
      corals.filter((coral) => coral.bleachLevel !== '死亡').reduce((sum, coral) => sum + coral.coverCm, 0),
      1
    )
    const deadCoverCm = round(
      corals.filter((coral) => coral.bleachLevel === '死亡').reduce((sum, coral) => sum + coral.coverCm, 0),
      1
    )
    const surveyedBeltCount = lines4Reef.filter((line) => line.hasCorals).length
    const allDead = surveyedBeltCount > 0 && ratedLines.length === 0
    return {
      reefId: reef.id,
      reefName: reef.name,
      protectStatus: reef.protectStatus,
      siteCount: siteIds.size,
      beltCount: beltIds.size,
      surveyedBeltCount,
      coralCount: corals.length,
      liveCoverCm,
      deadCoverCm,
      coverCmTotal: round(liveCoverCm + deadCoverCm, 1),
      allDead,
      avgBleachIndex,
      grade: bleachGrade(avgBleachIndex),
      fishTotal: payload.fishes
        .filter((fish) => beltIds.has(fish.beltId))
        .reduce((sum, fish) => sum + fish.count, 0)
    }
  })
}
