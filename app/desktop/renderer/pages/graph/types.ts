/**
 * 知识图谱 - 核心类型定义
 *
 * 与智能体5（人物-事件关系三元组）的数据格式对齐
 */

// ============================
// 图节点类型
// ============================

/** 节点类型枚举 */
export type NodeType = 'person' | 'event' | 'conversation'

/** 图节点 */
export interface GraphNode {
  id: string
  type: NodeType
  label: string
  properties: Record<string, unknown>
  /** 节点在画布上的 x 坐标（布局引擎计算） */
  x?: number
  /** 节点在画布上的 y 坐标（布局引擎计算） */
  y?: number
}

// ============================
// 图边类型
// ============================

/** 关系类型 */
export type RelationType = '参与' | '提及' | '触发' | '相关' | string

/** 图边 */
export interface GraphEdge {
  source: string
  target: string
  relation: RelationType
  properties: Record<string, unknown>
}

// ============================
// 图数据（智能体5输出格式）
// ============================

/** 完整图数据 */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ============================
// 筛选与查询
// ============================

/** 筛选条件 */
export interface GraphFilters {
  time_range?: {
    start: string // ISO8601
    end: string // ISO8601
  }
  person_id?: string
  relation_type?: RelationType
  /** 搜索关键词：高亮匹配的节点 */
  keyword?: string
}

/** 查询结果统计 */
export interface GraphStats {
  nodeCount: number
  edgeCount: number
  personCount: number
  eventCount: number
  conversationCount: number
}

// ============================
// 节点详情
// ============================

/** 节点详情（点击弹窗展示） */
export interface NodeDetail {
  node: GraphNode
  relatedConversations: string[]
  relatedEvents: string[]
  relationships: Array<{
    targetLabel: string
    relation: RelationType
  }>
}

// ============================
// 导出格式
// ============================

/** 导出数据结构 */
export interface ExportData {
  version: string
  exportedAt: string
  filters: GraphFilters
  data: GraphData
  stats: GraphStats
}

// ============================
// 订阅事件
// ============================

/** 数据更新事件 */
export interface DataUpdateEvent {
  type: 'full' | 'incremental'
  timestamp: string
  data: GraphData
}
