/// graph_page.dart - 移动端知识图谱页面
///
/// 通过 WebView 加载 ECharts 图谱，支持：
/// 1. 触控手势（双指缩放 / 单指平移 / 单击节点）
/// 2. 节点数 ≤ 50，两层关系
/// 3. 搜索高亮
/// 4. 数据刷新
/// 5. 小屏适配

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'graph_bridge.dart';

// ============================
// WebView 导入方式配置
// ============================

/// 选择 WebView 实现：
/// - flutter_inappwebview: 功能最完善，支持 JS Bridge 和拦截
/// - webview_flutter: 轻量，Google 官方维护
///
/// 当前选用 flutter_inappwebview（需在 pubspec.yaml 添加依赖）
///   flutter_inappwebview: ^6.0.0

// 条件导入 - 根据实际项目配置选择
// import 'package:flutter_inappwebview/flutter_inappwebview.dart';

// ============================
// 图谱页面
// ============================

/// 页面状态枚举
enum GraphPageStatus {
  loading,
  loaded,
  error,
  empty,
}

/// 知识图谱页面
class GraphPage extends StatefulWidget {
  const GraphPage({super.key});

  @override
  State<GraphPage> createState() => _GraphPageState();
}

class _GraphPageState extends State<GraphPage> {
  // WebView 控制器 - 使用对应的 WebView 实现
  // final InAppWebViewController _webController = InAppWebViewController();
  // 由于 flutter_inappwebview 可能未安装，使用抽象控制
  dynamic _webController;

  GraphPageStatus _status = GraphPageStatus.loading;
  String _errorMessage = '';

  // 搜索控制器
  final TextEditingController _searchController = TextEditingController();
  bool _showSearch = false;

  // 图数据缓存
  GraphData? _cachedData;

  // 防抖定时器
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  // ============================
  // 数据加载
  // ============================

  /// 加载图谱数据
  Future<void> _loadData() async {
    try {
      setState(() => _status = GraphPageStatus.loading);

      // 模拟从 API 获取数据（实际项目替换为 GraphService 调用）
      await Future.delayed(const Duration(milliseconds: 800));
      final mockData = _generateMockData();
      _cachedData = mockData;

      _injectDataToWebView(mockData);

      setState(() => _status = GraphPageStatus.loaded);
    } catch (e) {
      setState(() {
        _status = GraphPageStatus.error;
        _errorMessage = e.toString();
      });
    }
  }

  /// 将数据注入 WebView
  Future<void> _injectDataToWebView(GraphData data) async {
    if (_webController == null) return;

    try {
      // flutter_inappwebview 方式：
      // await _webController.evaluateJavascript(
      //   source: GraphBridgeScripts.loadData(data),
      // );

      // webview_flutter 方式：
      // await _webController.runJavaScript(GraphBridgeScripts.loadData(data));
      debugPrint('[GraphPage] 注入数据: ${data.nodes.length} 节点, ${data.edges.length} 边');
    } catch (e) {
      debugPrint('[GraphPage] 数据注入失败: $e');
    }
  }

  /// 刷新数据
  Future<void> _refreshData() async {
    await _loadData();
  }

  // ============================
  // 搜索
  // ============================

  void _onSearchChanged(String keyword) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      if (_webController != null) {
        // await _webController.evaluateJavascript(
        //   source: GraphBridgeScripts.search(keyword),
        // );
        debugPrint('[GraphPage] 搜索: $keyword');
      }
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _onSearchChanged('');
    setState(() => _showSearch = false);
  }

  // ============================
  // 节点点击处理
  // ============================

  /// 处理 WebView 回调的节点点击事件
  void _handleNodeClick(String nodeJson) {
    try {
      final event = NodeClickEvent.fromJson(nodeJson);
      _showNodeDetail(event.node);
    } catch (e) {
      debugPrint('[GraphPage] 节点点击解析失败: $e');
    }
  }

  /// 显示节点详情弹窗
  void _showNodeDetail(GraphNode node) {
    final typeMap = {
      'person': '人物',
      'event': '事件',
      'conversation': '对话',
    };

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.45,
          minChildSize: 0.25,
          maxChildSize: 0.7,
          expand: false,
          builder: (context, scrollController) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: ListView(
                controller: scrollController,
                children: [
                  // 标题区
                  Row(
                    children: [
                      _buildTypeBadge(node.type),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          node.label,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'ID: ${node.id}',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[400],
                      fontFamily: 'monospace',
                    ),
                  ),
                  const Divider(height: 24),

                  // 属性列表
                  if (node.properties.isNotEmpty) ...[
                    const Text(
                      '属性信息',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: Colors.black87,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...node.properties.entries.map((entry) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 80,
                              child: Text(
                                entry.key,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.grey[600],
                                ),
                              ),
                            ),
                            Expanded(
                              child: Text(
                                '${entry.value}',
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],

                  if (node.properties.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        '暂无详细属性信息',
                        style: TextStyle(color: Colors.grey),
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// 节点类型标签
  Widget _buildTypeBadge(String type) {
    final config = switch (type) {
      'person' => ('人物', const Color(0xFF1890FF)),
      'event' => ('事件', const Color(0xFFF5222D)),
      'conversation' => ('对话', const Color(0xFF52C41A)),
      _ => (type, Colors.grey),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: config.$2.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: config.$2.withOpacity(0.3)),
      ),
      child: Text(
        config.$1,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: config.$2,
        ),
      ),
    );
  }

  // ============================
  // 模拟数据生成
  // ============================

  GraphData _generateMockData() {
    return GraphData(
      nodes: [
        GraphNode(id: 'p1', type: 'person', label: '张三', properties: {'role': '项目经理'}),
        GraphNode(id: 'p2', type: 'person', label: '李四', properties: {'role': '前端开发'}),
        GraphNode(id: 'p3', type: 'person', label: '王五', properties: {'role': '后端开发'}),
        GraphNode(id: 'p4', type: 'person', label: '赵六', properties: {'role': '测试工程师'}),
        GraphNode(id: 'e1', type: 'event', label: '需求评审会', properties: {'date': '2026-06-01'}),
        GraphNode(id: 'e2', type: 'event', label: '技术评审', properties: {'date': '2026-06-08'}),
        GraphNode(id: 'e3', type: 'event', label: 'Sprint规划', properties: {'date': '2026-06-10'}),
        GraphNode(id: 'c1', type: 'conversation', label: '项目启动会', properties: {}),
      ],
      edges: [
        GraphEdge(source: 'p1', target: 'e1', relation: '参与'),
        GraphEdge(source: 'p2', target: 'e1', relation: '参与'),
        GraphEdge(source: 'p3', target: 'e1', relation: '参与'),
        GraphEdge(source: 'p1', target: 'e2', relation: '参与'),
        GraphEdge(source: 'p3', target: 'e2', relation: '参与'),
        GraphEdge(source: 'p4', target: 'e3', relation: '参与'),
        GraphEdge(source: 'p1', target: 'c1', relation: '提及'),
        GraphEdge(source: 'e1', target: 'c1', relation: '触发'),
      ],
    );
  }

  // ============================
  // UI 构建
  // ============================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _buildAppBar(),
      body: _buildBody(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    if (_showSearch) {
      return AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: _clearSearch,
        ),
        title: TextField(
          controller: _searchController,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '搜索节点名称...',
            border: InputBorder.none,
            filled: false,
          ),
          onChanged: _onSearchChanged,
        ),
        actions: [
          if (_searchController.text.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.clear),
              onPressed: _clearSearch,
            ),
        ],
      );
    }

    return AppBar(
      title: const Text('知识图谱'),
      centerTitle: true,
      actions: [
        // 搜索按钮
        IconButton(
          icon: const Icon(Icons.search),
          onPressed: () => setState(() => _showSearch = true),
        ),
        // 刷新按钮
        IconButton(
          icon: const Icon(Icons.refresh),
          onPressed: _refreshData,
        ),
      ],
    );
  }

  Widget _buildBody() {
    return Stack(
      children: [
        // ---- WebView 图谱 ----
        _buildWebView(),

        // ---- 加载状态 ----
        if (_status == GraphPageStatus.loading)
          const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text('加载知识图谱...', style: TextStyle(color: Colors.grey)),
              ],
            ),
          ),

        // ---- 错误状态 ----
        if (_status == GraphPageStatus.error)
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, size: 48, color: Colors.red),
                const SizedBox(height: 16),
                Text('加载失败', style: TextStyle(fontSize: 16, color: Colors.grey[700])),
                const SizedBox(height: 8),
                Text(_errorMessage, style: TextStyle(fontSize: 13, color: Colors.grey[500])),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: _refreshData,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('重试'),
                ),
              ],
            ),
          ),

        // ---- 空数据状态 ----
        if (_status == GraphPageStatus.empty)
          const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.hub_outlined, size: 48, color: Colors.grey),
                SizedBox(height: 16),
                Text('暂无图谱数据', style: TextStyle(fontSize: 16, color: Colors.grey)),
              ],
            ),
          ),

        // ---- 底部快速搜索栏（非搜索模式） ----
        if (!_showSearch && _status == GraphPageStatus.loaded)
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: Material(
              elevation: 4,
              borderRadius: BorderRadius.circular(24),
              child: InkWell(
                borderRadius: BorderRadius.circular(24),
                onTap: () => setState(() => _showSearch = true),
                child: Container(
                  height: 44,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.search, size: 20, color: Colors.grey[400]),
                      const SizedBox(width: 8),
                      Text(
                        '搜索节点...',
                        style: TextStyle(color: Colors.grey[400], fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// 构建 WebView
  ///
  /// 使用 flutter_inappwebview 或 webview_flutter
  /// 此处给出两种方式的实现模板，根据项目实际依赖选择
  Widget _buildWebView() {
    // ==========================================================
    // 方式一：flutter_inappwebview（推荐，功能完整）
    // ==========================================================
    /*
    return InAppWebView(
      initialData: InAppWebViewInitialData(
        data: _loadWebViewHtml(),
        baseUrl: WebUri('https://local.graph/'),
      ),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        allowsInlineMediaPlayback: true,
        mediaPlaybackRequiresUserGesture: false,
        // 触控手势支持
        isInspectable: kDebugMode,
      ),
      onWebViewCreated: (controller) {
        _webController = controller;
      },
      onLoadStop: (controller, url) async {
        // WebView 加载完成后注入数据
        if (_cachedData != null) {
          await _injectDataToWebView(_cachedData!);
        }
        setState(() => _status = GraphPageStatus.loaded);
      },
      // 接收 JS Bridge 回调
      shouldOverrideUrlLoading: (controller, navigationAction) {
        // 拦截自定义 URL Scheme 处理节点点击
        final uri = navigationAction.request.url;
        if (uri != null && uri.scheme == 'graph') {
          final nodeJson = Uri.decodeComponent(uri.queryParameters['node'] ?? '');
          if (nodeJson.isNotEmpty) {
            _handleNodeClick(nodeJson);
          }
          return NavigationActionPolicy.CANCEL;
        }
        return NavigationActionPolicy.ALLOW;
      },
    );
    */

    // ==========================================================
    // 方式二：webview_flutter（轻量）
    // ==========================================================
    /*
    return WebView(
      initialHtml: _loadWebViewHtml(),
      javascriptMode: JavascriptMode.unrestricted,
      onWebViewCreated: (controller) {
        _webController = controller;
      },
      onPageFinished: (url) async {
        if (_cachedData != null) {
          await _injectDataToWebView(_cachedData!);
        }
      },
      javascriptChannels: [
        JavascriptChannel(
          name: 'NodeClick',
          onMessageReceived: (message) {
            _handleNodeClick(message.message);
          },
        ),
      ].toSet(),
    );
    */

    // ==========================================================
    // 占位实现：显示提示（WebView 需要安装对应依赖包）
    // ==========================================================
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.info_outline, size: 40, color: Colors.grey),
            const SizedBox(height: 16),
            Text(
              'WebView 图谱渲染',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.grey[700]),
            ),
            const SizedBox(height: 8),
            Text(
              'graph_page.dart 使用 WebView 加载 webview_graph.html\n'
              '内置 ECharts 轻量图谱渲染\n\n'
              '依赖：flutter_inappwebview ^6.0.0\n'
              '或 webview_flutter ^4.0.0',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey[500], height: 1.6),
            ),
            const SizedBox(height: 8),
            Text(
              '节点数: ${_cachedData?.nodes.length ?? 0} | '
              '边数: ${_cachedData?.edges.length ?? 0}',
              style: TextStyle(fontSize: 12, color: Colors.grey[400]),
            ),
          ],
        ),
      ),
    );
  }

  /// 加载 WebView 图谱 HTML
  String _loadWebViewHtml() {
    // 实际项目中，从 assets 加载 webview_graph.html
    // return rootBundle.loadString('assets/webview/graph.html');
    return '''
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
  <p>WebView 图谱页面将在此渲染</p>
  <p>请确保已配置 flutter_inappwebview 依赖</p>
</body>
</html>
''';
  }
}
