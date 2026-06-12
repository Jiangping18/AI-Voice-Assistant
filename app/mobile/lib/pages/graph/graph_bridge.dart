/// graph_bridge.dart - 图谱 WebView 与 Flutter 通信桥梁
///
/// 职责：
/// 1. 封装 WebView 与图谱页面的 JS 通信
/// 2. 提供 Dart 侧的图数据模型
/// 3. 处理节点点击回调

import 'dart:convert';

// ============================
// 图数据模型（Dart 侧）
// ============================

/// 图节点
class GraphNode {
  final String id;
  final String type; // person / event / conversation
  final String label;
  final Map<String, dynamic> properties;

  GraphNode({
    required this.id,
    required this.type,
    required this.label,
    this.properties = const {},
  });

  factory GraphNode.fromJson(Map<String, dynamic> json) {
    return GraphNode(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? 'person',
      label: json['label'] as String? ?? '',
      properties: json['properties'] as Map<String, dynamic>? ?? {},
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'label': label,
    'properties': properties,
  };
}

/// 图边
class GraphEdge {
  final String source;
  final String target;
  final String relation;
  final Map<String, dynamic> properties;

  GraphEdge({
    required this.source,
    required this.target,
    required this.relation,
    this.properties = const {},
  });

  factory GraphEdge.fromJson(Map<String, dynamic> json) {
    return GraphEdge(
      source: json['source'] as String? ?? '',
      target: json['target'] as String? ?? '',
      relation: json['relation'] as String? ?? '',
      properties: json['properties'] as Map<String, dynamic>? ?? {},
    );
  }

  Map<String, dynamic> toJson() => {
    'source': source,
    'target': target,
    'relation': relation,
    'properties': properties,
  };
}

/// 完整图数据
class GraphData {
  final List<GraphNode> nodes;
  final List<GraphEdge> edges;

  GraphData({required this.nodes, required this.edges});

  factory GraphData.fromJson(Map<String, dynamic> json) {
    return GraphData(
      nodes: (json['nodes'] as List<dynamic>?)
              ?.map((e) => GraphNode.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      edges: (json['edges'] as List<dynamic>?)
              ?.map((e) => GraphEdge.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toJson() => {
    'nodes': nodes.map((n) => n.toJson()).toList(),
    'edges': edges.map((e) => e.toJson()).toList(),
  };

  String toJsonString() => jsonEncode(toJson());
}

/// 节点点击回调数据
class NodeClickEvent {
  final GraphNode node;

  NodeClickEvent({required this.node});

  factory NodeClickEvent.fromJson(String jsonStr) {
    final map = jsonDecode(jsonStr) as Map<String, dynamic>;
    return NodeClickEvent(node: GraphNode.fromJson(map));
  }
}

// ============================
// 通信工具
// ============================

/// WebView JavaScript 执行脚本工厂
class GraphBridgeScripts {
  /// 加载图数据到 WebView
  static String loadData(GraphData data) {
    final jsonStr = data.toJsonString();
    return 'window.loadGraphData($jsonStr)';
  }

  /// 搜索高亮节点
  static String search(String keyword) {
    final escaped = keyword.replaceAll("'", "\\'");
    return "window.searchNodes('$escaped')";
  }

  /// 增量更新数据
  static String updateData(GraphData data) {
    final jsonStr = data.toJsonString();
    return 'window.updateGraphData($jsonStr)';
  }

  /// 获取当前 WebView 页面状态
  static String getStatus() {
    return 'document.getElementById("loading-state").style.display';
  }
}
