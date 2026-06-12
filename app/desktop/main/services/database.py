"""
数据库核心模块 -- 智能体5 (记忆存储与检索) 的基础设施

职责：
  1. 管理 SQLite 连接（单例模式）
  2. 初始化数据库文件并创建所有表结构
  3. 提供统一的连接获取接口，供各 Repository 使用

数据库文件位置：app/desktop/ai_voice_assistant.db
"""

import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

# 数据库文件路径，存储在 app/desktop/ 本地目录下，与 main/ 平级
DB_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)
# 优先使用 MEMORY_DATA_DIR 环境变量（用于非 FUSE 挂载的场景），否则默认写到 app/desktop/
DATA_DIR = os.environ.get("MEMORY_DATA_DIR", DB_DIR)
DB_PATH = os.path.join(DATA_DIR, "ai_voice_assistant.db")


class DatabaseManager:
    """
    SQLite 数据库管理器（线程安全单例）

    用法:
        db = DatabaseManager.get_instance()
        conn = db.get_connection()
    """

    _instance: Optional["DatabaseManager"] = None
    _lock = threading.Lock()

    def __init__(self, db_path: str = DB_PATH):
        self._db_path = db_path
        self._local = threading.local()

    @classmethod
    def get_instance(cls, db_path: str = DB_PATH) -> "DatabaseManager":
        """获取全局唯一的 DatabaseManager 实例"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(db_path)
        return cls._instance

    def get_connection(self) -> sqlite3.Connection:
        """
        获取当前线程的数据库连接（自动创建）
        启用 WAL 模式以提升并发读取性能
        """
        conn = getattr(self._local, "connection", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA cache_size=-8000")
            self._local.connection = conn
        return conn

    def close_connection(self):
        """关闭当前线程的连接（在应用退出时调用）"""
        conn = getattr(self._local, "connection", None)
        if conn is not None:
            conn.close()
            self._local.connection = None

    def initialize_tables(self):
        """
        创建所有表结构（幂等：IF NOT EXISTS）
        初次部署 / 版本升级时调用
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        # conversations -- 对话会话
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id              TEXT PRIMARY KEY,
                title           TEXT NOT NULL DEFAULT '',
                start_time      TEXT NOT NULL,
                end_time        TEXT,
                participant_ids TEXT DEFAULT '[]',
                summary         TEXT DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'active',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
        """)

        # persons -- 说话人 / 参与者
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS persons (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                role            TEXT DEFAULT 'speaker',
                voice_print     TEXT,
                meta_info       TEXT DEFAULT '{}',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
        """)

        # events -- 对话中提取的事件
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id                  TEXT PRIMARY KEY,
                conversation_id     TEXT NOT NULL,
                type                TEXT NOT NULL,
                content             TEXT NOT NULL,
                timestamp           TEXT,
                source_segment_id   TEXT,
                involved_person_ids TEXT DEFAULT '[]',
                created_at          TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
        """)

        # reminders -- 待办 / 提醒
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id                  TEXT PRIMARY KEY,
                event_id            TEXT,
                title               TEXT NOT NULL,
                content             TEXT DEFAULT '',
                due_time            TEXT,
                status              TEXT NOT NULL DEFAULT 'pending',
                priority            INTEGER NOT NULL DEFAULT 3,
                trigger_conditions  TEXT DEFAULT '{}',
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            );
        """)

        # segments -- 音频/转录片段
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS segments (
                id                  TEXT PRIMARY KEY,
                conversation_id     TEXT NOT NULL,
                person_id           TEXT,
                start_time          REAL NOT NULL DEFAULT 0,
                end_time            REAL,
                text                TEXT NOT NULL DEFAULT '',
                embedding           BLOB,
                created_at          TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE SET NULL
            );
        """)

        # 索引
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_time);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_segments_conversation ON segments(conversation_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_segments_person ON segments(person_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);")

        conn.commit()

    @property
    def db_path(self) -> str:
        return self._db_path


def utc_now() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串"""
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    db = DatabaseManager.get_instance()
    print(f"[数据库] 存储路径: {db.db_path}")
    db.initialize_tables()
    print("[数据库] 表结构初始化完成")
    db.close_connection()
