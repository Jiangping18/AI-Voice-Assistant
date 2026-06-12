/**
 * GraphPanel - 图谱面板组件
 *
 * 职责：
 * 1. 筛选控件（时间范围、人物、关系类型）
 * 2. 全局搜索
 * 3. 导出（PNG / JSON）
 * 4. 手动刷新
 * 5. 节点详情弹窗
 */

import { GraphRenderer } from './GraphRenderer'
import { graphService, GraphService } from './GraphService'
import type { GraphFilters, GraphData, NodeDetail, ExportData, GraphStats } from './types'
import {
  TIME_RANGE_OPTIONS,
  RELATION_TYPE_OPTIONS,
  NODE_COLOR,
  NODE_SHAPE,
} from './GraphConfig'

// ============================
// DOM 工具
// ============================

const $ = (selector: string, parent?: HTMLElement): HTMLElement | null =>
  (parent || document).querySelector(selector)

const $$ = (selector: string, parent?: HTMLElement): HTMLElement[] =>
  Array.from((parent || document).querySelectorAll(selector))

// ============================
// 面板类
// ============================

export class GraphPanel {
  private _renderer: GraphRenderer
  private _service: GraphService
  private _currentFilters: GraphFilters = {}
  private _currentData: GraphData = { nodes: [], edges: [] }
  private _currentStats: GraphStats = { nodeCount: 0, edgeCount: 0, personCount: 0, eventCount: 0, conversationCount: 0 }
  private _detailModal: HTMLElement | null = null
  private _lastSearchKeyword: string = ''
  private _unsubscribe: (() => void) | null = null

  constructor(renderer: GraphRenderer, service: GraphService) {
    this._renderer = renderer
    this._service = service
  }

  /** 初始化面板 */
  initialize(): void {
    this._renderDetailModal()
    this._bindSearch()
    this._bindTimeFilter()
    this._bindRelationFilter()
    this._bindPersonFilter()
    this._bindExportPNG()
    this._bindExportJSON()
    this._bindRefresh()
    this._bindKeyboard()

    // 点击节点显示详情
    this._renderer.on('node:click', ({ nodeId }: { nodeId: string }) => {
      this._showNodeDetail(nodeId)
    })

    // 订阅数据更新
    this._unsubscribe = this._service.subscribe((event) => {
      this._currentData = event.data
      this._updateStats(event.data)
      this._renderer.updateData(event.data)
    })
  }

  /** 销毁 */
  destroy(): void {
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = null
    }
  }

  /** 设置当前数据（由外部注入） */
  setData(data: GraphData): void {
    this._currentData = data
    this._updateStats(data)
  }

  // ============================
  // 筛选逻辑
  // ============================

  /** 应用所有当前筛选条件 */
  async applyFilters(): Promise<void> {
    let data = this._currentData

    // 按人物筛选
    if (this._currentFilters.person_id) {
      const personGraph = await this._service.getPersonGraph(this._currentFilters.person_id)
      data = personGraph
    }

    // 按时间范围筛选（在 service 端处理）
    if (this._currentFilters.time_range) {
      data = await this._service.queryTriples(this._currentFilters)
    }

    // 按关系类型筛选
    if (this._currentFilters.relation_type) {
      const filteredEdges = data.edges.filter(
        (e) => e.relation === this._currentFilters.relation_type,
      )
      const nodeIds = new Set<string>()
      filteredEdges.forEach((e) => {
        nodeIds.add(e.source)
        nodeIds.add(e.target)
      })
      data = {
        nodes: data.nodes.filter((n) => nodeIds.has(n.id)),
        edges: filteredEdges,
      }
    }

    this._renderer.render(data)
    this._updateStats(data)
  }

  // ============================
  // UI 绑定
  // ============================

  /** 搜索框 */
  private _bindSearch(): void {
    const input = $('#graph-search-input') as HTMLInputElement
    const clearBtn = $('#graph-search-clear')
    if (!input) return

    input.addEventListener('input', () => {
      this._lastSearchKeyword = input.value.trim()
      if (this._lastSearchKeyword) {
        const matched = this._renderer.search(this._lastSearchKeyword)
        this._updateSearchResultCount(matched.length)
      } else {
        this._renderer.clearSearchHighlight()
        this._updateSearchResultCount(0)
      }
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._lastSearchKeyword = input.value.trim()
        if (this._lastSearchKeyword) {
          const matched = this._renderer.search(this._lastSearchKeyword)
          this._updateSearchResultCount(matched.length)
        }
      }
    })

    clearBtn?.addEventListener('click', () => {
      input.value = ''
      this._lastSearchKeyword = ''
      this._renderer.clearSearchHighlight()
      this._updateSearchResultCount(0)
      input.focus()
    })
  }

  /** 时间范围筛选 */
  private _bindTimeFilter(): void {
    const select = $('#graph-filter-time') as HTMLSelectElement
    if (!select) return

    select.addEventListener('change', () => {
      const value = select.value
      if (value === 'all') {
        delete this._currentFilters.time_range
      } else {
        const months = parseInt(value.replace('m', ''), 10)
        const now = new Date()
        const start = new Date(now.getTime() - months * 30 * 86400000)
        this._currentFilters.time_range = {
          start: start.toISOString(),
          end: now.toISOString(),
        }
      }
      this.applyFilters()
    })
  }

  /** 关系类型筛选 */
  private _bindRelationFilter(): void {
    const select = $('#graph-filter-relation') as HTMLSelectElement
    if (!select) return

    select.addEventListener('change', () => {
      const value = select.value
      this._currentFilters.relation_type = value || undefined
      this.applyFilters()
    })
  }

  /** 人物筛选 */
  private _bindPersonFilter(): void {
    const select = $('#graph-filter-person') as HTMLSelectElement
    if (!select) return

    // 更新人物列表
    const updatePersonList = () => {
      const currentValue = select.value
      const persons = this._currentData.nodes.filter((n) => n.type === 'person')
      select.innerHTML = `
        <option value="">全部人物</option>
        ${persons.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
      `
      if (currentValue) select.value = currentValue
    }

    // 初始填充 + 数据更新时刷新
    updatePersonList()
    this._renderer.on('node:click', () => setTimeout(updatePersonList, 100))

    select.addEventListener('change', () => {
      const value = select.value
      this._currentFilters.person_id = value || undefined
      this.applyFilters()
    })
  }

  /** 导出 PNG */
  private _bindExportPNG(): void {
    const btn = $('#graph-export-png')
    btn?.addEventListener('click', () => {
      const dataUrl = this._renderer.toPNG()
      if (!dataUrl) return
      const link = document.createElement('a')
      link.download = `知识图谱_${new Date().toISOString().slice(0, 10)}.png`
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      this._showToast('PNG 导出成功')
    })
  }

  /** 导出 JSON */
  private _bindExportJSON(): void {
    const btn = $('#graph-export-json')
    btn?.addEventListener('click', () => {
      const exportData: ExportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        filters: this._currentFilters,
        data: this._currentData,
        stats: this._currentStats,
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `知识图谱数据_${new Date().toISOString().slice(0, 10)}.json`
      link.href = url
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      this._showToast('JSON 导出成功')
    })
  }

  /** 手动刷新 */
  private _bindRefresh(): void {
    const btn = $('#graph-refresh')
    btn?.addEventListener('click', async () => {
      btn.classList.add('loading')
      btn.setAttribute('disabled', 'true')
      try {
        await this._service.refresh()
        this._currentData = await this._service.queryTriples(this._currentFilters)
        this._renderer.render(this._currentData)
        this._updateStats(this._currentData)
        this._showToast('数据已刷新')
      } catch (e) {
        this._showToast('刷新失败，请重试', 'error')
      } finally {
        btn.classList.remove('loading')
        btn.removeAttribute('disabled')
      }
    })
  }

  /** 键盘快捷键 */
  private _bindKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      // Ctrl+F / Cmd+F → 聚焦搜索框
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const input = $('#graph-search-input') as HTMLInputElement
        input?.focus()
      }
      // Escape → 关闭详情弹窗
      if (e.key === 'Escape') {
        this._closeDetailModal()
      }
    })
  }

  // ============================
  // 节点详情弹窗
  // ============================

  private _renderDetailModal(): void {
    this._detailModal = document.createElement('div')
    this._detailModal.id = 'graph-detail-modal'
    this._detailModal.className = 'graph-modal'
    this._detailModal.style.display = 'none'
    this._detailModal.innerHTML = `
      <div class="graph-modal-content">
        <div class="graph-modal-header">
          <h3 id="graph-modal-title">节点详情</h3>
          <button id="graph-modal-close" class="graph-modal-close">&times;</button>
        </div>
        <div id="graph-modal-body" class="graph-modal-body"></div>
      </div>
    `
    document.body.appendChild(this._detailModal)

    // 关闭按钮
    $('#graph-modal-close', this._detailModal)?.addEventListener('click', () => this._closeDetailModal())
    // 点击外部关闭
    this._detailModal.addEventListener('click', (e) => {
      if (e.target === this._detailModal) this._closeDetailModal()
    })
  }

  private _showNodeDetail(nodeId: string): void {
    const detail = this._renderer.getNodeDetail(nodeId)
    if (!detail || !this._detailModal) return

    const { node, relatedConversations, relatedEvents, relationships } = detail
    const typeMap: Record<string, string> = { person: '人物', event: '事件', conversation: '对话' }
    const nodeColor = NODE_COLOR[node.type] || '#1890FF'

    const body = $('#graph-modal-body', this._detailModal)
    const title = $('#graph-modal-title', this._detailModal)!

    title.textContent = node.label
    title.style.borderLeftColor = nodeColor

    body!.innerHTML = `
      <div class="graph-detail-section">
        <span class="graph-detail-badge" style="background:${nodeColor}">${typeMap[node.type] || node.type}</span>
        <span class="graph-detail-id">ID: ${node.id}</span>
      </div>

      <div class="graph-detail-section">
        <h4>属性信息</h4>
        <table class="graph-detail-table">
          ${Object.entries(node.properties)
            .map(([key, value]) => `<tr><td>${key}</td><td>${String(value)}</td></tr>`)
            .join('')}
        </table>
      </div>

      <div class="graph-detail-section">
        <h4>关联关系 <span class="graph-detail-count">${relationships.length}</span></h4>
        <ul class="graph-detail-list">
          ${relationships
            .map(
              (r) =>
                `<li><span class="graph-relation-tag" style="border-color:${nodeColor}">${r.relation}</span> ${r.targetLabel}</li>`,
            )
            .join('')}
        </ul>
      </div>

      ${relatedEvents.length > 0 ? `
        <div class="graph-detail-section">
          <h4>关联事件 <span class="graph-detail-count">${relatedEvents.length}</span></h4>
          <ul class="graph-detail-list">
            ${relatedEvents.map((e) => `<li>${e}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${relatedConversations.length > 0 ? `
        <div class="graph-detail-section">
          <h4>关联对话 <span class="graph-detail-count">${relatedConversations.length}</span></h4>
          <ul class="graph-detail-list">
            ${relatedConversations.map((c) => `<li>${c}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `

    this._detailModal.style.display = 'flex'
  }

  private _closeDetailModal(): void {
    if (this._detailModal) {
      this._detailModal.style.display = 'none'
    }
  }

  // ============================
  // 辅助方法
  // ============================

  /** 更新统计信息 */
  private _updateStats(data: GraphData): void {
    this._currentStats = {
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      personCount: data.nodes.filter((n) => n.type === 'person').length,
      eventCount: data.nodes.filter((n) => n.type === 'event').length,
      conversationCount: data.nodes.filter((n) => n.type === 'conversation').length,
    }

    const statsEl = $('#graph-stats')
    if (statsEl) {
      statsEl.innerHTML = `
        <span class="graph-stat-item"><strong>${this._currentStats.nodeCount}</strong> 节点</span>
        <span class="graph-stat-divider">|</span>
        <span class="graph-stat-item"><strong>${this._currentStats.edgeCount}</strong> 关系</span>
        <span class="graph-stat-divider">|</span>
        <span class="graph-stat-item graph-stat-person">${this._currentStats.personCount} 人物</span>
        <span class="graph-stat-divider">|</span>
        <span class="graph-stat-item graph-stat-event">${this._currentStats.eventCount} 事件</span>
        <span class="graph-stat-divider">|</span>
        <span class="graph-stat-item graph-stat-conv">${this._currentStats.conversationCount} 对话</span>
      `
    }
  }

  /** 更新搜索结果计数 */
  private _updateSearchResultCount(count: number): void {
    const countEl = $('#graph-search-count')
    if (countEl) {
      countEl.textContent = count > 0 ? `找到 ${count} 个结果` : ''
    }
  }

  /** Toast 提示 */
  private _showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const existing = $('.graph-toast')
    existing?.remove()

    const toast = document.createElement('div')
    toast.className = `graph-toast graph-toast-${type}`
    toast.textContent = message
    document.body.appendChild(toast)

    // 入场动画
    requestAnimationFrame(() => toast.classList.add('graph-toast-show'))

    setTimeout(() => {
      toast.classList.remove('graph-toast-show')
      setTimeout(() => toast.remove(), 300)
    }, 2000)
  }
}
