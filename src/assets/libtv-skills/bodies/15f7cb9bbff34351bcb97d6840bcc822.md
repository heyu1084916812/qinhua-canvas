---

## name: libtv-video-creator description: &gt; LibTV 视频创作全流程 Skill。覆盖剧本生成、分镜设计、视频生成、批量下载的完整工作流。 适用场景：一句话生成短剧/漫剧、复刻视频/TVC、音乐MV、产品广告片、教育视频、分镜故事板。 当用户提到"生成视频"、"做视频"、"拍短片"、"写剧本"、"做分镜"、"复刻这个视频"、"用这首歌做MV"、 "生成短剧"、"产品宣传片"等需求时触发。 关键词：libtv、liblib、视频创作、短片、剧本、分镜、MV、TVC、宣传片、短剧、视频生成。 user-invocable: true metadata: openclaw: emoji: 🎬 requires: bins: \["python3"\] env: \["LIBTV_ACCESS_KEY"\] primaryEnv: "LIBTV_ACCESS_KEY"

# LibTV 视频创作全流程

通过 LibTV 的 Agent-IM OpenAPI 完成从剧本到成片的完整视频创作流程。

## 平台核心能力

- **剧本生成**：输入一句话创意，自动生成完整剧本（含分镜描述、对白、镜头语言）
- **分镜设计**：一键生成九宫格/多机位分镜图、剧情推演四宫格、角色三视图
- **视频生成**：文生视频、图生视频、视频续写、风格迁移
- **复杂创作**：一句话生成完整短剧（剧本→分镜→成片）、复刻视频风格做 TVC/宣传片、用音乐生成 MV、产品展示片制作
- **模型**：Seedance 2.0、Kling 3.0/O3、Wan 2.6、NanoBanana、Midjourney、Seedream 5.0 等

## 功能脚本

脚本用途`create_session.py`创建会话 / 发送消息`query_session.py`查询会话消息进展`upload_file.py`上传图片/视频文件`download_results.py`批量下载生成结果`generate_video_workflow.py`视频创作全流程编排（剧本→分镜→成片）

## 前置要求

```bash
export LIBTV_ACCESS_KEY="your-access-key"
```

可选：`OPENAPI_IM_BASE` 或 `IM_BASE_URL`，默认 `https://im.liblib.tv`。

## 使用方法

### 1. 一句话生成完整视频（剧本→分镜→成片）

```bash
# 生成一个完整短剧
python3 {baseDir}/scripts/generate_video_workflow.py "生成一个5分钟的科幻短剧，主题是AI觉醒"

# 生成产品广告片
python3 {baseDir}/scripts/generate_video_workflow.py "为我的运动鞋产品做一个15秒的广告片" --ref-image /path/to/shoe.png

# 生成音乐MV
python3 {baseDir}/scripts/generate_video_workflow.py "用这首歌生成一个MV" --music /path/to/music.mp3

# 复刻视频风格
python3 {baseDir}/scripts/generate_video_workflow.py "复刻这个视频的风格，做一个新的" --ref-video /path/to/ref.mp4
```

### 2. 分步操作

```bash
# 创建会话并发送消息
python3 {baseDir}/scripts/create_session.py "生成一个赛博朋克风格的15秒视频"

# 查询进展
python3 {baseDir}/scripts/query_session.py SESSION_ID --after-seq 0

# 上传参考文件
python3 {baseDir}/scripts/upload_file.py /path/to/image.png

# 下载结果
python3 {baseDir}/scripts/download_results.py SESSION_ID --output-dir ~/Downloads/my_video
```

## 典型工作流

### 场景：用户要求"帮我做一个视频"

```
1. 判断用户意图：
   - 有参考文件（图片/视频/音乐）→ 先 upload_file.py 上传
   - 无参考文件 → 直接 create_session.py

2. 发送创作指令：
   create_session.py "用户的原始描述 + 参考文件URL"

3. 轮询结果：
   每8秒 query_session.py SESSION_ID --after-seq N

4. 完成判断：
   messages 中出现 assistant 消息且包含结果 URL

5. 自动下载：
   download_results.py SESSION_ID --output-dir ~/Downloads/项目名

6. 展示结果：
   本地文件列表 + projectUrl（画布链接）
```

### 轮询策略

- **间隔**：每 8 秒查询一次
- **增量拉取**：首次 `--after-seq 0`，后续用上次最大 seq 值
- **完成判断**：assistant 消息包含图片/视频 URL
- **超时**：连续轮询 3 分钟无结果，告知用户"生成时间较长，可稍后通过项目画布链接查看"
- **错误重试**：单次失败重试1次，连续3次失败则停止

## 输出格式

**create_session** 返回：

```json
{
  "projectUuid": "aa3ba04c5044477cb7a00a9e5bf3b4d0",
  "sessionId": "90f05e0c-...",
  "projectUrl": "https://www.liblib.tv/canvas?projectId=..."
}
```

**query_session** 返回：

```json
{
  "messages": [
    {"id": "msg-xxx", "role": "user", "content": "..."},
    {"id": "msg-yyy", "role": "assistant", "content": "..."}
  ],
  "projectUrl": "https://www.liblib.tv/canvas?projectId=..."
}
```

**upload_file** 返回：

```json
{
  "url": "https://libtv-res.liblib.art/claw/{projectUuid}/{uuid}.png"
}
```

**download_results** 返回：

```json
{
  "output_dir": "/Users/xxx/Downloads/libtv_results",
  "downloaded": ["/Users/xxx/Downloads/libtv_results/01.mp4", "..."],
  "total": 5
}
```

## 核心原则：用户侧不做创作，只做传话

你（用户侧 Agent）的职责是**搬运工**，不是创作者。后端有专门的 Agent 负责理解需求、拆解分镜、编排工作流、选模型、写 prompt。

**要做的三件事**：

1. **上传**：用户给了本地文件 → `upload_file.py` 拿到 OSS URL
2. **传话**：把用户的原始描述 + OSS URL 原封不动发给 `create_session.py`
3. **取件**：轮询结果 → 下载到本地 → 展示给用户

**绝对不要做的事**：

- 不要替用户扩写、润色、翻译 prompt
- 不要自行拆解任务步骤
- 不要自行编排镜头描述、剧情推演、风格分析
- 不要在消息中添加自己编的 prompt（如"超写实风格，电影级光影，8K分辨率"）

## 注意事项

- 鉴权方式：`Authorization: Bearer <LIBTV_ACCESS_KEY>`
- 上传文件仅支持图片（image/*）和视频（video/*），大小须在 200MB 以下
- 项目画布地址：`https://www.liblib.tv/canvas?projectId=` + projectUuid
- 生成过程中只告知用户"正在生成中"，不要提前给出 projectUrl
- 任务完成后同时给出：**结果链接** + **项目画布链接（projectUrl）**