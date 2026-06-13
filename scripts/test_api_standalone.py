#!/usr/bin/env python3
"""
DeepSeek API 独立测试脚本 — 不依赖任何 services 模块
"""
import json, os, urllib.request

# 读 Key（自动检测编码）
key_file = os.path.join(os.path.dirname(__file__), '..', 'config', 'deepseek_key.txt')
with open(key_file, 'rb') as f:
    raw = f.read()
# 尝试多种编码
for enc in ['utf-8', 'utf-16', 'gbk', 'latin-1']:
    try:
        api_key = raw.decode(enc).strip()
        if api_key:
            break
    except UnicodeDecodeError:
        continue
print(f"Key 文件前10字节: {raw[:10]}")

# 清理代理
for k in ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']:
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'

# 测试用对话文本
text = "张总您好，我们来讨论一下下周的版本发布计划。好的，先说说目前的进度吧，前端基本完成了，只剩支付页面的适配还没做，预计后天能完工。"

payload = {
    "model": "deepseek-chat",
    "messages": [
        {"role": "system", "content": '你是一个对话分析助手。输出JSON格式：{"summary":"摘要","emotion":{"overall":"积极/中性/消极"},"entities":{"persons":[],"events":[]},"reminders":[{"content":"","assignee":"","deadline":"2026-06-20T23:59:59+08:00"}]}'},
        {"role": "user", "content": text}
    ],
    "temperature": 0.1,
    "response_format": {"type": "json_object"},
}

data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
req = urllib.request.Request(
    'https://api.deepseek.com/v1/chat/completions',
    data=data,
    headers={'Content-Type': 'application/json; charset=utf-8',
             'Authorization': f'Bearer {api_key}'},
    method='POST',
)

print("1. 调用 DeepSeek API...")
try:
    resp = urllib.request.urlopen(req, timeout=60)
    raw = resp.read()
    print(f"2. 收到响应: {len(raw)} bytes")
    print(f"   前20字节: {raw[:20]}")

    text_resp = raw.decode('utf-8')
    print("3. UTF-8 解码成功")

    api_resp = json.loads(text_resp)
    content = api_resp['choices'][0]['message']['content']
    print("4. JSON 解析成功")

    result = json.loads(content)
    print(f"\n=== 结果 ===")
    print(f"摘要: {result.get('summary','')[:80]}")
    print(f"情绪: {result.get('emotion',{}).get('overall','')}")
    print(f"人物: {len(result.get('entities',{}).get('persons',[]))}人")
    print(f"待办: {len(result.get('reminders',[]))}条")
    if result.get('reminders'):
        for r in result['reminders']:
            print(f"  - {r.get('content','')} ({r.get('assignee','')}, {r.get('deadline','')})")
    print("\n✅ API 测试通过!")

except UnicodeDecodeError as e:
    print(f"❌ UTF-8 解码失败: {e}")
    print(f"   响应前20字节: {raw[:20]}")
except Exception as e:
    print(f"❌ 错误: {type(e).__name__}: {e}")
    if hasattr(e, 'read'):
        print(f"   响应体: {e.read()[:200]}")
