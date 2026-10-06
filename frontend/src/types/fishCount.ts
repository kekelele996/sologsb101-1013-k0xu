/** 计数类别：鱼类 / 无脊椎动物 */
export type CountCategory = '鱼类' | '无脊椎动物'

export const COUNT_CATEGORIES: CountCategory[] = ['鱼类', '无脊椎动物']

/** 体长段 */
export type SizeClass = '0-10cm' | '11-20cm' | '21-30cm' | '>30cm'

export const SIZE_CLASSES: SizeClass[] = ['0-10cm', '11-20cm', '21-30cm', '>30cm']

/** 鱼类与无脊椎动物计数记录 */
export interface FishCount {
  id: string
  /** 所属样带 */
  beltId: string
  /** 科名，如 雀鲷科 */
  family: string
  /** 数量（尾 / 个） */
  count: number
  /** 体长段 */
  sizeClass: SizeClass
  /** 类别 */
  category: CountCategory
  createdAt: number
  updatedAt: number
}

/** 计数草稿（存于 surveyStore） */
export interface FishDraft {
  family: string
  count: number
  sizeClass: SizeClass
  category: CountCategory
}

export function createEmptyFishDraft(): FishDraft {
  return {
    family: '',
    count: 1,
    sizeClass: '11-20cm',
    category: '鱼类'
  }
}

/** 常见科名（表单联想用，按类别分组） */
export const COMMON_FAMILIES: Record<CountCategory, string[]> = {
  鱼类: ['雀鲷科', '蝴蝶鱼科', '隆头鱼科', '鹦嘴鱼科', '刺尾鱼科', '石斑鱼科', '笛鲷科', '篮子鱼科'],
  无脊椎动物: ['海胆科', '海参科', '法螺科', '砗磲科', '龙虾科', '海星科']
}

/**
 * 解析批量粘贴文本：每行「科名,数量,体长段[,类别]」。
 */
export function parseFishPaste(text: string): {
  rows: Array<{ family: string; count: number; sizeClass: SizeClass; category: CountCategory }>
  errors: string[]
} {
  const rows: Array<{ family: string; count: number; sizeClass: SizeClass; category: CountCategory }> = []
  const errors: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  lines.forEach((line, index) => {
    const cells = line.split(/[,，\t;；]+/).map((cell) => cell.trim())
    if (cells.length < 3) {
      errors.push(`第 ${index + 1} 行「${line}」至少需要「科名,数量,体长段」三列`)
      return
    }
    const count = Number(cells[1])
    if (!Number.isInteger(count) || count < 0) {
      errors.push(`第 ${index + 1} 行数量应为非负整数`)
      return
    }
    const sizeClass = cells[2] as SizeClass
    if (!SIZE_CLASSES.includes(sizeClass)) {
      errors.push(`第 ${index + 1} 行体长段「${cells[2]}」不在 ${SIZE_CLASSES.join(' / ')} 之内`)
      return
    }
    const category = (cells.length >= 4 ? cells[3] : '鱼类') as CountCategory
    if (!COUNT_CATEGORIES.includes(category)) {
      errors.push(`第 ${index + 1} 行类别「${cells[3]}」不在 ${COUNT_CATEGORIES.join(' / ')} 之内`)
      return
    }
    rows.push({ family: cells[0], count, sizeClass, category })
  })
  return { rows, errors }
}
