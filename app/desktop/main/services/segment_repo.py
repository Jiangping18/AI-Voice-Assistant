"""
音频片段仓库 (SegmentRepository)

提供给智能体3(ASR/说话人分离) 和智能体4(语义分析/RAG) 使用。
"""

from typing import Optional
from .base_repository import BaseRepository
from .models import Segment


class SegmentRepository(BaseRepository):
    """音频/转录片段 CRUD"""

    _TABLE = "segments"
    _ROW_CLS = Segment
    _PK = "id"

    # ── 业务查询 ────────────────────────────────────────────────

    def find_by_conversation(self, conversation_id: str) -> list[Segment]:
        """按对话查询所有片段（按起始时间升序）"""
        sql = "SELECT * FROM segments WHERE conversation_id = ? ORDER BY start_time ASC"
        rows = self._conn().execute(sql, (conversation_id,)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_person(self, person_id: str, limit: int = 100) -> list[Segment]:
        """按说话人查询片段"""
        return self.find_by("person_id", person_id, limit)

    def find_by_text_like(self, keyword: str, limit: int = 50) -> list[Segment]:
        """按文本模糊搜索（基础文本检索，后续向量检索会替代）"""
        sql = "SELECT * FROM segments WHERE text LIKE ? ORDER BY created_at DESC LIMIT ?"
        rows = self._conn().execute(sql, (f"%{keyword}%", limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_time_range(self, conversation_id: str, start: float, end: float) -> list[Segment]:
        """按时间范围查询片段"""
        sql = """
            SELECT * FROM segments
            WHERE conversation_id = ? AND start_time >= ? AND (end_time IS NULL OR end_time <= ?)
            ORDER BY start_time ASC
        """
        rows = self._conn().execute(sql, (conversation_id, start, end)).fetchall()
        return [self._row_to_model(r) for r in rows]

    # ── 更新嵌入 ────────────────────────────────────────────────

    def update_embedding(self, segment_id: str, embedding_bytes: bytes) -> bool:
        """
        更新片段的向量嵌入（由 RAG 模块在生成嵌入后调用）

        参数:
            segment_id: 片段 ID
            embedding_bytes: 嵌入向量二进制 (numpy array → tobytes)
        """
        sql = "UPDATE segments SET embedding = ? WHERE id = ?"
        cursor = self._conn().execute(sql, (embedding_bytes, segment_id))
        self._conn().commit()
        return cursor.rowcount > 0
