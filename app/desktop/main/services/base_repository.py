"""
基础仓库类 — 封装通用 CRUD 模板方法

所有业务 Repository 继承此类，复用通用的增删改查逻辑。
"""

import sqlite3
from typing import Any, Optional
from .database import DatabaseManager


class BaseRepository:
    """
    泛型基础仓库

    子类只需设置 _TABLE 和 _ROW_CLS 两个类属性即可获得基础 CRUD。
    """

    _TABLE: str = ""                  # 子类覆写：表名
    _ROW_CLS: Any = None              # 子类覆写：对应的 dataclass
    _PK: str = "id"                   # 主键字段名

    # ── 连接 ────────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        return DatabaseManager.get_instance().get_connection()

    # ── 辅助：Row → dict ────────────────────────────────────────

    def _row_to_model(self, row: sqlite3.Row):
        """将 sqlite3.Row 转为模型对象"""
        return self._ROW_CLS.from_row(dict(row))

    # ── Create ──────────────────────────────────────────────────

    def insert(self, model) -> str:
        """
        插入一条记录

        参数:
            model: dataclass 实例（id、created_at 等应在外面或默认生成）

        返回:
            str: 新记录的主键 ID
        """
        data = model.to_dict()
        columns = ", ".join(data.keys())
        placeholders = ", ".join("?" for _ in data)
        values = list(data.values())

        sql = f"INSERT INTO {self._TABLE} ({columns}) VALUES ({placeholders})"
        self._conn().execute(sql, values)
        self._conn().commit()
        return model.id

    # ── Read ────────────────────────────────────────────────────

    def find_by_id(self, record_id: str) -> Optional[Any]:
        """按主键查询单条记录"""
        sql = f"SELECT * FROM {self._TABLE} WHERE {self._PK} = ?"
        row = self._conn().execute(sql, (record_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_model(row)

    def find_all(self, limit: int = 100, offset: int = 0) -> list:
        """查询全部记录（带分页，按创建时间降序）"""
        sql = f"SELECT * FROM {self._TABLE} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        rows = self._conn().execute(sql, (limit, offset)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by(self, field: str, value: Any, limit: int = 100) -> list:
        """按某字段精确匹配查询"""
        sql = f"SELECT * FROM {self._TABLE} WHERE {field} = ? ORDER BY created_at DESC LIMIT ?"
        rows = self._conn().execute(sql, (value, limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    # ── Update ──────────────────────────────────────────────────

    def update(self, model) -> bool:
        """
        按主键更新记录（非 None 字段全量覆盖）

        返回:
            bool: 是否更新了数据
        """
        data = model.to_dict()
        pk_value = data.pop(self._PK, None)
        if pk_value is None:
            return False

        set_clause = ", ".join(f"{k} = ?" for k in data.keys())
        values = list(data.values()) + [pk_value]

        sql = f"UPDATE {self._TABLE} SET {set_clause} WHERE {self._PK} = ?"
        cursor = self._conn().execute(sql, values)
        self._conn().commit()
        return cursor.rowcount > 0

    def update_fields(self, record_id: str, **fields) -> bool:
        """
        仅更新指定字段（部分更新）

        用法:
            repo.update_fields("some-uuid", title="新标题", status="completed")
        """
        if not fields:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in fields.keys())
        values = list(fields.values()) + [record_id]

        sql = f"UPDATE {self._TABLE} SET {set_clause} WHERE {self._PK} = ?"
        cursor = self._conn().execute(sql, values)
        self._conn().commit()
        return cursor.rowcount > 0

    # ── Delete ──────────────────────────────────────────────────

    def delete(self, record_id: str) -> bool:
        """按主键删除"""
        sql = f"DELETE FROM {self._TABLE} WHERE {self._PK} = ?"
        cursor = self._conn().execute(sql, (record_id,))
        self._conn().commit()
        return cursor.rowcount > 0

    # ── 聚合 ────────────────────────────────────────────────────

    def count(self, field: str = None, value: Any = None) -> int:
        """条件计数"""
        if field is not None:
            sql = f"SELECT COUNT(*) AS cnt FROM {self._TABLE} WHERE {field} = ?"
            row = self._conn().execute(sql, (value,)).fetchone()
        else:
            sql = f"SELECT COUNT(*) AS cnt FROM {self._TABLE}"
            row = self._conn().execute(sql).fetchone()
        return row["cnt"] if row else 0
