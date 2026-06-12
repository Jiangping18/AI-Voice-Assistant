/**
 * GraphRenderer - 基于 AntV G6 的知识图谱渲染器
 *
 * 职责：
 * 1. 初始化 G6 画布和力导向布局
 * 2. 渲染节点（人物圆形、事件方形、对话菱形，不同颜色）
 * 3. 渲染边（关系类型不同颜色，悬停高亮）
 * 4. 注册交互事件（缩放、平移、拖拽、点击详情）
 *
 * 使用方式：
 *   const renderer = new GraphRenderer('container-id')
 *   renderer.render(data)
 *   renderer.on('node:click', handler)
 */

import type { GraphData, GraphNode, GraphEdge, NodeDetail } from './types'
import {
  NODE_SHAPE,
  NODE_COLOR,
  NODE_LABEL_COLOR,
  EDGE_COLOR,
  EDGE_COLOR_DEFAULT,
  EDGE_WIDTH,
  EDGE_WIDTH_HOVER,
  LAYOUT_CONFIG,
  CANVAS_CONFIG,
  SEARCH_HIGHLIGHT_COLOR,
  SEARCH_HIGHLIGHT_BORDER,
} from './GraphConfig'

// G6 类型声明（从 CDN 加载，无 TS 类型时使用 any）
declare const G6: any

// ============================
// 事件类型
// ============================

export type GraphEventType = 'node:click' | 'node:hover' | 'edge:hover' | 'canvas:click'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (event: any) => void

// ============================
// 渲染器
// ============================

export class GraphRenderer {
  private _container: HTMLElement | null = null
  private _graph: any = null
  private _listeners: Map<GraphEventType, Set<EventHandler>> = new Map()
  private _currentData: GraphData = { nodes: [], edges: [] }
  private _searchKeyword: string = ''
  private _highlightedNodes: Set<string> = new Set()

  // ============================
  // 生命周期
  // ============================

  /**
   * @param containerId 容器 DOM 元素的 ID
   */
  constructor(containerId: string) {
    this._container = document.getElementById(containerId)
    if (!this._container) {
      throw new Error(`[GraphRenderer] 未找到容器元素: #${containerId}`)
    }
  }

  /** 销毁画布 */
  destroy(): void {
    if (this._graph) {
      this._graph.destroy()
      this._graph = null
    }
    this._listeners.clear()
  }

  // ============================
  // 渲染
  // ============================

  /**
   * 渲染图谱数据
   * @param data 图数据
   */
  render(data: GraphData): void {
    this._currentData = data
    if (!this._graph) {
      this._initGraph()
    }
    this._graph.changeData(this._toG6Data(data))
    this._graph.fitView(40)
  }

  /**
   * 增量更新（仅更新变化的节点和边，不触发全量重排）
   * @param data 新数据
   */
  updateData(data: GraphData): void {
    this._currentData = data
    if (this._graph) {
      // 使用 G6 的 changeData 方法做增量更新
      this._graph.changeData(this._toG6Data(data))
    }
  }

  /** 适应画布 */
  fitView(padding?: number): void {
    if (this._graph) {
      this._graph.fitView(padding || 40)
    }
  }

  /** 缩放到实际大小 */
  zoomToReal(): void {
    if (this._graph) {
      this._graph.zoomTo(1)
    }
  }

  // ============================
  // 搜索与高亮
  // ============================

  /**
   * 按关键词搜索并高亮节点
   * @param keyword 搜索关键词
   * @returns 匹配的节点 ID 列表
   */
  search(keyword: string): string[] {
    this._searchKeyword = keyword
    this._clearHighlight()

    if (!keyword.trim()) {
      return []
    }

    const lowerKeyword = keyword.toLowerCase()
    const matchedIds: string[] = []

    this._currentData.nodes.forEach((node) => {
      const matchesLabel = node.label.toLowerCase().includes(lowerKeyword)
      const matchesProps = Object.values(node.properties).some(
        (v) => typeof v === 'string' && v.toLowerCase().includes(lowerKeyword),
      )

      if (matchesLabel || matchesProps) {
        matchedIds.push(node.id)
      }
    })

    this._highlightNodes(matchedIds)
    return matchedIds
  }

  /** 清除高亮 */
  clearSearchHighlight(): void {
    this._searchKeyword = ''
    this._clearHighlight()
  }

  // ============================
  // 筛选
  // ============================

  /**
   * 高亮显示指定节点及其边（用于人物筛选时的子图强调）
   * @param nodeIds 要高亮的节点 ID 集合
   */
  highlightSubGraph(nodeIds: Set<string>): void {
    if (!this._graph) return

    // 将所有节点和边设为半透明，只有指定节点和其连接边保持不透明
    this._graph.getNodes().forEach((node: any) => {
      const model = node.getModel()
      if (nodeIds.has(model.id)) {
        node.update({ style: { opacity: 1, labelCfg: { style: { opacity: 1 } } } })
      } else {
        node.update({ style: { opacity: 0.15, labelCfg: { style: { opacity: 0.15 } } } })
      }
    })

    this._graph.getEdges().forEach((edge: any) => {
      const model = edge.getModel()
      if (nodeIds.has(model.source) && nodeIds.has(model.target)) {
        edge.update({ style: { opacity: 1, lineWidth: EDGE_WIDTH } })
      } else {
        edge.update({ style: { opacity: 0.1, lineWidth: 0.5 } })
      }
    })
  }

  /** 重置所有节点/边的不透明度 */
  resetOpacity(): void {
    if (!this._graph) return
    this._graph.getNodes().forEach((node: any) => {
      node.update({ style: { opacity: 1, labelCfg: { style: { opacity: 1 } } } })
    })
    this._graph.getEdges().forEach((edge: any) => {
      edge.update({ style: { opacity: 1, lineWidth: EDGE_WIDTH } })
    })
  }

  // ============================
  // 事件
  // ============================

  on(eventType: GraphEventType, handler: EventHandler): void {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, new Set())
    }
    this._listeners.get(eventType)!.add(handler)
  }

  off(eventType: GraphEventType, handler: EventHandler): void {
    this._listeners.get(eventType)?.delete(handler)
  }

  /** 点击节点时获取详情数据 */
  getNodeDetail(nodeId: string): NodeDetail | null {
    const node = this._currentData.nodes.find((n) => n.id === nodeId)
    if (!node) return null

    const relationships = this._currentData.edges
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => {
        const otherId = e.source === nodeId ? e.target : e.source
        const other = this._currentData.nodes.find((n) => n.id === otherId)
        return {
          targetLabel: other?.label || otherId,
          relation: e.relation,
        }
      })

    const relatedConversations = this._currentData.edges
      .filter((e) => (e.source === nodeId || e.target === nodeId) && e.relation === '提及')
      .map((e) => {
        const convId = e.source === nodeId ? e.target : e.source
        const conv = this._currentData.nodes.find((n) => n.id === convId)
        return conv?.label || convId
      })

    const relatedEvents = this._currentData.edges
      .filter((e) => (e.source === nodeId || e.target === nodeId) && e.relation === '参与')
      .map((e) => {
        const eventId = e.source === nodeId ? e.target : e.source
        const event = this._currentData.nodes.find((n) => n.id === eventId)
        return event?.label || eventId
      })

    return { node, relatedConversations, relatedEvents, relationships }
  }

  // ============================
  // 截图
  // ============================

  /** 导出画布为 PNG DataURL */
  toPNG(): string {
    if (!this._graph) return ''
    return this._graph.toDataURL('image/png')
  }

  // ============================
  // 内部方法
  // ============================

  /** 初始化 G6 画布 */
  private _initGraph(): void {
    if (!this._container) return

    const { width, height } = this._container.getBoundingClientRect()

    this._graph = new G6.Graph({
      container: this._container,
      width: width || 800,
      height: height || 600,
      ...CANVAS_CONFIG,
      layout: { ...LAYOUT_CONFIG },
      defaultNode: {
        type: 'circle',
        style: {
          fill: NODE_COLOR.person,
          stroke: '#FFFFFF',
          lineWidth: 2,
          cursor: 'pointer',
        },
        labelCfg: {
          style: {
            fill: '#333',
            fontSize: 12,
            fontWeight: 500,
            offset: [0, 8],
          },
          position: 'bottom',
        },
      },
      defaultEdge: {
        type: 'quadratic',
        style: {
          stroke: EDGE_COLOR_DEFAULT,
          lineWidth: EDGE_WIDTH,
          endArrow: {
            path: G6.Arrow.triangle(6, 8, 0),
            fill: EDGE_COLOR_DEFAULT,
          },
          cursor: 'pointer',
        },
        labelCfg: {
          style: {
            fill: '#666',
            fontSize: 10,
            background: {
              fill: '#FFFFFF',
              padding: [2, 4],
              radius: 2,
            },
          },
        },
      },
      modes: {
        default: [
          'drag-canvas',   // 平移
          'zoom-canvas',   // 缩放
          'drag-node',     // 拖拽节点
          'click-select',  // 点击选中
        ],
      },
    })

    // 注册节点样式处理器
    this._graph.node((node: any) => this._nodeStyle(node))

    // 注册边样式处理器
    this._graph.edge((edge: any) => this._edgeStyle(edge))

    // ---- 注册交互事件 ----

    // 节点点击
    this._graph.on('node:click', (e: any) => {
      const nodeId = e.item?.getModel()?.id
      if (nodeId) {
        this._emit('node:click', { nodeId, originalEvent: e })
      }
    })

    // 节点悬停
    this._graph.on('node:mouseenter', (e: any) => {
      const node = e.item
      if (node) {
        const model = node.getModel()
        // 放大节点
        node.update({
          style: {
            lineWidth: 3,
            shadowBlur: 10,
            shadowColor: 'rgba(0,0,0,0.2)',
          },
        })
        this._emit('node:hover', { nodeId: model.id })
      }
    })

    this._graph.on('node:mouseleave', (e: any) => {
      const node = e.item
      if (node) {
        node.update({
          style: {
            lineWidth: 2,
            shadowBlur: 0,
            shadowColor: 'transparent',
          },
        })
      }
    })

    // 边悬停高亮
    this._graph.on('edge:mouseenter', (e: any) => {
      const edge = e.item
      if (edge) {
        edge.update({ style: { lineWidth: EDGE_WIDTH_HOVER, shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.15)' } })
        this._emit('edge:hover', { edgeId: edge.getModel()?.id })
      }
    })

    this._graph.on('edge:mouseleave', (e: any) => {
      const edge = e.item
      if (edge) {
        edge.update({ style: { lineWidth: EDGE_WIDTH, shadowBlur: 0, shadowColor: 'transparent' } })
      }
    })

    // 点击空白取消选中
    this._graph.on('canvas:click', () => {
      this._graph?.setItemState(this._graph.getNodes(), 'selected', false)
      this._emit('canvas:click', {})
    })

    // 窗口 resize 自适应
    this._handleResize = this._handleResize.bind(this)
    window.addEventListener('resize', this._handleResize)
  }

  /** Resize 处理 */
  private _handleResize: (() => void) | null = null

  private _onResize(): void {
    if (!this._graph || !this._container) return
    const { width, height } = this._container.getBoundingClientRect()
    if (width > 0 && height > 0) {
      this._graph.changeSize(width, height)
    }
  }

  /** 节点样式工厂 */
  private _nodeStyle(node: { id: string; type: string; label: string; properties: Record<string, unknown> }): any {
    const nodeType = (node.type || 'person') as keyof typeof NODE_SHAPE
    const shape = NODE_SHAPE[nodeType] || 'circle'
    const fill = NODE_COLOR[nodeType] || NODE_COLOR.person
    const labelFill = NODE_LABEL_COLOR[nodeType] || '#333'
    const size = NODE_SIZE[nodeType] || 36

    const style: any = {
      type: shape,
      style: {
        fill,
        stroke: '#FFFFFF',
        lineWidth: 2,
        cursor: 'pointer',
        ...(shape === 'rect' ? { width: size * 1.8, height: size } : { r: size / 2 }),
      },
      labelCfg: {
        style: {
          fill: labelFill,
          fontSize: 12,
          fontWeight: 500,
          offset: [0, shape === 'circle' ? size / 2 + 6 : size / 2 + 6],
        },
        position: shape === 'diamond' ? 'bottom' : 'bottom',
      },
    }

    return style
  }

  /** 边样式工厂 */
  private _edgeStyle(edge: { source: string; target: string; relation: string }): any {
    const color = EDGE_COLOR[edge.relation] || EDGE_COLOR_DEFAULT

    return {
      style: {
        stroke: color,
        lineWidth: EDGE_WIDTH,
        endArrow: {
          path: G6.Arrow.triangle(6, 8, 0),
          fill: color,
        },
      },
      label: edge.relation,
      labelCfg: {
        style: {
          fill: color,
          fontSize: 10,
          fontWeight: 400,
          background: {
            fill: '#FFFFFF',
            padding: [2, 4],
            radius: 2,
          },
        },
        autoRotate: true,
      },
    }
  }

  /** 转换数据为 G6 格式 */
  private _toG6Data(data: GraphData): any {
    return {
      nodes: data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        properties: n.properties,
        x: n.x,
        y: n.y,
        ...this._nodeStyle(n),
      })),
      edges: data.edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
        properties: e.properties,
        label: e.relation,
        ...this._edgeStyle(e),
      })),
    }
  }

  /** 搜索高亮节点 */
  private _highlightNodes(nodeIds: string[]): void {
    if (!this._graph) return

    this._highlightedNodes = new Set(nodeIds)

    this._graph.getNodes().forEach((node: any) => {
      const model = node.getModel()
      if (nodeIds.includes(model.id)) {
        node.update({
          style: {
            fill: SEARCH_HIGHLIGHT_COLOR,
            stroke: SEARCH_HIGHLIGHT_BORDER,
            lineWidth: 3,
            shadowBlur: 12,
            shadowColor: 'rgba(250, 173, 20, 0.4)',
            opacity: 1,
          },
          labelCfg: {
            style: { opacity: 1, fontWeight: 700 },
          },
        })
      } else {
        node.update({
          style: { opacity: 0.2 },
          labelCfg: {
            style: { opacity: 0.2 },
          },
        })
      }
    })

    this._graph.getEdges().forEach((edge: any) => {
      const model = edge.getModel()
      if (nodeIds.includes(model.source) && nodeIds.includes(model.target)) {
        edge.update({ style: { opacity: 1, lineWidth: EDGE_WIDTH_HOVER } })
      } else {
        edge.update({ style: { opacity: 0.1, lineWidth: 0.5 } })
      }
    })
  }

  /** 清除搜索高亮 */
  private _clearHighlight(): void {
    if (!this._graph) return
    this._highlightedNodes.clear()
    this._graph.getNodes().forEach((node: any) => {
      const model = node.getModel()
      node.update({
        style: {
          fill: NODE_COLOR[model.type as keyof typeof NODE_COLOR] || NODE_COLOR.person,
          stroke: '#FFFFFF',
          lineWidth: 2,
          shadowBlur: 0,
          shadowColor: 'transparent',
          opacity: 1,
        },
        labelCfg: {
          style: { opacity: 1, fontWeight: 500 },
        },
      })
    })
    this._graph.getEdges().forEach((edge: any) => {
      edge.update({ style: { opacity: 1, lineWidth: EDGE_WIDTH } })
    })
  }

  /** 事件发射 */
  private _emit(type: GraphEventType, data: any): void {
    this._listeners.get(type)?.forEach((handler) => {
      try {
        handler(data)
      } catch (e) {
        console.error(`[GraphRenderer] 事件处理器异常 (${type}):`, e)
      }
    })
  }
}
