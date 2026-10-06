/** 保护区状态 */
export type ProtectStatus = '核心区' | '缓冲区' | '实验区' | '未设区'

export const PROTECT_STATUSES: ProtectStatus[] = ['核心区', '缓冲区', '实验区', '未设区']

/** 礁区：珊瑚礁普查的基本单元 */
export interface Reef {
  id: string
  /** 礁区名 */
  name: string
  /** 位置描述 */
  location: string
  /** 面积（km²） */
  areaKm2: number
  /** 保护区状态 */
  protectStatus: ProtectStatus
  /** 管理单位 */
  manager: string
  createdAt: number
  updatedAt: number
}

/** 礁区台账筛选条件（存于 reefStore，并同步 URL query） */
export interface ReefFilterState {
  keyword: string
  protectStatuses: ProtectStatus[]
  /** 面积下限（km²） */
  minAreaKm2: number | null
  /** 面积上限（km²） */
  maxAreaKm2: number | null
}

export function createEmptyReefFilter(): ReefFilterState {
  return {
    keyword: '',
    protectStatuses: [],
    minAreaKm2: null,
    maxAreaKm2: null
  }
}

/** 礁区面积分档，供筛选下拉使用 */
export const AREA_BUCKETS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: '全部面积', min: null, max: null },
  { label: '小于 5 km²', min: null, max: 5 },
  { label: '5 ~ 20 km²', min: 5, max: 20 },
  { label: '20 ~ 100 km²', min: 20, max: 100 },
  { label: '大于 100 km²', min: 100, max: null }
]
