"""
图关系存储与查询服务（智能体7 - 知识图谱可视化后端）

职责：
  1. 使用 NetworkX 维护 "人物-事件-对话" 之间的关联关系
  2. 支持图查询（以人为中心的子图、对话图、自定义过滤）
  3. 为知识图谱可视化提供数据
  4. 支持增量更新与筛选

与前端 GraphService.ts 的数据格式对齐：
  GraphService.queryTriples(filters) → { nodes: [...], edges: [...] }

依赖：
  pip install networkx
"""

import json
from datetime import datetime, timedelta
from typing import Any, Optional

import networkx as nx


# ============================
# 类型常量
# ============================

NODE_TYPE_PERSON = "person"           # 人物节点
NODE_TYPE_EVENT = "event"             # 事件节点
NODE_TYPE_CONVERSATION = "conversation"  # 对话节点

RELATION_PARTICIPATED = "参与"        # 人物 → 事件
RELATION_MENTIONED = "提及"           # 人物 → 对话
RELATION_TRIGGERED = "触发"           # 事件 → 对话
RELATION_RELATED = "相关"             # 人物 → 人物

VALID_RELATIONS = {
    RELATION_PARTICIPATED,
    RELATION_MENTIONED,
    RELATION_TRIGGERED,
    RELATION_RELATED,
}


class GraphStore:
    """
    图关系存储与查询服务

    使用 NetworkX 无向图存储：
        - Node 属性: type, label, properties
        - Edge 属性: relation, properties
    """

    def __init__(self, storage_path: Optional[str] = None):
        self._storage_path = storage_path
        self._graph: nx.Graph = nx.Graph()

    # ============================
    # 初始化与持久化
    # ============================

    def initialize(self):
        """初始化图存储：加载已有图或创建新图"""
        if self._storage_path:
            try:
                self._load()
                print(f"[GraphStore] 从 {self._storage_path} 加载图数据，"
                      f"节点数: {self._graph.number_of_nodes()}, "
                      f"边数: {self._graph.number_of_edges()}")
                return
            except (FileNotFoundError, json.JSONDecodeError):
                print(f"[GraphStore] {self._storage_path} 不存在或格式错误，创建新图")
        else:
            print("[GraphStore] 创建新图（内存模式）")

    # ============================
    # 节点操作
    # ============================

    def add_person_node(self, person_id: str, name: str, properties: dict = None) -> str:
        """添加/更新人物节点"""
        self