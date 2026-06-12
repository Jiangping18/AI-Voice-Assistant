#!/bin/bash
# ====================================================================
#  Silero VAD v5 ONNX 模型下载脚本
#
#  下载官方预训练模型并放到 assets/models/ 目录
#
#  模型来源: https://github.com/snakers4/silero-vad
#  ONNX 模型地址:
#    https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx
#
#  使用方法:
#    chmod +x scripts/download_silero_vad.sh
#    ./scripts/download_silero_vad.sh
# ====================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/assets/models"

mkdir -p "$OUTPUT_DIR"

MODEL_URL="https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
MODEL_PATH="$OUTPUT_DIR/silero_vad.onnx"

echo "=========================================="
echo "  下载 Silero VAD v5 ONNX 模型"
echo "=========================================="
echo "来源: $MODEL_URL"
echo "保存到: $MODEL_PATH"
echo ""

if [ -f "$MODEL_PATH" ]; then
    echo "模型文件已存在，跳过下载"
    ls -lh "$MODEL_PATH"
    exit 0
fi

echo "正在下载... (约 1.7MB)"
if command -v curl &> /dev/null; then
    curl -L -o "$MODEL_PATH" "$MODEL_URL" --progress-bar
elif command -v wget &> /dev/null; then
    wget -O "$MODEL_PATH" "$MODEL_URL" -q --show-progress
else
    echo "错误: 需要 curl 或 wget"
    exit 1
fi

echo ""
echo "下载完成!"
ls -lh "$MODEL_PATH"
echo ""
echo "提示: 在 pubspec.yaml 中确认 assets 已包含:"
echo "  assets:"
echo "    - assets/models/"
