/**
 * 本机人脸检测 worker（MediaPipe BlazeFace）。
 *
 * ## 为什么要有这个东西
 *
 * 「情绪调节」要先知道脸在哪。原来这件事是**问对话模型**（`domain/canvas/vision/faceBox`），
 * 能不能出框取决于那个模型会不会看图、渠道通不通、回的话格式对不对 —— 真机上报过
 * 「识别人脸失败」就是栽在这上面（对账清单 #175）。
 *
 * 参照 VOZEB-PRO 的做法，把人脸检测整个搬到**本机**：一个 Worker 里加载 MediaPipe
 * 的 `vision_bundle.js` + 一个几百 KB 的 `.tflite` 模型，纯本地跑。不联网、不花渠道、
 * 不依赖任何模型能力，只要浏览器能跑 wasm 就能出框。
 *
 * ## 为什么是经典 worker（`importScripts`）而不是模块 worker
 *
 * `vision_bundle.js` 是 IIFE 形态的经典脚本，跑完往全局挂一个 `Vision`。
 * `importScripts` 正是为这种脚本准备的，且**不受打包器改写**——放在 `public/` 下
 * 按静态文件原样加载，比让 Vite 去处理 wasm 路径那套要稳得多。
 *
 * ## 协议
 *
 * 收：`{ id, image }`（`image` 是 `ImageBitmap`，由主线程 transfer 过来，零拷贝）
 * 回：`{ id, faces }` 或 `{ id, error }`
 *
 * 坐标是**像素**（相对 `image` 左上角）。归一化在主线程做
 * （`normalizeDetectorBox`，纯函数、有单测），这里只管把检测器跑通。
 */
"use strict";

/**
 * MediaPipe 初始化时会把一堆 `INFO:` 开头的日志打到 `console.error`。
 * 那些不是错误，但会污染页面错误监听 —— 转成 `console.info`。
 */
const reportWorkerError = console.error.bind(console);
console.error = (...args) => {
  if (String(args[0] || "").startsWith("INFO:")) {
    console.info(...args);
    return;
  }
  reportWorkerError(...args);
};

/**
 * 路径一律**按 worker 自己的位置**算，不写死根路径 ——
 * 这样应用部署在子路径下（或换个端口）时这一整套照样能找到自己的文件。
 */
const ASSET_BASE = new URL("./", self.location.href).href;

importScripts(ASSET_BASE + "vision_bundle.js");

let detectorPromise = null;

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = Vision.FaceDetector.createFromOptions(
      {
        wasmLoaderPath: ASSET_BASE + "wasm/vision_wasm_internal.js",
        wasmBinaryPath: ASSET_BASE + "wasm/vision_wasm_internal.wasm",
      },
      {
        baseOptions: { modelAssetPath: ASSET_BASE + "models/blaze_face_short_range.tflite" },
        runningMode: "IMAGE",
      },
    );
  }
  return detectorPromise;
}

self.onmessage = async (event) => {
  const { id, image } = event.data || {};
  try {
    const detector = await getDetector();
    const faces = detector.detect(image).detections.flatMap((detection) => {
      const box = detection.boundingBox;
      if (!box) return [];
      return [
        {
          x: box.originX,
          y: box.originY,
          width: box.width,
          height: box.height,
          score: detection.categories[0]?.score,
        },
      ];
    });
    self.postMessage({ id, faces });
  } catch (error) {
    /** 初始化失败后把 promise 丢掉，下一次请求可以重来（否则整个 worker 会一直坏着） */
    detectorPromise = null;
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "本机人脸识别失败",
    });
  } finally {
    image?.close();
  }
};
