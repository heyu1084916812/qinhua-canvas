# MediaPipe 本机人脸检测（随包静态文件）

这四样东西是「情绪调节」**本机识别人脸**那条路要用的运行文件。它们都放在
`public/` 下，由 Vite **原样**搬到产物根目录，不经打包器改写。

## 文件与来源

| 文件 | 大小 | 来源 | 许可 |
| --- | --- | --- | --- |
| `vision_bundle.js` | 155 KB | `@mediapipe/tasks-vision@1.0.1`（npm 包的 `vision_bundle.js`） | Apache-2.0 |
| `wasm/vision_wasm_internal.js` | 323 KB | 同上（`wasm/` 目录） | Apache-2.0 |
| `wasm/vision_wasm_internal.wasm` | 11.8 MB | 同上（`wasm/` 目录） | Apache-2.0 |
| `models/blaze_face_short_range.tflite` | 230 KB | MediaPipe 模型库 `face_detector/blaze_face_short_range/float16/1` | Apache-2.0 |
| `face-detector-worker.js` | — | **本项目自己写的**（不是第三方），见 `src/platform/web/localFaceDetector.ts` | 随本项目 |

## 为什么要自带，而不是用 CDN 或浏览器自带的 API

- **浏览器自带的 `FaceDetector`**（Shape Detection API）实测在 Windows Chrome 上是
  `undefined` —— 目标平台根本用不上。
- **CDN** 会让「认个人脸」变成一件依赖外网的事，与这条路的初衷（不出网、不受渠道影响）冲突。

所以四个文件随包走。代价是仓库多了约 12.4 MB，换来的是**离线可用、零请求、零花费**。

## 怎么升级

```powershell
$v = '1.0.1'   # 目标版本
$b = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$v"
curl.exe -sL -o vision_bundle.js             "$b/vision_bundle.js"
curl.exe -sL -o wasm/vision_wasm_internal.js "$b/wasm/vision_wasm_internal.js"
curl.exe -sL -o wasm/vision_wasm_internal.wasm "$b/wasm/vision_wasm_internal.wasm"
```

升级后必须重跑冒烟 **G109**（`SMOKE_ONLY=g109 node scripts/smoke.mjs`）：
它拿一张真人像走真链路，断言真的认出了脸。只跑单测发现不了版本不兼容 ——
单测只钉纯函数，跑不到 wasm。

## 路径约定（改之前先读）

worker 用 `new URL("./", self.location.href)` 算自己的目录，再去加载同目录下的
另外三样。也就是说**这五个文件必须待在一起**，整块搬走或改名都要同步改。

主线程那边的 worker 地址以 `import.meta.env.BASE_URL` 为根计算，**不是**以当前文档
地址为根 —— 画布页的地址是 `/canvas/<id>`（没有结尾斜杠），拿它当基准会解析到
`/canvas/mediapipe/...`，被 SPA 回退成 HTML，worker 建得起来却跑不起来。
