/**
 * 知识图谱页面 - 入口脚本
 *
 * 负责：
 * 1. 初始化 GraphRenderer 和 GraphPanel
 * 2. 从 GraphService 加载初始数据
 * 3. 启动数据轮询
 */

import { GraphRenderer } from './GraphRenderer'
import { GraphPanel } from './GraphPanel'
import { graphService } from './GraphService'

// ============================
// 初始化
// ============================

async function main(): Promise<void> {
  try {
    // 1. 初始化服务（加载模拟数据）
    graphService.initialize()

    // 2. 初始化渲染器
    const renderer = new GraphRenderer('graph-container')

    // 3. 初始化面板
    const panel = new GraphPanel(renderer, graphService)

    // 4. 加载数据
    const data = await graphService.queryTriples({})
    panel.setData(data)
    renderer.render(data)

    // 5. 初始化面板绑定（需在渲染之后）
    panel.initialize()

    // 6. 启动数据轮询（每 30 秒检查增量更新）
    graphService.startPolling(30000)

    console.log('[知识图谱] 页面初始化完成，节点数:', data.nodes.length, '边数:', data.edges.length)
  } catch (err) {
    console.error('[知识图谱] 初始化失败:', err)
    const container = document.getElementById('graph-container')
    if (container) {
      container.innerHTML = `
        <div class="graph-error-state">
          <div class="graph-error-icon">⚠</div>
          <h3>图谱加载失败</h3>
          <p>${err instanceof Error ? err.message : '未知错误'}</p>
          <button onclick="location.reload()" class="graph-btn graph-btn-primary">重新加载</button>
        </div>
      `
    }
  }
}

// ============================
// DOM Ready
// ============================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main()
}

// ============================
// HMR / 模块热替换（开发模式）
// ============================

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload()
  })
}
