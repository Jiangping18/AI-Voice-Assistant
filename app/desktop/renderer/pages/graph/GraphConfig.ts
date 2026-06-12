/**
 * GraphConfig - 图谱样式与布局配置
 */

import type { NodeType, RelationType } from './types'

// ============================
// 节点样式配置
// ============================

/** 节点类型 → 形状映射 */
export const NODE_SHAPE: Record<NodeType, string> = {
  person: 'circle',
  event: 'rect',
  conversation: 'diamond',
}

/** 节点类型 → 颜色映射 */
export const NODE_COLOR: Record<NodeType, string> = {
  person: '#1890FF',     // 人物 - 蓝色
  event: '#F5222D',      // 事件 - 红色
  conversation: '#52C41A', // 对话 - 绿色
}

/** 节点类型 → 标签颜色 */
export const NODE_LABEL_COLOR: Record<NodeType, string> = {
  person: '#333333',
  event: '#FFFFFF',
  conversation: '#333333',
}

/** 节点尺寸 */
export const NODE_SIZE: Record<NodeType, number> = {
  person: 36,
  event: 48,   // 矩形取宽
  conversation: 32,
}

// ============================
// 边样式配置
// ============================

/** 关系类型 → 颜色映射 */
export const EDGE_COLOR: Record<string, string> = {
  '参与': '#1890FF',
  '提及': '#722ED1',
  '触发': '#FA8C16',
  '相关': '#BFBFBF',
}

/** 默认边颜色 */
export const EDGE_COLOR_DEFAULT = '#BFBFBF'

/** 边宽度 */
export const EDGE_WIDTH = 1.5
export const EDGE_WIDTH_HOVER = 3

// ============================
// 布局配置
// ============================

/** 力导向布局参数 */
export const LAYOUT_CONFIG = {
  type: 'force',
  preventOverlap: true,
  nodeStrength: -200,
  edgeStrength: 0.1,
  linkDistance: 200,
  damping: 0.9,
  maxIteration: 500,
  minMovement: 0.5,
}

// ============================
// 画布配置
// ============================

export const CANVAS_CONFIG = {
  backgroundColor: '#F5F7FA',
  animation: true,
  fitView: true,
  fitViewPadding: [40, 40, 40, 40],
}

// ============================
// 搜索相关
// ============================

/** 搜索高亮颜色 */
export const SEARCH_HIGHLIGHT_COLOR = '#FFD666'
export const SEARCH_HIGHLIGHT_BORDER = '#FAAD14'

// ============================
// 筛选选项
// ============================

/** 时间范围筛选选项 */
export const TIME_RANGE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '最近1个月', value: '1m' },
  { label: '最近3个月', value: '3m' },
  { label: '最近6个月', value: '6m' },
] as const

/** 关系类型筛选选项 */
export const RELATION_TYPE_OPTIONS = [
  { label: '全部关系', value: '' },
  { label: '参与', value: '参与' },
  { label: '提及', value: '提及' },
  { label: '触发', value: '触发' },
  { label: '相关', value: '相关' },
] as const
