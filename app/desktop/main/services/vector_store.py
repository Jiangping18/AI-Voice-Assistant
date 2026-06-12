"""
向量检索接口（占位模块）

职责（后续由 智能体3/4 的 RAG 模块填充）：
  1. 使用 Sentence-Transformer / OpenAI Embedding API 生成文本向量
  2. 使用 FAISS / ChromaDB 等 ANN 引擎进行语义检索
  3. 返回与 query 语义最相似的 Top-K 片段

当前状态: 空实现，所有方法抛出 NotImplementedError
"""

from typing import Any, Optional


class VectorStore:
    """
    向量存储与语义检索服务

    对外暴露的检索接口格式:
        search(query="文本", filters={...}, top_k=5) -> list[dict]
    """

    def __init__(self, index_path: Optional[str] = None):
        self._index_path = index_path
        self._dimension = 0

    def initialize(self):
        """初始化索引"""
        raise NotImplementedError("向量索引尚未实现。请集成 Sentence-Transformer + FAISS。")

    def add_embedding(self, segment_id: str, text: str, metadata: dict = None):
        """为一条文本片段生成向量并加入索引"""
        raise NotImplementedError(f"add_embedding({segment_id}) 未实现")

    def add_embeddings_batch(self, items: list[dict]):
        """批量添加嵌入"""
        raise NotImplementedError("batch_add_embeddings 未实现")

    def search(self, query: str, filters: dict = None, top_k: int = 5) -> list[dict]:
        """语义检索最相似的 Top-K 片段"""
        raise NotImplementedError(f"向量检索 search(query='{query}', top_k={top_k}) 未实现")

    def save(self):
        """持久化索引到磁盘"""
        raise NotImplementedError("vector_store.save() 未实现")

    def load(self):
        """从磁盘加载索引"""
        raise NotImplementedError("vector_store.load() 未实现")

    def size(self) -> int:
        """当前索引中的向量数量"""
        raise NotImplementedError("vector_store.size() 未实现")
