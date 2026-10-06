/** 站位：礁区内的普查站位 */
export interface Site {
  id: string
  /** 所属礁区 */
  reefId: string
  /** 站位编号，如 S-01 */
  no: string
  /** 纬度（十进制度，-90 ~ 90） */
  lat: number
  /** 经度（十进制度，-180 ~ 180） */
  lng: number
  /** 水深（m） */
  depthM: number
  /** 底质类型 */
  substrate: string
  createdAt: number
  updatedAt: number
}

/** 站位列表页筛选条件（存于 reefStore） */
export interface SiteFilterState {
  keyword: string
  /** 水深区间下限（m） */
  minDepthM: number | null
  /** 水深区间上限（m） */
  maxDepthM: number | null
}

export function createEmptySiteFilter(): SiteFilterState {
  return {
    keyword: '',
    minDepthM: null,
    maxDepthM: null
  }
}

/** 底质常用取值 */
export const SUBSTRATES: string[] = ['珊瑚礁石', '礁砂', '砾石', '泥沙', '岩礁', '混合底质']

/** 经纬度格式校验：返回错误信息（为空表示通过） */
export function validateLatLng(lat: number, lng: number): string[] {
  const errors: string[] = []
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('纬度应在 -90 ~ 90 之间')
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('经度应在 -180 ~ 180 之间')
  return errors
}

/** 十进制度 → 度分秒文本，便于外业核对 */
export function formatLatLng(lat: number, lng: number): string {
  const toDms = (value: number, positive: string, negative: string): string => {
    const hemisphere = value >= 0 ? positive : negative
    const abs = Math.abs(value)
    const degree = Math.floor(abs)
    const minutesFloat = (abs - degree) * 60
    const minute = Math.floor(minutesFloat)
    const second = ((minutesFloat - minute) * 60).toFixed(1)
    return `${degree}°${minute}′${second}″${hemisphere}`
  }
  return `${toDms(lat, 'N', 'S')} ${toDms(lng, 'E', 'W')}`
}
