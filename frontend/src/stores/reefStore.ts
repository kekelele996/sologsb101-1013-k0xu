/**
 * 礁区 store：维护礁区与站位列表、当前选中站位与筛选条件。
 * 数据经 utils/db.ts 的 Dexie liveQuery 订阅，页面只读消费。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db, createId, readLastReefId, watchTable, writeLastReefId } from '@/utils/db'
import type { Reef, ReefFilterState } from '@/types/reef'
import { createEmptyReefFilter } from '@/types/reef'
import type { Site, SiteFilterState } from '@/types/site'
import { createEmptySiteFilter } from '@/types/site'
import { bleachIndex, round } from '@/utils/bleach'

export const useReefStore = defineStore('reef', () => {
  const reefs = ref<Reef[]>([])
  const sites = ref<Site[]>([])
  const ready = ref(false)
  const error = ref<string | null>(null)
  const currentReefId = ref<string | null>(readLastReefId())
  const currentSiteId = ref<string | null>(null)
  const filter = ref<ReefFilterState>(createEmptyReefFilter())
  const siteFilter = ref<SiteFilterState>(createEmptySiteFilter())

  let started = false

  function start(): void {
    if (started) return
    started = true
    watchTable<Reef>(() => db.reefs).subscribe((rows) => {
      reefs.value = rows
      ready.value = true
      error.value = null
      if (currentReefId.value === null && rows.length > 0) selectReef(rows[0].id)
    })
    watchTable<Site>(() => db.sites).subscribe((rows) => {
      sites.value = rows
    })
  }

  const currentReef = computed<Reef | null>(
    () => reefs.value.find((reef) => reef.id === currentReefId.value) ?? null
  )

  const currentSite = computed<Site | null>(
    () => sites.value.find((site) => site.id === currentSiteId.value) ?? null
  )

  /** 某礁区下的站位（按站位编号排序） */
  function sitesOfReef(reefId: string | null | undefined): Site[] {
    if (!reefId) return []
    return sites.value
      .filter((site) => site.reefId === reefId)
      .sort((a, b) => a.no.localeCompare(b.no, 'zh-Hans-CN'))
  }

  /** 按筛选条件过滤后的礁区 */
  const filteredReefs = computed<Reef[]>(() =>
    reefs.value.filter((reef) => {
      const keyword = filter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${reef.name}${reef.location}${reef.manager}${reef.protectStatus}`
        if (!haystack.includes(keyword)) return false
      }
      if (filter.value.protectStatuses.length > 0 && !filter.value.protectStatuses.includes(reef.protectStatus)) {
        return false
      }
      if (filter.value.minAreaKm2 !== null && reef.areaKm2 < filter.value.minAreaKm2) return false
      if (filter.value.maxAreaKm2 !== null && reef.areaKm2 > filter.value.maxAreaKm2) return false
      return true
    })
  )

  /** 按筛选条件过滤后的站位 */
  const filteredSites = computed<Site[]>(() =>
    sites.value.filter((site) => {
      const keyword = siteFilter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${site.no}${site.substrate}`
        if (!haystack.includes(keyword)) return false
      }
      if (siteFilter.value.minDepthM !== null && site.depthM < siteFilter.value.minDepthM) return false
      if (siteFilter.value.maxDepthM !== null && site.depthM > siteFilter.value.maxDepthM) return false
      return true
    })
  )

  const hasFilter = computed<boolean>(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.protectStatuses.length > 0 ||
      filter.value.minAreaKm2 !== null ||
      filter.value.maxAreaKm2 !== null
  )

  /** 礁区 id → 站位数与总面积 */
  const reefStats = computed<Record<string, { siteCount: number; areaKm2: number }>>(() => {
    const stats: Record<string, { siteCount: number; areaKm2: number }> = {}
    reefs.value.forEach((reef) => {
      stats[reef.id] = {
        siteCount: sites.value.filter((site) => site.reefId === reef.id).length,
        areaKm2: reef.areaKm2
      }
    })
    return stats
  })

  function patchFilter(patch: Partial<ReefFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyReefFilter()
  }

  function patchSiteFilter(patch: Partial<SiteFilterState>): void {
    siteFilter.value = { ...siteFilter.value, ...patch }
  }

  function resetSiteFilter(): void {
    siteFilter.value = createEmptySiteFilter()
  }

  function selectReef(id: string | null): void {
    currentReefId.value = id
    writeLastReefId(id)
  }

  function selectSite(id: string | null): void {
    currentSiteId.value = id
  }

  function reefById(id: string | null | undefined): Reef | null {
    if (!id) return null
    return reefs.value.find((reef) => reef.id === id) ?? null
  }

  function siteById(id: string | null | undefined): Site | null {
    if (!id) return null
    return sites.value.find((site) => site.id === id) ?? null
  }

  /* ------------------------------- 礁区 ------------------------------- */

  async function createReef(payload: Omit<Reef, 'id' | 'createdAt' | 'updatedAt'>): Promise<Reef> {
    const now = Date.now()
    const row: Reef = { ...payload, id: createId('reef'), createdAt: now, updatedAt: now }
    await db.reefs.put(row)
    return row
  }

  async function updateReef(id: string, patch: Partial<Reef>): Promise<void> {
    await db.reefs.update(id, { ...patch, updatedAt: Date.now() } as never)
  }

  /** 删除礁区：级联删除其站位、样带、珊瑚记录与鱼类计数 */
  async function removeReef(id: string): Promise<void> {
    await db.transaction('rw', [db.reefs, db.sites, db.belts, db.corals, db.fishes], async () => {
      const siteIds = (await db.sites.where('reefId').equals(id).toArray()).map((row) => row.id)
      if (siteIds.length > 0) {
        const beltIds = (await db.belts.where('siteId').anyOf(siteIds).toArray()).map((row) => row.id)
        if (beltIds.length > 0) {
          await db.corals.where('beltId').anyOf(beltIds).delete()
          await db.fishes.where('beltId').anyOf(beltIds).delete()
          await db.belts.bulkDelete(beltIds)
        }
        await db.sites.bulkDelete(siteIds)
      }
      await db.reefs.delete(id)
    })
    if (currentReefId.value === id) selectReef(null)
  }

  /* ------------------------------- 站位 ------------------------------- */

  async function createSite(payload: Omit<Site, 'id' | 'createdAt' | 'updatedAt'>): Promise<Site> {
    const now = Date.now()
    const row: Site = { ...payload, id: createId('site'), createdAt: now, updatedAt: now }
    await db.sites.put(row)
    return row
  }

  async function updateSite(id: string, patch: Partial<Site>): Promise<void> {
    await db.sites.update(id, { ...patch, updatedAt: Date.now() } as never)
  }

  /** 删除站位：级联删除其样带、珊瑚记录与鱼类计数 */
  async function removeSite(id: string): Promise<void> {
    await db.transaction('rw', [db.sites, db.belts, db.corals, db.fishes], async () => {
      const beltIds = (await db.belts.where('siteId').equals(id).toArray()).map((row) => row.id)
      if (beltIds.length > 0) {
        await db.corals.where('beltId').anyOf(beltIds).delete()
        await db.fishes.where('beltId').anyOf(beltIds).delete()
        await db.belts.bulkDelete(beltIds)
      }
      await db.sites.delete(id)
    })
    if (currentSiteId.value === id) selectSite(null)
  }

  /** 站位 id → 样带数与平均白化指数（列表回显用） */
  async function siteBleachAverages(): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const site of sites.value) {
      const beltIds = (await db.belts.where('siteId').equals(site.id).toArray()).map((row) => row.id)
      if (beltIds.length === 0) {
        result[site.id] = 0
        continue
      }
      const corals = await db.corals.where('beltId').anyOf(beltIds).toArray()
      result[site.id] = round(bleachIndex(corals), 2)
    }
    return result
  }

  return {
    reefs,
    sites,
    ready,
    error,
    currentReefId,
    currentReef,
    currentSiteId,
    currentSite,
    filter,
    siteFilter,
    filteredReefs,
    filteredSites,
    hasFilter,
    reefStats,
    start,
    sitesOfReef,
    patchFilter,
    resetFilter,
    patchSiteFilter,
    resetSiteFilter,
    selectReef,
    selectSite,
    reefById,
    siteById,
    createReef,
    updateReef,
    removeReef,
    createSite,
    updateSite,
    removeSite,
    siteBleachAverages
  }
})
