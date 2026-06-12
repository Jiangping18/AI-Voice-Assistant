"""
图关系接口（占位模块）

职责（后续由 智能体7 的知识图谱可视化模块填充）：
  1. 维护 "人物-事件-对话" 之间的关联关系
  2. 支持图查询
  3. 为知识图谱可视化提供数据

当前状态: 空实现，所有方法抛出 NotImplementedError
"""

from typing import Any, Optional


class GraphStore:
    """
    图关系存储与查询服务

    使用 NetworkX / Neo4j 等图数据库存储：
        - Node: Person, Conversation, Event
        - Edge: participated_in, mentioned_in, triggered, related_to
    """

    def __init__(self, storage_path: Optional[str] = None):
        self._storage_path = storage_path

    def initialize(self):
        """初始化图存储"""
        raise NotImplementedError("图存储尚未实现。请集成 NetworkX 或 Neo4j。")

    def add_person_node(self, person_id: str, name: str, properties: dict = None):
        """添加/更新人物节点"""
        raise NotImplementedError(f"add_person_node({person_id}) 未实现")

    def add_conversation_node(self, conversation_id: str, title: str, properties: dict = None):
        """添加/更新对话节点"""
        raise NotImplementedError(f"add_conversation_node({conversation_id}) 未实现")

    def add_event_node(self, event_id: str, event_type: str, content: str, properties: dict = None):
        """添加/更新事件节点"""
        raise NotImplementedError(f"add_event_node({event_id}) 未实现")

    def add_edge(self, from_id: str, to_id: str, relation: str, properties: dict = None):
        """添加关系边"""
        raise NotImplementedError(f"add_edge({from_id} --{relation}--> {to_id}) 未实现")

    def get_person_graph(self, person_id: str, depth: int = 2) -> dict:
        """获取某人为中心的局部子图"""
        raise NotImplementedError(f"get_person_graph({person_id}) 未实现")

    def get_conversation_graph(self, conversation_id: str) -> dict:
        """获取某对话的完整事件-人物关系图"""
        raise NotImplementedError(f"get_conversation_graph({conversation_id}) 未实现")

    def query(self, cypher: str) -> list[dict]:
        """自定义图查询"""
        raise NotImplementedError("graph_store.query() 未实现")

    def rebuild_from_sqlite(self):
        """从 SQLite 全量重建图数据"""
        raise NotImplementedError("rebuild_from_sqlite 未实现")

    def save(self):
        """持久化图数据"""
        raise NotImplementedError("graph_store.save() 未实现")
