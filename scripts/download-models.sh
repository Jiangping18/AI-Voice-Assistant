#!/usr/bin/env bash
# =============================================================
# AI 录音助手 - 模型下载脚本
#
# 自动下载 ASR 所需的离线模型文件并放置到项目 models/ 目录。
# 模型来源：Sherpa-ONNX 官方 Releases（GitHub）
#
# 用法:
#   chmod +x scripts/download-models.sh
#   bash scripts/download-models.sh
#
# 所需硬盘空间: ~400MB（SenseVoice）+ ~50MB（说话人嵌入）
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODELS_DIR="${PROJECT_ROOT}/models"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 下载函数：带断点续传
download_model() {
    local url="$1"
    local output_dir="$2"
    local filename="$3"

    mkdir -p "${output_dir}"

    if [ -f "${output_dir}/${filename}" ]; then
        log_info "文件已存在，跳过: ${filename}"
        return 0
    fi

    log_info "正在下载: ${filename} ..."
    log_info "来源: ${url}"

    # 使用 curl 下载（支持断点续传 -C -）
    if command -v curl &> /dev/null; then
        curl -#L -C - -o "${output_dir}/${filename}" "${url}" || {
            log_error "下载失败: ${filename}"
            return 1
        }
    elif command -v wget &> /dev/null; then
        wget -c -O "${output_dir}/${filename}" "${url}" || {
            log_error "下载失败: ${filename}"
            return 1
        }
    else
        log_error "请安装 curl 或 wget"
        return 1
    fi

    log_info "下载完成: ${filename}"
}

# 解压 .tar.bz2 文件
extract_bz2() {
    local archive="$1"
    local output_dir="$2"

    if [ ! -f "${archive}" ]; then
        log_warn "压缩包不存在: ${archive}"
        return 1
    fi

    log_info "正在解压: $(basename ${archive}) ..."

    if command -v tar &> /dev/null; then
        tar xjf "${archive}" -C "${output_dir}"
    else
        log_error "请安装 tar"
        return 1
    fi

    log_info "解压完成"
}

# =============================================================
# 模型列表
# =============================================================

# 1. SenseVoiceSmall INT8 量化模型（中/英/日/韩/粤）
# 推荐用于 ASR 语音识别，支持流式解码
SENSE_VOICE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
SENSE_VOICE_DIR="${MODELS_DIR}/sense-voice-int8"
SENSE_VOICE_ARCHIVE="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"

# 2. 3D-Speaker 说话人嵌入模型（用于说话人分离）
SPEAKER_EMBEDDING_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"
SPEAKER_EMBEDDING_DIR="${MODELS_DIR}/speaker-embedding"
SPEAKER_EMBEDDING_FILE="3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"

# 3. （可选）标点补全模型
PUNCTUATION_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-punct-ctransformer-zh-en-vocab4991-2024-04-14.tar.bz2"
PUNCTUATION_DIR="${MODELS_DIR}/punctuation"
PUNCTUATION_ARCHIVE="sherpa-onnx-punct-ctransformer-zh-en-vocab4991-2024-04-14.tar.bz2"

# =============================================================
# 主流程
# =============================================================

main() {
    echo ""
    echo "============================================================"
    echo "  AI 录音助手 - 模型下载工具"
    echo "============================================================"
    echo ""

    # 检查目标目录
    mkdir -p "${MODELS_DIR}"
    log_info "模型将保存至: ${MODELS_DIR}"
    echo ""

    # ---- 1. 下载 SenseVoiceSmall INT8 ----
    log_info "===== 1/3: SenseVoiceSmall INT8 量化模型 ====="
    log_info "用途: ASR 语音识别（中文/英文/日文/韩文/粤语）"
    log_info "大小: ~400MB"
    echo ""

    download_model "${SENSE_VOICE_URL}" "${MODELS_DIR}" "${SENSE_VOICE_ARCHIVE}"
    extract_bz2 "${MODELS_DIR}/${SENSE_VOICE_ARCHIVE}" "${SENSE_VOICE_DIR}"

    # 将解压后的文件移动到目标目录（解压会创建子目录）
    EXTRACTED_DIR="${MODELS_DIR}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
    if [ -d "${EXTRACTED_DIR}" ]; then
        mv "${EXTRACTED_DIR}"/* "${SENSE_VOICE_DIR}/"
        rmdir "${EXTRACTED_DIR}" 2>/dev/null || true
    fi

    # 清理压缩包
    rm -f "${MODELS_DIR}/${SENSE_VOICE_ARCHIVE}"

    echo ""

    # ---- 2. 下载说话人嵌入模型 ----
    log_info "===== 2/3: 3D-Speaker 说话人嵌入模型 ====="
    log_info "用途: 说话人分离 / 声纹识别"
    log_info "大小: ~50MB"
    echo ""

    download_model "${SPEAKER_EMBEDDING_URL}" "${SPEAKER_EMBEDDING_DIR}" "${SPEAKER_EMBEDDING_FILE}"

    echo ""

    # ---- 3. （可选）标点补全模型 ----
    log_info "===== 3/3: 标点补全模型（可选）====="
    log_info "用途: 提升标点恢复准确率（不使用则用规则补全）"
    log_info "大小: ~30MB"
    echo ""

    download_model "${PUNCTUATION_URL}" "${MODELS_DIR}" "${PUNCTUATION_ARCHIVE}"
    extract_bz2 "${MODELS_DIR}/${PUNCTUATION_ARCHIVE}" "${PUNCTUATION_DIR}"

    EXTRACTED_PUNCT="${MODELS_DIR}/sherpa-onnx-punct-ctransformer-zh-en-vocab4991-2024-04-14"
    if [ -d "${EXTRACTED_PUNCT}" ]; then
        mv "${EXTRACTED_PUNCT}"/* "${PUNCTUATION_DIR}/"
        rmdir "${EXTRACTED_PUNCT}" 2>/dev/null || true
    fi
    rm -f "${MODELS_DIR}/${PUNCTUATION_ARCHIVE}"

    echo ""
    echo "============================================================"
    echo -e "${GREEN}所有模型下载完成！${NC}"
    echo ""
    echo "模型目录结构:"
    ls -lh "${MODELS_DIR}/sense-voice-int8/" 2>/dev/null || echo "  sense-voice-int8/ （SenseVoice 模型）"
    ls -lh "${MODELS_DIR}/speaker-embedding/" 2>/dev/null || echo "  speaker-embedding/ （说话人嵌入模型）"
    ls -lh "${MODELS_DIR}/punctuation/" 2>/dev/null || echo "  punctuation/ （标点补全模型）"
    echo "============================================================"
}

main "$@"
