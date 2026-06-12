# 离线模型文件

本目录存放 ASR（语音识别）和说话人分离所需的离线模型文件。

## 目录结构

```
models/
├── sense-voice-int8/           # SenseVoiceSmall INT8 量化模型（ASR）
│   ├── sense-voice-encoder.int8.onnx
│   ├── sense-voice-decoder.onnx
│   ├── sense-voice-joiner.onnx
│   └── tokens.txt
├── speaker-embedding/          # 3D-Speaker 说话人嵌入模型（说话人分离）
│   └── 3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx
└── punctuation/                # （可选）标点补全模型
    └── (model files)
```

## 模型下载

### 方式一：自动脚本（推荐）

```bash
bash scripts/download-models.sh
```

该脚本自动下载所有所需的模型文件并解压到对应目录。

### 方式二：手动下载

| 模型 | 用途 | 来源 |
|------|------|------|
| SenseVoiceSmall INT8 | ASR 语音识别（中文/英文/日文/韩文/粤语） | [Sherpa-ONNX Releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) |
| CAM++ 3D-Speaker | 说话人嵌入提取（说话人分离） | [3D-Speaker](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) |
| CT-Transformer | （可选）标点补全 | [Punct Model](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) |

### 方式三：HuggingFace

也可从 HuggingFace 下载 SenseVoice 模型：

```bash
pip install huggingface-hub
huggingface-cli download FunAudioLLM/SenseVoiceSmall --local-dir models/sense-voice-int8
```

## 模型说明

- **SenseVoiceSmall INT8**: 阿里达摩院开源的多语言语音识别模型，INT8 量化后体积约 400MB，支持流式解码
- **CAM++ 3D-Speaker**: 中科信之声纹识别模型，用于提取说话人嵌入向量进行聚类分离
- **CT-Transformer**: 基于 Transformer 的标点恢复模型（可选，不下载则使用规则补全）

## 注意事项

- 模型文件需自行下载，受各自开源许可证约束
- 量化模型已做 INT8 量化，在保证精度的同时显著降低推理资源
- 所有模型均为 ONNX 格式，无需 CUDA 即可在 CPU 上运行
- 模型文件默认被 `.gitignore` 忽略，不会被提交到 Git 仓库
