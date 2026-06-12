/**
 * GraphService - 图数据服务层
 *
 * 职责：
 * 1. 封装与智能体5的 GraphService.queryTriples(filters) 通信
 * 2. 提供模拟数据（开发阶段）或 WebSocket 推送订阅
 * 3. 缓存管理、增量更新合并
 *
 * 调用方式（与智能体5的接口协议）：
 *   GraphService.queryTriples(filters: GraphFilters): GraphData
 */

import type { GraphData, GraphFilters, GraphNode, GraphEdge, DataUpdateEvent } from './types'

// ============================
// 模拟数据 - 开发阶段使用
// ============================

/**
 * 生成模拟知识图谱数据
 * 包含：人物、事件、对话三类节点及其关系
 */
function generateMockData(): GraphData {
  const now = new Date()
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()

  // ---- 人物节点 ----
  const persons: GraphNode[] = [
    { id: 'p1', type: 'person', label: '张三', properties: { role: '项目经理', first_seen: daysAgo(30) } },
    { id: 'p2', type: 'person', label: '李四', properties: { role: '前端开发', first_seen: daysAgo(28) } },
    { id: 'p3', type: 'person', label: '王五', properties: { role: '后端开发', first_seen: daysAgo(25) } },
    { id: 'p4', type: 'person', label: '赵六', properties: { role: '测试工程师', first_seen: daysAgo(20) } },
    { id: 'p5', type: 'person', label: '陈七', properties: { role: '产品经理', first_seen: daysAgo(15) } },
    { id: 'p6', type: 'person', label: '刘八', properties: { role: 'UI设计师', first_seen: daysAgo(10) } },
  ]

  // ---- 事件节点 ----
  const events: GraphNode[] = [
    { id: 'e1', type: 'event', label: '需求评审会', properties: { date: daysAgo(14), summary: '讨论 v2.0 新功能需求，确定优先级' } },
    { id: 'e2', type: 'event', label: '技术方案评审', properties: { date: daysAgo(10), summary: '确定微服务拆分方案和数据库选型' } },
    { id: 'e3', type: 'event', label: 'Sprint 规划会', properties: { date: daysAgo(7), summary: '分配 v2.0 开发任务，排期 4 周' } },
    { id: 'e4', type: 'event', label: '代码审查', properties: { date: daysAgo(3), summary: 'Review 用户模块 PR，提出 5 个改进点' } },
    { id: 'e5', type: 'event', label: '线上故障排查', properties: { date: daysAgo(1), summary: '修复生产环境 OOM 问题，定位为内存泄漏' } },
  ]

  // ---- 对话节点 ----
  const conversations: GraphNode[] = [
    { id: 'c1', type: 'conversation', label: '项目启动讨论', properties: { date: daysAgo(30), speaker_count: 3, summary: '讨论 v2.0 整体规划' } },
    { id: 'c2', type: 'conversation', label: '技术选型讨论', properties: { date: daysAgo(20), speaker_count: 2, summary: '对比 Go vs Java 微服务方案' } },
    { id: 'c3', type: 'conversation', label: 'Bug 复盘会议', properties: { date: daysAgo(5), speaker_count: 4, summary: '分析线上 Bug 根因' } },
  ]

  // ---- 关系边 ----
  const edges: GraphEdge[] = [
    // 人物 → 事件（参与关系）
    { source: 'p1', target: 'e1', relation: '参与', properties: { weight: 1.0 } },
    { source: 'p2', target: 'e1', relation: '参与', properties: { weight: 0.8 } },
    { source: 'p5', target: 'e1', relation: '参与', properties: { weight: 0.9 } },
    { source: 'p1', target: 'e2', relation: '参与', properties: { weight: 1.0 } },
    { source: 'p3', target: 'e2', relation: '参与', properties: { weight: 1.0 } },
    { source: 'p2', target: 'e3', relation: '参与', properties: { weight: 0.7 } },
    { source: 'p3', target: 'e3', relation: '参与', properties: { weight: 0.7 } },
    { source: 'p5', target: 'e3', relation: '参与', properties: { weight: 0.8 } },
    { source: 'p1', target: 'e4', relation: '参与', properties: { weight: 0.6 } },
    { source: 'p2', target: 'e4', relation: '参与', properties: { weight: 0.9 } },
    { source: 'p4', target: 'e4', relation: '参与', properties: { weight: 0.5 } },
    { source: 'p3', target: 'e5', relation: '参与', properties: { weight: 1.0 } },
    { source: 'p4', target: 'e5', relation: '参与', properties: { weight: 0.8 } },
    { source: 'p1', target: 'e5', relation: '参与', properties: { weight: 0.7 } },

    // 人物 → 对话（提及关系）
    { source: 'p1', target: 'c1', relation: '提及', properties: { weight: 0.6 } },
    { source: 'p2', target: 'c1', relation: '提及', properties: { weight: 0.5 } },
    { source: 'p3', target: 'c2', relation: '提及', properties: { weight: 0.8 } },
    { source: 'p2', target: 'c2', relation: '提及', properties: { weight: 0.7 } },
    { source: 'p1', target: 'c3', relation: '提及', properties: { weight: 0.9 } },
    { source: 'p3', target: 'c3', relation: '提及', properties: { weight: 0.6 } },
    { source: 'p4', target: 'c3', relation: '提及', properties: { weight: 0.7 } },

    // 事件 → 对话（触发关系）
    { source: 'e1', target: 'c1', relation: '触发', properties: { weight: 0.5 } },
    { source: 'e2', target: 'c2', relation: '触发', properties: { weight: 0.6 } },
    { source: 'e5', target: 'c3', relation: '触发', properties: { weight: 0.9 } },

    // 人物间关系（相关）
    { source: 'p1', target: 'p2', relation: '相关', properties: { weight: 0.4 } },
    { source: 'p1', target: 'p5', relation: '相关', properties: { weight: 0.5 } },
    { source: 'p1', target: 'p3', relation: '相关', properties: { weight: 0.3 } },
  ]

  return { nodes: [...persons, ...events, ...conversations], edges }
}

// ============================
// 服务实现
// ============================

type DataCallback = (event: DataUpdateEvent) => void

export class GraphService {
  /** 缓存的最新全量数据 */
  private _cache: GraphData = { nodes: [], edges: [] }
  /** 订阅者列表 */
  private _subscribers: Set<DataCallback> = new Set()
  /** 轮询定时器 */
  private _pollTimer: ReturnType<typeof setInterval> | null = null
  /** 模拟数据的版本号，用于增量更新模拟 */
  private _mockVersion = 0

  // ============================
  // 公开接口 - 与智能体5对齐
  // ============================

  /**
   * 查询三元组（智能体5标准接口）
   * @param filters 筛选条件
   * @returns 筛选后的图数据
   */
  async queryTriples(filters: GraphFilters = {}): Promise<GraphData> {
    // 模拟网络延迟
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200))

    let data = this._cache

    // 应用筛选
    if (filters.time_range || filters.person_id || filters.relation_type) {
      data = this._applyFilters(data, filters)
    }

    return data
  }

  /**
   * 获取某人为中心的局部子图（2层关系）
   * @param personId 人物ID
   * @param depth 关系深度
   */
  async getPersonGraph(personId: string, depth: number = 2): Promise<GraphData> {
    await new Promise((r) => setTimeout(r, 200))

    const allNodes = this._cache.nodes
    const allEdges = this._cache.edges

    // BFS 查找关联节点和边
    const visitedNodes = new Set<string>([personId])
    const resultEdges: GraphEdge[] = []
    let currentLevel = new Set<string>([personId])

    for (let d = 0; d < depth; d++) {
      const nextLevel = new Set<string>()
      for (const nodeId of currentLevel) {
        for (const edge of allEdges) {
          if (edge.source === nodeId && !visitedNodes.has(edge.target)) {
            nextLevel.add(edge.target)
            visitedNodes.add(edge.target)
            resultEdges.push(edge)
          } else if (edge.target === nodeId && !visitedNodes.has(edge.source)) {
            nextLevel.add(edge.source)
            visitedNodes.add(edge.source)
            resultEdges.push(edge)
          } else if (
            (edge.source === nodeId && visitedNodes.has(edge.target)) ||
            (edge.target === nodeId && visitedNodes.has(edge.source))
          ) {
            // 已访问节点之间的边也要包含
            resultEdges.push(edge)
          }
        }
      }
      currentLevel = nextLevel
    }

    // 补全所有涉及的边（不仅仅是BFS找到的，还包括visited节点之间的所有原始边）
    const allRelevantEdges = allEdges.filter(
      (e) => visitedNodes.has(e.source) && visitedNodes.has(e.target),
    )

    const resultNodes = allNodes.filter((n) => visitedNodes.has(n.id))

    return { nodes: resultNodes, edges: allRelevantEdges }
  }

  // ============================
  // 订阅/推送（对接智能体5的增量更新）
  // ============================

  /** 订阅数据更新 */
  subscribe(callback: DataCallback): () => void {
    this._subscribers.add(callback)
    return () => this._subscribers.delete(callback)
  }

  /** 取消订阅 */
  unsubscribe(callback: DataCallback): void {
    this._subscribers.delete(callback)
  }

  /** 启动轮询（模拟智能体5的推送） */
  startPolling(intervalMs: number = 30000): void {
    if (this._pollTimer) return
    this._pollTimer = setInterval(() => this._simulateUpdate(), intervalMs)
  }

  /** 停止轮询 */
  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  /** 手动刷新数据 */
  async refresh(): Promise<GraphData> {
    this._mockVersion++
    const data = this._generateIncrementalUpdate()
    this._cache = data
    this._notify({ type: 'full', timestamp: new Date().toISOString(), data })
    return data
  }

  // ============================
  // 初始化
  // ============================

  /** 初始化数据 */
  initialize(): void {
    this._cache = generateMockData()
    this._notify({ type: 'full', timestamp: new Date().toISOString(), data: this._cache })
  }

  // ============================
  // 内部方法
  // ============================

  /** 应用筛选条件 */
  private _applyFilters(data: GraphData, filters: GraphFilters): GraphData {
    let { nodes, edges } = data

    // 按人物筛选
    if (filters.person_id) {
      const personId = filters.person_id
      const connectedNodeIds = new Set<string>([personId])
      const filteredEdges = edges.filter(
        (e) => e.source === personId || e.target === personId,
      )
      filteredEdges.forEach((e) => {
        connectedNodeIds.add(e.source)
        connectedNodeIds.add(e.target)
      })
      nodes = nodes.filter((n) => connectedNodeIds.has(n.id))
      edges = filteredEdges
    }

    // 按时间范围筛选（仅筛选事件节点）
    if (filters.time_range) {
      const { start, end } = filters.time_range
      const startMs = new Date(start).getTime()
      const endMs = new Date(end).getTime()

      const timeFilteredNodeIds = new Set<string>()
      nodes.forEach((n) => {
        if (n.type === 'event') {
          const date = n.properties.date as string
          if (date) {
            const dateMs = new Date(date).getTime()
            if (dateMs >= startMs && dateMs <= endMs) {
              timeFilteredNodeIds.add(n.id)
            }
          }
        } else if (n.type === 'person' || n.type === 'conversation') {
          timeFilteredNodeIds.add(n.id)
        }
      })

      const filteredEdges = edges.filter(
        (e) => timeFilteredNodeIds.has(e.source) && timeFilteredNodeIds.has(e.target),
      )

      // 重新收集所有连接的节点
      const finalNodeIds = new Set<string>()
      filteredEdges.forEach((e) => {
        finalNodeIds.add(e.source)
        finalNodeIds.add(e.target)
      })

      nodes = nodes.filter((n) => finalNodeIds.has(n.id))
      edges = filteredEdges
    }

    // 按关系类型筛选
    if (filters.relation_type) {
      edges = edges.filter((e) => e.relation === filters.relation_type)
      const filteredNodeIds = new Set<string>()
      edges.forEach((e) => {
        filteredNodeIds.add(e.source)
        filteredNodeIds.add(e.target)
      })
      nodes = nodes.filter((n) => filteredNodeIds.has(n.id))
    }

    return { nodes, edges }
  }

  /** 生成增量更新数据（模拟） */
  private _generateIncrementalUpdate(): GraphData {
    // 保留原始数据，添加少量随机新节点/边
    if (this._mockVersion % 3 === 0) {
      const newEvent: GraphNode = {
        id: `e_new_${this._mockVersion}`,
        type: 'event',
        label: `新增事件 #${this._mockVersion}`,
        properties: { date: new Date().toISOString(), summary: `模拟新增事件 ${this._mockVersion}` },
      }
      const newEdge: GraphEdge = {
        source: 'p1',
        target: newEvent.id,
        relation: '参与',
        properties: { weight: 0.5 },
      }
      return {
        nodes: [...this._cache.nodes, newEvent],
        edges: [...this._cache.edges, newEdge],
      }
    }
    return this._cache
  }

  /** 通知所有订阅者 */
  private _notify(event: DataUpdateEvent): void {
    this._subscribers.forEach((cb) => {
      try {
        cb(event)
      } catch (e) {
        console.error('[GraphService] 订阅者回调异常:', e)
      }
    })
  }
}

/** 单例导出 */
export const graphService = new GraphService()
