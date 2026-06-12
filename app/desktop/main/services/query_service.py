"""
统一查询服务 — 对外暴露的检索入口

对外接口格式:
    POST /api/memory/search
    {
        "query": "文本",
        "filters": { "conversation_id": "xxx", "person_id": "xxx", "type": "action_item" },
        "top_k": 5
    }

返回格式:
    {
        "results": [
            {"type": "segment"|"event"|"conversation"|"reminder"|"person",
             "id": "xxx",
             "score": 0.95,
             "data": { ... }}
        ],
        "total": 3
    }

当前实现:
    - 先走 SQL 文本模糊匹配（keyword search fallback）
    - 后续集成 VectorStore 后改为语义检索 + 图查询

设计目的:
    为 智能体4(RAG)、智能体6(提醒)、智能体7(图谱) 提供统一的数据检索入口。
"""

from typing import Any, Optional
from .database import DatabaseManager
from .conversation_repo import ConversationRepository
from .person_repo import PersonRepository
from .event_repo import EventRepository
from .reminder_repo import ReminderRepository
from .segment_repo import SegmentRepository
from .vector_store import VectorStore
from .graph_store import GraphStore


class QueryService:
    """
    统一查询服务

    组合 5 个 Repository + VectorStore + GraphStore
    对外暴露 search / hybrid_search 接口
    """

    def __init__(self):
        self.conversations = ConversationRepository()
        self.persons = PersonRepository()
        self.events = EventRepository()
        self.reminders = ReminderRepository()
        self.segments = SegmentRepository()
        self.vector = VectorStore()
        self.graph = GraphStore()
        self._vector_ready = False    # 向量索引就绪标志

    # ── 首次启动：初始化表结构 ─────────────────────────────────

    def initialize_database(self):
        """初始化数据库表（幂等）"""
        DatabaseManager.get_instance().initialize_tables()

    # ── 向量检索就绪标志 ──────────────────────────────────────

    def set_vector_ready(self, ready: bool = True):
        """由 RAG 模块在 VectorStore 初始化完成后调用"""
        self._vector_ready = ready

    # ── 统一检索入口 ───────────────────────────────────────────

    def search(self, query: str, filters: dict = None, top_k: int = 5) -> dict:
        """
        统一检索（先向量 → 再 SQL fallback）

        参数:
            query:   搜索文本
            filters: 过滤条件，支持:
                        - conversation_id: 按对话筛选
                        - person_id: 按说话人筛选
                        - type: 按事件类型筛选
                        - status: 按状态筛选
                        - start_time / end_time: 时间范围
            top_k:   最多返回条数

        返回:
            {
                "results": [{"type": str, "id": str, "score": float, "data": dict}, ...],
                "total": int
            }
        """
        filters = filters or {}
        results = []

        # ── 1. 向量检索（就绪时优先使用） ─────────────────────
        if self._vector_ready:
            try:
                vector_results = self.vector.search(query, filters, top_k)
                for vr in vector_results:
                    results.append({
                        "type": "segment",
                        "id": vr.get("segment_id", ""),
                        "score": vr.get("score", 0.0),
                        "data": vr,
                    })
            except NotImplementedError:
                pass  # 向量未实现，降级到 SQL
        else:
            # ── 2. SQL 文本模糊匹配 fallback ─────────────────
            self._sql_search(results, query, filters, top_k)

        # 按 score 降序
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:top_k]

        return {"results": results, "total": len(results)}

    # ── 按类型专项查询 ─────────────────────────────────────────

    def search_segments(self, query: str, filters: dict = None, top_k: int = 5) -> list[dict]:
        """仅搜索音频片段"""
        result = self.search(query, filters, top_k)
        return [r for r in result["results"] if r["type"] == "segment"]

    def search_events(self, query: str, filters: dict = None, top_k: int = 5) -> list[dict]:
        """仅搜索事件"""
        result = self.search(query, filters, top_k)
        return [r for r in result["results"] if r["type"] == "event"]

    def search_reminders(self, query: str, filters: dict = None, top_k: int = 5) -> list[dict]:
        """仅搜索提醒"""
        result = self.search(query, filters, top_k)
        return [r for r in result["results"] if r["type"] == "reminder"]

    # ── SQL 回退检索逻辑（供快速集成使用） ────────────────────

    def _sql_search(self, results: list, query: str, filters: dict, top_k: int):
        """基于 SQL LIKE 的文本检索（降级方案）"""

        # 1) segments
        for seg in self.segments.find_by_text_like(query, top_k):
            d = seg.to_dict()
            score = 0.5  # 等权得分
            results.append({"type": "segment", "id": seg.id, "score": score, "data": d})

        # 2) events
        if "type" in filters:
            for evt in self.events.find_by_type(filters["type"], top_k):
                if query.lower() in evt.content.lower():
                    d = evt.to_dict()
                    results.append({"type": "event", "id": evt.id, "score": 0.4, "data": d})
        else:
            for evt in self.events.find_recent(top_k * 2):
                if query.lower() in evt.content.lower():
                    d = evt.to_dict()
                    results.append({"type": "event", "id": evt.id, "score": 0.4, "data": d})

        # 3) conversations
        if "conversation_id" in filters:
            conv = self.conversations.find_by_id(filters["conversation_id"])
            if conv and query.lower() in conv.title.lower():
                results.append({
                    "type": "conversation", "id": conv.id, "score": 0.3,
                    "data": conv.to_dict()
                })
        else:
            for conv in self.conversations.find_all(limit=top_k):
                if query.lower() in conv.title.lower() or query.lower() in conv.summary.lower():
                    results.append({
                        "type": "conversation", "id": conv.id, "score": 0.3,
                        "data": conv.to_dict()
                    })

        # 4) reminders
        if "status" in filters:
            for rem in self.reminders.find_by("status", filters["status"], top_k):
                if query.lower() in rem.title.lower() or query.lower() in rem.content.lower():
                    d = rem.to_dict()
                    results.append({"type": "reminder", "id": rem.id, "score": 0.35, "data": d})
        else:
            for rem in self.reminders.find_pending(top_k):
                if query.lower() in rem.title.lower() or query.lower() in rem.content.lower():
                    d = rem.to_dict()
                    results.append({"type": "reminder", "id": rem.id, "score": 0.35, "data": d})

        # 5) persons
        for person in self.persons.search_by_name(query, top_k):
            d = person.to_dict()
            results.append({"type": "person", "id": person.id, "score": 0.6, "data": d})

    # ── 图查询代理 ─────────────────────────────────────────────

    def get_person_subgraph(self, person_id: str, depth: int = 2) -> dict:
        """获取人物局部关系图（代理给 GraphStore）"""
        try:
            return self.graph.get_person_graph(person_id, depth)
        except NotImplementedError:
            # 降级：用 SQL 拼凑关联
            return self._fallback_person_graph(person_id)

    def _fallback_person_graph(self, person_id: str) -> dict:
        """SQL 降级的人物关系图"""
        nodes = []
        edges = []

        # 人物节点
        person = self.persons.find_by_id(person_id)
        if person:
            nodes.append({"id": person.id, "type": "person", "label": person.name})

            # 参与的对话
            convs = self.conversations.find_by_participant(person_id)
            for conv in convs:
                nodes.append({"id": conv.id, "type": "conversation", "label": conv.title})
                edges.append({"from": person.id, "to": conv.id, "relation": "participated_in"})

            # 涉及的事件
            events = self.events.find_by_person_involved(person_id)
            for evt in events:
                nodes.append({"id": evt.id, "type": "event", "label": evt.content[:50]})
                edges.append({"from": person.id, "to": evt.id, "relation": "mentioned_in"})

        return {"nodes": nodes, "edges": edges}
