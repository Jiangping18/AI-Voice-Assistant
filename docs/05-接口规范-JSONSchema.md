# 智能体5 — 记忆存储与检索 接口规范 (JSON Schema)

> 本文档用 JSON Schema 格式定义 `services/` 模块对外暴露的所有接口，
> 供 智能体4(语义分析/RAG)、智能体6(智能提醒)、智能体7(知识图谱) 集成使用。

---

## 目录

1. [生命周期接口 (Lifecycle)](#1-生命周期接口-lifecycle)
2. [结构化数据模型 (Models)](#2-结构化数据模型-models)
3. [通用 CRUD 接口 (BaseRepository)](#3-通用-crud-接口-baserepository)
4. [对话仓库 (ConversationRepository)](#4-对话仓库-conversationrepository)
5. [说话人仓库 (PersonRepository)](#5-说话人仓库-personrepository)
6. [事件仓库 (EventRepository)](#6-事件仓库-eventrepository)
7. [提醒仓库 (ReminderRepository)](#7-提醒仓库-reminderrepository)
8. [音频片段仓库 (SegmentRepository)](#8-音频片段仓库-segmentrepository)
9. [统一检索接口 (QueryService)](#9-统一检索接口-queryservice)
10. [人物关系子图接口](#10-人物关系子图接口)
11. [向量检索预留接口 (VectorStore)](#11-向量检索预留接口-vectorstore)
12. [图关系预留接口 (GraphStore)](#12-图关系预留接口-graphstore)
13. [SQL 表结构定义](#13-sql-表结构定义)

---

## 1. 生命周期接口 (Lifecycle)

### DatabaseManager

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DatabaseManager",
  "description": "SQLite 数据库管理器（线程安全单例），负责连接管理与表初始化",
  "type": "object",
  "properties": {
    "get_instance": {
      "description": "获取全局唯一的 DatabaseManager 实例",
      "type": "function",
      "args": {
        "db_path": {
          "type": "string",
          "description": "数据库文件路径，可选；默认 app/desktop/ai_voice_assistant.db",
          "default": "app/desktop/ai_voice_assistant.db"
        }
      },
      "returns": {
        "type": "object",
        "description": "DatabaseManager 单例"
      }
    },
    "initialize_tables": {
      "description": "创建所有表结构（幂等 — IF NOT EXISTS），首次部署或升级时调用",
      "type": "function",
      "args": {},
      "returns": { "type": "null" },
      "side_effect": "创建 conversations / persons / events / reminders / segments 五张表及 7 个索引"
    },
    "get_connection": {
      "description": "获取当前线程的 SQLite 连接（自动创建，WAL + 外键 + 8MB 缓存）",
      "type": "function",
      "args": {},
      "returns": { "type": "object", "description": "sqlite3.Connection" }
    },
    "close_connection": {
      "description": "关闭当前线程的数据库连接（应用退出时调用）",
      "type": "function",
      "args": {},
      "returns": { "type": "null" }
    },
    "db_path": {
      "description": "当前数据库文件的实际存储路径",
      "type": "string",
      "example": "/tmp/ai_voice_assistant.db"
    }
  },
  "config": {
    "MEMORY_DATA_DIR": {
      "type": "string",
      "description": "环境变量，覆盖数据库文件存储目录；默认 app/desktop/",
      "example": "/data/memory"
    }
  }
}
```

---

## 2. 结构化数据模型 (Models)

### 2.1 Conversation — 对话会话

**Python dataclass** 入参定义：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Conversation",
  "type": "object",
  "properties": {
    "id":              { "type": "string", "format": "uuid", "description": "主键 UUID，不传则自动生成" },
    "title":           { "type": "string", "description": "对话标题", "default": "" },
    "start_time":      { "type": "string", "format": "date-time", "description": "对话开始时间 (ISO 8601 UTC)", "default": "当前 UTC 时间" },
    "end_time":        { "type": ["string", "null"], "format": "date-time", "description": "对话结束时间 (ISO 8601 UTC)" },
    "participant_ids": { "type": "array", "items": { "type": "string" }, "description": "参与人 ID 列表，默认 []" },
    "summary":         { "type": "string", "description": "对话摘要", "default": "" },
    "status":          { "type": "string", "enum": ["active", "completed", "archived"], "description": "状态", "default": "active" },
    "created_at":      { "type": "string", "format": "date-time", "description": "记录创建时间", "default": "当前 UTC 时间" },
    "updated_at":      { "type": "string", "format": "date-time", "description": "最后更新时间", "default": "当前 UTC 时间" }
  },
  "required": [],
  "wire_format": {
    "description": "通过 to_dict() 序列化后写入 SQLite 的 JSON 列格式",
    "participant_ids": "JSON 字符串，如 '[\"p1\",\"p2\"]'"
  }
}
```

### 2.2 Person — 说话人 / 参与者

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Person",
  "type": "object",
  "properties": {
    "id":          { "type": "string", "format": "uuid", "description": "主键 UUID" },
    "name":        { "type": "string", "description": "说话人名称", "default": "" },
    "role":        { "type": "string", "enum": ["speaker", "user", "assistant", "unknown"], "description": "角色", "default": "speaker" },
    "voice_print": { "type": ["string", "null"], "description": "声纹特征 (JSON 格式，预留)" },
    "meta_info":   { "type": "object", "description": "扩展元信息，如 {\"department\":\"技术部\"}", "default": {} },
    "created_at":  { "type": "string", "format": "date-time" },
    "updated_at":  { "type": "string", "format": "date-time" }
  }
}
```

### 2.3 Event — 事件

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Event",
  "type": "object",
  "properties": {
    "id":                 { "type": "string", "format": "uuid" },
    "conversation_id":    { "type": "string", "description": "所属对话 ID" },
    "type":               { "type": "string", "enum": ["action_item", "decision", "question", "note", "meeting_minutes"], "description": "事件类型", "default": "note" },
    "content":            { "type": "string", "description": "事件内容" },
    "timestamp":          { "type": ["string", "null"], "format": "date-time", "description": "对话内时间戳" },
    "source_segment_id":  { "type": ["string", "null"], "description": "来源片段 ID" },
    "involved_person_ids": { "type": "array", "items": { "type": "string" }, "description": "相关人员 ID 列表" },
    "created_at":         { "type": "string", "format": "date-time" }
  },
  "required": ["conversation_id", "type", "content"]
}
```

### 2.4 Reminder — 提醒

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Reminder",
  "type": "object",
  "properties": {
    "id":                 { "type": "string", "format": "uuid" },
    "event_id":           { "type": ["string", "null"], "description": "关联事件 ID" },
    "title":              { "type": "string", "description": "提醒标题" },
    "content":            { "type": "string", "description": "提醒详情", "default": "" },
    "due_time":           { "type": ["string", "null"], "format": "date-time", "description": "截止/触发时间" },
    "status":             { "type": "string", "enum": ["pending", "triggered", "dismissed", "completed"], "default": "pending" },
    "priority":           { "type": "integer", "minimum": 1, "maximum": 5, "description": "1-5，5最高", "default": 3 },
    "trigger_conditions": { "type": "object", "description": "触发条件 (JSON，预留)", "default": {} },
    "created_at":         { "type": "string", "format": "date-time" },
    "updated_at":         { "type": "string", "format": "date-time" }
  },
  "required": ["title"]
}
```

### 2.5 Segment — 音频/转录片段

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Segment",
  "type": "object",
  "properties": {
    "id":               { "type": "string", "format": "uuid" },
    "conversation_id":  { "type": "string", "description": "所属对话 ID" },
    "person_id":        { "type": ["string", "null"], "description": "说话人 ID" },
    "start_time":       { "type": "number", "description": "片段起始时间（秒，相对对话开始）", "default": 0.0 },
    "end_time":         { "type": ["number", "null"], "description": "片段结束时间（秒）" },
    "text":             { "type": "string", "description": "转写文本", "default": "" },
    "embedding":        { "type": ["string", "null"], "contentEncoding": "base64", "description": "向量嵌入二进制 (numpy array → tobytes)，预留" },
    "created_at":       { "type": "string", "format": "date-time" }
  },
  "required": ["conversation_id"],
  "notes": "embedding 字段在序列化 (to_dict) 时被置为 None，不参与 JSON 传输。直接通过 update_embedding() 方法以 bytes 形式写入 SQLite BLOB"
}
```

---

## 3. 通用 CRUD 接口 (BaseRepository)

所有 Repository 继承此类，提供统一的基础增删改查。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BaseRepository<T>",
  "description": "泛型 CRUD 基类，子类通过 _TABLE / _ROW_CLS / _PK 三个类属性定制",
  "methods": {
    "insert": {
      "description": "插入一条记录",
      "input": {
        "model": { "type": "object", "description": "对应 dataclass 实例" }
      },
      "returns": { "type": "string", "description": "新记录的主键 ID (UUID)" },
      "side_effect": "INSERT INTO table"
    },

    "find_by_id": {
      "description": "按主键查询单条记录",
      "input": {
        "record_id": { "type": "string", "description": "主键值" }
      },
      "returns": {
        "oneOf": [
          { "type": "object", "description": "对应模型的 dataclass 实例" },
          { "type": "null", "description": "未找到时返回 None" }
        ]
      }
    },

    "find_all": {
      "description": "查询全部记录（按 created_at 降序，分页）",
      "input": {
        "limit":  { "type": "integer", "default": 100, "description": "每页条数" },
        "offset": { "type": "integer", "default": 0, "description": "偏移量" }
      },
      "returns": { "type": "array", "items": { "type": "object" }, "description": "模型对象列表" }
    },

    "find_by": {
      "description": "按某字段精确匹配查询",
      "input": {
        "field": { "type": "string", "description": "字段名" },
        "value": { "description": "匹配值" },
        "limit": { "type": "integer", "default": 100 }
      },
      "returns": { "type": "array", "items": { "type": "object" } }
    },

    "update": {
      "description": "全量更新 — 用模型对象的所有字段覆盖同 ID 记录",
      "input": {
        "model": { "type": "object", "description": "含 id 字段的 dataclass 实例" }
      },
      "returns": { "type": "boolean", "description": "是否更新了数据 (rowcount > 0)" }
    },

    "update_fields": {
      "description": "部分更新 — 仅更新指定字段",
      "input": {
        "record_id": { "type": "string" },
        "**fields":  { "type": "object", "description": "要更新的键值对" }
      },
      "returns": { "type": "boolean" },
      "example": "repo.update_fields('uuid-xxx', title='新标题', status='completed')"
    },

    "delete": {
      "description": "按主键删除记录",
      "input": {
        "record_id": { "type": "string" }
      },
      "returns": { "type": "boolean" }
    },

    "count": {
      "description": "条件计数 — 无参数时返回全表行数",
      "input": {
        "field": { "type": "string", "description": "筛选字段（可选）" },
        "value": { "description": "筛选值（可选）" }
      },
      "returns": { "type": "integer" }
    }
  }
}
```

---

## 4. 对话仓库 (ConversationRepository)

继承 `BaseRepository<Conversation>`，表名 `conversations`。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ConversationRepository",
  "methods": {
    "find_active": {
      "description": "查询所有 status='active' 的对话",
      "input": { "limit": { "type": "integer", "default": 20 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Conversation" } }
    },
    "find_completed": {
      "description": "查询所有 status='completed' 的对话",
      "input": { "limit": { "type": "integer", "default": 20 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Conversation" } }
    },
    "find_by_time_range": {
      "description": "按 start_time 时间范围查询",
      "input": {
        "start": { "type": "string", "format": "date-time", "description": "起始时间 (ISO 8601)" },
        "end":   { "type": "string", "format": "date-time", "description": "结束时间 (ISO 8601)" },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Conversation" } }
    },
    "find_by_participant": {
      "description": "查找包含某人的所有对话（JSON 数组 LIKE 模糊匹配）",
      "input": {
        "person_id": { "type": "string" },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Conversation" } }
    },
    "mark_completed": {
      "description": "标记对话为 completed，设置 end_time 和 summary",
      "input": {
        "conversation_id": { "type": "string" },
        "summary": { "type": "string", "default": "", "description": "可选摘要" }
      },
      "returns": { "type": "boolean" }
    }
  }
}
```

---

## 5. 说话人仓库 (PersonRepository)

继承 `BaseRepository<Person>`，表名 `persons`。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PersonRepository",
  "methods": {
    "find_by_name": {
      "description": "按姓名精确查找（取第一个匹配）",
      "input": { "name": { "type": "string" } },
      "returns": { "oneOf": [{ "type": "object" }, { "type": "null" }] }
    },
    "search_by_name": {
      "description": "按姓名 LIKE 模糊搜索",
      "input": {
        "keyword": { "type": "string" },
        "limit": { "type": "integer", "default": 20 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Person" } }
    },
    "find_by_role": {
      "description": "按角色筛选",
      "input": {
        "role": { "type": "string", "enum": ["speaker", "user", "assistant", "unknown"] },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Person" } }
    }
  }
}
```

---

## 6. 事件仓库 (EventRepository)

继承 `BaseRepository<Event>`，表名 `events`。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EventRepository",
  "methods": {
    "find_by_conversation": {
      "description": "按对话查询所有事件",
      "input": { "conversation_id": { "type": "string" } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Event" } }
    },
    "find_by_type": {
      "description": "按事件类型筛选",
      "input": {
        "event_type": { "type": "string", "enum": ["action_item", "decision", "question", "note", "meeting_minutes"] },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Event" } }
    },
    "find_recent": {
      "description": "最近创建的事件",
      "input": { "limit": { "type": "integer", "default": 20 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Event" } }
    },
    "find_by_person_involved": {
      "description": "查找涉及某人的事件",
      "input": {
        "person_id": { "type": "string" },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Event" } }
    },
    "delete_by_conversation": {
      "description": "级联删除某个对话的所有事件",
      "input": { "conversation_id": { "type": "string" } },
      "returns": { "type": "integer", "description": "被删除的行数" }
    }
  }
}
```

---

## 7. 提醒仓库 (ReminderRepository)

继承 `BaseRepository<Reminder>`，表名 `reminders`。供智能体6使用。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ReminderRepository",
  "methods": {
    "find_pending": {
      "description": "查询所有 status='pending' 的待触发提醒",
      "input": { "limit": { "type": "integer", "default": 50 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Reminder" } }
    },
    "find_overdue": {
      "description": "查询已过期但仍是 pending 的提醒 (due_time < 当前时间)",
      "input": { "limit": { "type": "integer", "default": 50 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Reminder" } }
    },
    "find_by_priority": {
      "description": "按最低优先级筛选 pending 中的提醒，按 priority DESC, due_time ASC 排序",
      "input": {
        "min_priority": { "type": "integer", "minimum": 1, "maximum": 5, "default": 3 },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Reminder" } }
    },
    "find_by_event": {
      "description": "按关联事件查询提醒",
      "input": { "event_id": { "type": "string" } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Reminder" } }
    },
    "mark_triggered": {
      "description": "标记提醒为已触发",
      "input": { "reminder_id": { "type": "string" } },
      "returns": { "type": "boolean" }
    },
    "mark_completed": {
      "description": "标记提醒为已完成",
      "input": { "reminder_id": { "type": "string" } },
      "returns": { "type": "boolean" }
    },
    "mark_dismissed": {
      "description": "标记提醒为已忽略",
      "input": { "reminder_id": { "type": "string" } },
      "returns": { "type": "boolean" }
    }
  }
}
```

---

## 8. 音频片段仓库 (SegmentRepository)

继承 `BaseRepository<Segment>`，表名 `segments`。供智能体3(ASR) 和智能体4(RAG) 使用。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SegmentRepository",
  "methods": {
    "find_by_conversation": {
      "description": "按对话查询所有片段（按 start_time ASC 排序）",
      "input": { "conversation_id": { "type": "string" } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Segment" } }
    },
    "find_by_person": {
      "description": "按说话人查询片段",
      "input": {
        "person_id": { "type": "string" },
        "limit": { "type": "integer", "default": 100 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Segment" } }
    },
    "find_by_text_like": {
      "description": "按文本 LIKE 模糊搜索（SQL fallback，后续由向量检索替代）",
      "input": {
        "keyword": { "type": "string" },
        "limit": { "type": "integer", "default": 50 }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Segment" } }
    },
    "find_time_range": {
      "description": "按 conversation_id + 时间范围查询片段",
      "input": {
        "conversation_id": { "type": "string" },
        "start": { "type": "number", "description": "起始时间（秒）" },
        "end":   { "type": "number", "description": "结束时间（秒）" }
      },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/Segment" } }
    },
    "update_embedding": {
      "description": "更新片段的向量嵌入（由 RAG 模块在生成嵌入后调用）",
      "input": {
        "segment_id":      { "type": "string" },
        "embedding_bytes": { "type": "string", "contentEncoding": "base64", "description": "numpy array 的 tobytes() 二进制" }
      },
      "returns": { "type": "boolean" },
      "sql": "UPDATE segments SET embedding = ? WHERE id = ?"
    }
  }
}
```

---

## 9. 统一检索接口 (QueryService)

**核心入口** — 智能体4/6/7 通过此接口统一搜素记忆库。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "QueryService",
  "description": "组合 5 个 Repository + VectorStore + GraphStore，对外暴露统一检索入口",
  "methods": {
    "initialize_database": {
      "description": "初始化数据库表（幂等），首次启动时调用",
      "input": {},
      "returns": { "type": "null" }
    },
    "set_vector_ready": {
      "description": "由 RAG 模块在 VectorStore 初始化完成后调用，开启向量优先检索",
      "input": {
        "ready": { "type": "boolean", "default": true }
      },
      "returns": { "type": "null" }
    },
    "search": {
      "description": "统一检索入口 — 先尝试向量检索（就绪时），降级到 SQL LIKE 模糊匹配",
      "input": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": {
            "type": "string",
            "description": "搜索文本"
          },
          "filters": {
            "type": "object",
            "description": "过滤条件（可选）",
            "properties": {
              "conversation_id": { "type": "string", "description": "限定对话" },
              "person_id":       { "type": "string", "description": "限定说话人" },
              "type":            { "type": "string", "description": "限定事件类型 (action_item / decision / question / note / meeting_minutes)" },
              "status":          { "type": "string", "description": "限定状态 (active / completed / pending / triggered / dismissed)" },
              "start_time":      { "type": "string", "format": "date-time", "description": "时间范围起始" },
              "end_time":        { "type": "string", "format": "date-time", "description": "时间范围结束" }
            },
            "additionalProperties": true
          },
          "top_k": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 5,
            "description": "最多返回条数"
          }
        }
      },
      "returns": {
        "type": "object",
        "required": ["results", "total"],
        "properties": {
          "results": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type", "id", "score", "data"],
              "properties": {
                "type":  { "type": "string", "enum": ["segment", "event", "conversation", "reminder", "person"], "description": "结果类型" },
                "id":    { "type": "string", "description": "记录 ID" },
                "score": { "type": "number", "minimum": 0, "maximum": 1, "description": "相关性得分，0~1" },
                "data":  { "type": "object", "description": "完整的数据模型字段" }
              }
            }
          },
          "total": {
            "type": "integer",
            "description": "结果数量（≤ top_k）"
          }
        }
      },
      "example": {
        "request":  { "query": "开会讨论了预算", "filters": { "type": "action_item" }, "top_k": 5 },
        "response": {
          "results": [
            { "type": "segment", "id": "uuid-xxx", "score": 0.5, "data": { "text": "预算需要控制在50万以内", "conversation_id": "...", ... } },
            { "type": "event",   "id": "uuid-yyy", "score": 0.4, "data": { "content": "决定追加预算", "type": "decision", ... } }
          ],
          "total": 2
        }
      }
    },
    "search_segments": {
      "description": "仅搜索音频片段，是 search() 的结果过滤器",
      "input": { "query": { "type": "string" }, "filters": { "type": "object" }, "top_k": { "type": "integer", "default": 5 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/SearchResultItem" } }
    },
    "search_events": {
      "description": "仅搜索事件",
      "input": { "query": { "type": "string" }, "filters": { "type": "object" }, "top_k": { "type": "integer", "default": 5 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/SearchResultItem" } }
    },
    "search_reminders": {
      "description": "仅搜索提醒",
      "input": { "query": { "type": "string" }, "filters": { "type": "object" }, "top_k": { "type": "integer", "default": 5 } },
      "returns": { "type": "array", "items": { "$ref": "#/definitions/SearchResultItem" } }
    }
  }
}
```

> **SQL 回退模式各类型权重：**
> | 类型 | score | 说明 |
> |------|-------|------|
> | person       | 0.6 | 人名匹配度最高 |
> | segment      | 0.5 | 文本片段精确匹配 |
> | event        | 0.4 | 事件内容匹配 |
> | reminder     | 0.35 | 提醒标题/内容匹配 |
> | conversation | 0.3 | 对话标题/摘要匹配 |

---

## 10. 人物关系子图接口

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "QueryService.get_person_subgraph",
  "description": "获取以某人为中心的局部关系图。优先走 GraphStore，降级到 SQL 拼凑。供智能体7使用。",
  "input": {
    "type": "object",
    "required": ["person_id"],
    "properties": {
      "person_id": { "type": "string", "description": "人物 ID" },
      "depth":     { "type": "integer", "default": 2, "description": "关联深度（仅占位，当前 SQL 降级仅一层）" }
    }
  },
  "returns": {
    "type": "object",
    "required": ["nodes", "edges"],
    "properties": {
      "nodes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id":    { "type": "string" },
            "type":  { "type": "string", "enum": ["person", "conversation", "event"] },
            "label": { "type": "string", "description": "节点显示名" }
          }
        }
      },
      "edges": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "from":     { "type": "string", "description": "源节点 ID" },
            "to":       { "type": "string", "description": "目标节点 ID" },
            "relation": { "type": "string", "enum": ["participated_in", "mentioned_in"], "description": "关系类型" }
          }
        }
      }
    }
  },
  "example": {
    "request":  { "person_id": "uuid-张三" },
    "response": {
      "nodes": [
        { "id": "uuid-张三", "type": "person", "label": "张三" },
        { "id": "uuid-会议1", "type": "conversation", "label": "Q2规划会" },
        { "id": "uuid-事件1", "type": "event", "label": "张三负责前端原型" }
      ],
      "edges": [
        { "from": "uuid-张三", "to": "uuid-会议1", "relation": "participated_in" },
        { "from": "uuid-张三", "to": "uuid-事件1", "relation": "mentioned_in" }
      ]
    }
  }
}
```

---

## 11. 向量检索预留接口 (VectorStore)

> **当前状态：空实现**。所有方法抛出 `NotImplementedError`。
> 待智能体3/4 的 RAG 模块填充实现。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VectorStore",
  "description": "语义向量检索（预留）。后端预期为 FAISS + Sentence-Transformer 或 OpenAI Embedding API。",
  "properties": {
    "index_path": { "type": ["string", "null"], "description": "FAISS 索引文件路径" }
  },
  "methods": {
    "initialize": {
      "description": "初始化索引：加载已有 index_path 或创建新索引；记录向量维度",
      "input": {},
      "returns": { "type": "null" }
    },
    "add_embedding": {
      "description": "为一条文本片段生成向量并加入索引",
      "input": {
        "segment_id": { "type": "string" },
        "text":       { "type": "string" },
        "metadata":   { "type": "object", "properties": {
          "conversation_id": { "type": "string" },
          "person_id": { "type": "string" },
          "timestamp": { "type": "string" }
        }}
      },
      "returns": { "type": "null" }
    },
    "add_embeddings_batch": {
      "description": "批量添加嵌入",
      "input": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "segment_id": { "type": "string" },
              "text":       { "type": "string" },
              "metadata":   { "type": "object" }
            },
            "required": ["segment_id", "text"]
          }
        }
      },
      "returns": { "type": "null" }
    },
    "search": {
      "description": "语义检索最相似的 Top-K 片段",
      "input": {
        "query":   { "type": "string" },
        "filters": { "type": "object", "description": "后过滤条件，同 QueryService.search().filters" },
        "top_k":   { "type": "integer", "default": 5 }
      },
      "returns": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "segment_id": { "type": "string" },
            "text":       { "type": "string" },
            "score":      { "type": "number", "description": "余弦相似度 / L2 距离分数" },
            "metadata":   { "type": "object" }
          }
        }
      }
    },
    "save":  { "description": "持久化索引到磁盘", "input": {}, "returns": {} },
    "load":  { "description": "从磁盘加载索引",   "input": {}, "returns": {} },
    "size":  { "description": "当前索引中的向量数量", "input": {}, "returns": { "type": "integer" } }
  }
}
```

---

## 12. 图关系预留接口 (GraphStore)

> **当前状态：空实现**。所有方法抛出 `NotImplementedError`。
> 待智能体7 的知识图谱可视化模块填充实现。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GraphStore",
  "description": "图关系存储。后端预期为 NetworkX（本地）或 Neo4j（服务端）。",
  "nodes": [
    { "type": "person",       "label_field": "name" },
    { "type": "conversation", "label_field": "title" },
    { "type": "event",        "label_field": "content" }
  ],
  "edge_types": ["participated_in", "mentioned_in", "triggered", "related_to"],
  "methods": {
    "initialize": { "description": "初始化图存储（NetworkX 创建 / Neo4j 连接）" },
    "add_person_node": {
      "input": { "person_id": { "type": "string" }, "name": { "type": "string" }, "properties": { "type": "object" } }
    },
    "add_conversation_node": {
      "input": { "conversation_id": { "type": "string" }, "title": { "type": "string" }, "properties": { "type": "object" } }
    },
    "add_event_node": {
      "input": { "event_id": { "type": "string" }, "event_type": { "type": "string" }, "content": { "type": "string" }, "properties": { "type": "object" } }
    },
    "add_edge": {
      "input": {
        "from_id":   { "type": "string" },
        "to_id":     { "type": "string" },
        "relation":  { "type": "string", "enum": ["participated_in", "mentioned_in", "triggered", "related_to"] },
        "properties": { "type": "object" }
      }
    },
    "get_person_graph": {
      "description": "获取某人为中心的局部子图（返回格式同 QueryService.get_person_subgraph）",
      "input": { "person_id": { "type": "string" }, "depth": { "type": "integer", "default": 2 } },
      "returns": {
        "type": "object",
        "properties": {
          "nodes": { "type": "array", "items": { "type": "object" } },
          "edges": { "type": "array", "items": { "type": "object" } }
        }
      }
    },
    "get_conversation_graph": {
      "description": "获取某对话的完整事件-人物关系图",
      "input": { "conversation_id": { "type": "string" } },
      "returns": { "type": "object", "properties": { "nodes": { "type": "array" }, "edges": { "type": "array" } } }
    },
    "query": {
      "description": "自定义图查询（Cypher 格式取决于具体图库）",
      "input": { "cypher": { "type": "string" } },
      "returns": { "type": "array", "items": { "type": "object" } }
    },
    "rebuild_from_sqlite": {
      "description": "遍历 SQLite 全表重建节点和边关系"
    },
    "save": { "description": "持久化图数据到磁盘" }
  }
}
```

---

## 13. SQL 表结构定义

### 13.1 conversations

```json
{
  "table": "conversations",
  "columns": [
    { "name": "id",              "type": "TEXT",    "constraints": "PRIMARY KEY" },
    { "name": "title",           "type": "TEXT",    "constraints": "NOT NULL DEFAULT ''" },
    { "name": "start_time",      "type": "TEXT",    "constraints": "NOT NULL" },
    { "name": "end_time",        "type": "TEXT",    "constraints": "" },
    { "name": "participant_ids", "type": "TEXT",    "constraints": "DEFAULT '[]'", "description": "JSON 数组字符串" },
    { "name": "summary",         "type": "TEXT",    "constraints": "DEFAULT ''" },
    { "name": "status",          "type": "TEXT",    "constraints": "NOT NULL DEFAULT 'active'", "enum": ["active", "completed", "archived"] },
    { "name": "created_at",      "type": "TEXT",    "constraints": "NOT NULL" },
    { "name": "updated_at",      "type": "TEXT",    "constraints": "NOT NULL" }
  ],
  "indexes": [
    { "name": "idx_conversations_status", "columns": ["status"] }
  ]
}
```

### 13.2 persons

```json
{
  "table": "persons",
  "columns": [
    { "name": "id",          "type": "TEXT", "constraints": "PRIMARY KEY" },
    { "name": "name",        "type": "TEXT", "constraints": "NOT NULL" },
    { "name": "role",        "type": "TEXT", "constraints": "DEFAULT 'speaker'", "enum": ["speaker", "user", "assistant", "unknown"] },
    { "name": "voice_print", "type": "TEXT", "constraints": "", "description": "声纹特征 JSON（预留）" },
    { "name": "meta_info",   "type": "TEXT", "constraints": "DEFAULT '{}'", "description": "扩展元信息 JSON" },
    { "name": "created_at",  "type": "TEXT", "constraints": "NOT NULL" },
    { "name": "updated_at",  "type": "TEXT", "constraints": "NOT NULL" }
  ],
  "indexes": []
}
```

### 13.3 events

```json
{
  "table": "events",
  "columns": [
    { "name": "id",                  "type": "TEXT", "constraints": "PRIMARY KEY" },
    { "name": "conversation_id",     "type": "TEXT", "constraints": "NOT NULL REFERENCES conversations(id) ON DELETE CASCADE" },
    { "name": "type",                "type": "TEXT", "constraints": "NOT NULL", "enum": ["action_item", "decision", "question", "note", "meeting_minutes"] },
    { "name": "content",             "type": "TEXT", "constraints": "NOT NULL" },
    { "name": "timestamp",           "type": "TEXT", "constraints": "" },
    { "name": "source_segment_id",   "type": "TEXT", "constraints": "" },
    { "name": "involved_person_ids", "type": "TEXT", "constraints": "DEFAULT '[]'", "description": "JSON 数组字符串" },
    { "name": "created_at",          "type": "TEXT", "constraints": "NOT NULL" }
  ],
  "indexes": [
    { "name": "idx_events_conversation", "columns": ["conversation_id"] },
    { "name": "idx_events_type",         "columns": ["type"] }
  ]
}
```

### 13.4 reminders

```json
{
  "table": "reminders",
  "columns": [
    { "name": "id",                 "type": "TEXT",    "constraints": "PRIMARY KEY" },
    { "name": "event_id",           "type": "TEXT",    "constraints": "REFERENCES events(id) ON DELETE SET NULL" },
    { "name": "title",              "type": "TEXT",    "constraints": "NOT NULL" },
    { "name": "content",            "type": "TEXT",    "constraints": "DEFAULT ''" },
    { "name": "due_time",           "type": "TEXT",    "constraints": "" },
    { "name": "status",             "type": "TEXT",    "constraints": "NOT NULL DEFAULT 'pending'", "enum": ["pending", "triggered", "dismissed", "completed"] },
    { "name": "priority",           "type": "INTEGER", "constraints": "NOT NULL DEFAULT 3" },
    { "name": "trigger_conditions", "type": "TEXT",    "constraints": "DEFAULT '{}'", "description": "JSON 对象字符串（预留）" },
    { "name": "created_at",         "type": "TEXT",    "constraints": "NOT NULL" },
    { "name": "updated_at",         "type": "TEXT",    "constraints": "NOT NULL" }
  ],
  "indexes": [
    { "name": "idx_reminders_status", "columns": ["status"] },
    { "name": "idx_reminders_due",    "columns": ["due_time"] }
  ]
}
```

### 13.5 segments

```json
{
  "table": "segments",
  "columns": [
    { "name": "id",               "type": "TEXT",  "constraints": "PRIMARY KEY" },
    { "name": "conversation_id",  "type": "TEXT",  "constraints": "NOT NULL REFERENCES conversations(id) ON DELETE CASCADE" },
    { "name": "person_id",        "type": "TEXT",  "constraints": "REFERENCES persons(id) ON DELETE SET NULL" },
    { "name": "start_time",       "type": "REAL",  "constraints": "NOT NULL DEFAULT 0", "description": "秒，相对对话开始" },
    { "name": "end_time",         "type": "REAL",  "constraints": "" },
    { "name": "text",             "type": "TEXT",  "constraints": "NOT NULL DEFAULT ''" },
    { "name": "embedding",        "type": "BLOB",  "constraints": "", "description": "向量嵌入二进制" },
    { "name": "created_at",       "type": "TEXT",  "constraints": "NOT NULL" }
  ],
  "indexes": [
    { "name": "idx_segments_conversation", "columns": ["conversation_id"] },
    { "name": "idx_segments_person",       "columns": ["person_id"] }
  ]
}
```

---

## 附录：智能体间调用关系

| 调用方 | 使用的接口 | 频率 | 场景 |
|--------|-----------|------|------|
| 智能体3 (ASR/说话人分离) | `SegmentRepository.insert()` / `find_by_conversation()` / `update_embedding()` | 高频 | 写入转写片段 |
| 智能体4 (语义分析/RAG) | `QueryService.search()` / `VectorStore.*` / `SegmentRepository.find_by_text_like()` | 高频 | 基于查询的语义检索 |
| 智能体4 (语义分析/RAG) | `EventRepository.insert()` / `ConversationRepository.mark_completed()` | 中频 | 写入事件、摘要 |
| 智能体6 (智能提醒) | `ReminderRepository.find_overdue()` / `find_pending()` / `mark_*()` | 定时轮询 | 检查到期提醒并触发 |
| 智能体6 (智能提醒) | `ReminderRepository.insert()` | 中频 | 从事件创建提醒 |
| 智能体7 (知识图谱) | `QueryService.get_person_subgraph()` / `GraphStore.*` | 低频 | 查询人物关系供可视化 |
| 智能体7 (知识图谱) | `PersonRepository.*()` / `EventRepository.*()` | 低频 | 节点/边数据查询 |

所有接口使用 **同步阻塞** 调用模式（Python 函数直接返回）。后续如需异步化，在调用方侧用 `asyncio.to_thread()` 包装即可。
