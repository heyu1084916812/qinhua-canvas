# 冒烟夹具

## `mediapipe-portrait.jpg`

- **来源**：MediaPipe 官方测试素材 `https://storage.googleapis.com/mediapipe-assets/portrait.jpg`
- **许可**：Apache-2.0（MediaPipe，Google）
- **尺寸**：820 × 1024
- **用途**：只给 `scripts/smoke.mjs` 的 **G109「本机人脸检测」** 用。

为什么必须有一张**真人像**：本机检测（MediaPipe BlazeFace）的失败形态是
「跑得起来但一直返回 0 张脸」—— 那种坏法在纯色图上和在真人像上表现一模一样，
拿现造图去测根本测不出来。G108 用的 mock 图就是一整块纯色，它只能证明
「没认到时回退是对的」；G109 拿这张真人像证明「有脸时真的认得出来」。两条缺一不可。

这张图**不进应用产物**（不在 `src/`、也不在 `public/`），只在跑冒烟时被 Node 读进来。
