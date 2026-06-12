"""
说话人仓库 (PersonRepository)

提供给智能体7(知识图谱) 使用，管理参与者节点信息。
"""

from typing import Optional
from .base_repository import BaseRepository
from .models import Person


class PersonRepository(BaseRepository):
    """说话人 / 参与者 CRUD"""

    _TABLE = "persons"
    _ROW_CLS = Person
    _PK = "id"

    # ── 业务查询 ────────────────────────────────────────────────

    def find_by_name(self, name: str) -> Optional[Person]:
        """按姓名精确查找（唯一约束暂未建，取第一个）"""
        sql = "SELECT * FROM persons WHERE name = ? LIMIT 1"
        row = self._conn().execute(sql, (name,)).fetchone()
        return self._row_to_model(row) if row else None

    def search_by_name(self, keyword: str, limit: int = 20) -> list[Person]:
        """按姓名模糊搜索"""
        sql = "SELECT * FROM persons WHERE name LIKE ? ORDER BY updated_at DESC LIMIT ?"
        rows = self._conn().execute(sql, (f"%{keyword}%", limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_role(self, role: str, limit: int = 50) -> list[Person]:
        """按角色筛选"""
        return self.find_by("role", role, limit)
