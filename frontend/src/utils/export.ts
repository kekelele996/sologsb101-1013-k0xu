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
  type BleachLevel
} from '@/types/coralRecord'
import {
  aggregateBleach,
  fishDensity,
  round,
  summarizeCoralCover
} from '@/utils/bleach'

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

/** 白化等级分布：各等级累计覆盖长度 */
export type BleachDistribution = Record<BleachLevel, number>

/** 覆盖度结论行：按样带汇总结活珊瑚 / 死亡珊瑚覆盖、白化评定与鱼类密度 */
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
  /** 全部珊瑚覆盖长度合计（含死亡，cm） */
  coverCmTotal: number
  /** 活珊瑚覆盖长度（cm） */
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
      const summary = summarizeCoralCover(corals, belt.lengthM)
      const fishTotal = fishes.filter((fish) => fish.category === '鱼类').reduce((sum, fish) => sum + fish.count, 0)
      const invertebrateTotal = fishes
        .filter((fish) => fish.category === '无脊椎动物')
        .reduce((sum, fish) => sum + fish.count, 0)
      const conclusion = buildBeltConclusion(summary)
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
        invertebrateTotal,
        fishDensity: fishDensity(fishTotal, belt.lengthM),
        conclusion
      }
    })
    .sort((a, b) => {
      // 全死亡样带优先标出，其次按白化指数降序，无记录样带排末尾
      const score = (line: CoverageLine): number => {
        if (line.coralCount === 0) return -1
        if (line.bleachIndex === null) return 100
        return line.bleachIndex
      }
      return score(b) - score(a)
    })
}

/**
 * 单样带文字结论：活珊瑚覆盖率与死亡覆盖分列，白化指数只按无 / 轻 / 中 / 重。
 */
function buildBeltConclusion(summary: ReturnType<typeof summarizeCoralCover>): string {
  if (summary.coralCount === 0) return '该样带尚未录入珊瑚记录，不参与礁区白化指数'
  const deadPart = summary.deadCoverCm > 0 ? `，死亡覆盖 ${summary.deadCoverCm} cm（死亡覆盖率 ${summary.deadCoveragePct}%）` : ''
  if (summary.bleachIndex === null) {
    return `样带珊瑚全部死亡：活珊瑚覆盖率 0%，死亡覆盖 ${summary.deadCoverCm} cm（死亡覆盖率 ${summary.deadCoveragePct}%），不参与礁区白化指数`
  }
  if (summary.grade === '无') {
    return `活珊瑚覆盖率 ${summary.liveCoveragePct}%（活珊瑚覆盖 ${summary.liveCoverCm} cm）${deadPart}，未见白化`
  }
  return `活珊瑚覆盖率 ${summary.liveCoveragePct}%（活珊瑚覆盖 ${summary.liveCoverCm} cm）${deadPart}，白化指数 ${summary.bleachIndex}（${summary.grade}，0 ~ 3），白化占比 ${summary.bleachedSharePct}%`
}

/** 按礁区汇总：站位/样带数量、平均白化指数与总体等级（无珊瑚记录样带不进平均） */
export interface ReefSummary {
  reefId: string
  reefName: string
  protectStatus: string
  siteCount: number
  beltCount: number
  /** 有珊瑚记录、参与白化评定的样带数 */
  assessedBeltCount: number
  /** 全死亡样带数 */
  allDeadBeltCount: number
  coralCount: number
  /** 全部珊瑚覆盖长度合计（含死亡，cm） */
  coverCmTotal: number
  /** 活珊瑚覆盖长度（cm） */
  liveCoverCm: number
  /** 死亡珊瑚覆盖长度（cm） */
  deadCoverCm: number
  /** 平均白化指数 0 ~ 3；无参评样带为 null */
  avgBleachIndex: number | null
  /** 总体等级；无参评样带为 null，参评样带全部死亡为「死亡」 */
  grade: BleachLevel | null
  fishTotal: number
}

export function buildReefSummaries(payload: BackupPayload, lines: CoverageLine[]): ReefSummary[] {
  return payload.reefs.map((reef) => {
    const siteIds = new Set(payload.sites.filter((site) => site.reefId === reef.id).map((site) => site.id))
    const beltIds = new Set(payload.belts.filter((belt) => siteIds.has(belt.siteId)).map((belt) => belt.id))
    const corals = payload.corals.filter((coral) => beltIds.has(coral.beltId))
    const lines4Reef = lines.filter((line) => line.reefId === reef.id)
    const aggregate = aggregateBleach(
      lines4Reef.map((line) => ({ hasRecords: line.coralCount > 0, bleachIndex: line.bleachIndex }))
    )
    const deadCoverCm = round(
      corals.filter((coral) => coral.bleachLevel === '死亡').reduce((sum, coral) => sum + coral.coverCm, 0),
      1
    )
    const coverCmTotal = round(
      corals.reduce((sum, coral) => sum + coral.coverCm, 0),
      1
    )
    return {
      reefId: reef.id,
      reefName: reef.name,
      protectStatus: reef.protectStatus,
      siteCount: siteIds.size,
      beltCount: beltIds.size,
      assessedBeltCount: aggregate.assessedBeltCount,
      allDeadBeltCount: aggregate.allDeadBeltCount,
      coralCount: corals.length,
      coverCmTotal,
      liveCoverCm: round(coverCmTotal - deadCoverCm, 1),
      deadCoverCm,
      avgBleachIndex: aggregate.avgBleachIndex,
      grade: aggregate.grade,
      fishTotal: payload.fishes
        .filter((fish) => beltIds.has(fish.beltId))
        .reduce((sum, fish) => sum + fish.count, 0)
    }
  })
}
