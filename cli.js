#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const ImageContract = require("./image-contract");

const MODEL_VARIANTS = {
  "ext-flare": { model: "gpt-image-2.6-ext", version: "flare", isExt: true },
  "ext-sunburst": { model: "gpt-image-2.6-ext", version: "sunburst", isExt: true },
  flare: { model: "gpt-image-2.6-flare", version: "flare", isExt: false },
  sunburst: { model: "gpt-image-2.6-sunburst", version: "sunburst", isExt: false },
};

const HELP = `APIMart Image Studio CLI

用法:
  node cli.js --prompt "描述画面" [选项]

选项:
  --server <URL>              网站地址，默认 IMAGE_STUDIO_URL 或 http://127.0.0.1:43888
  --model <名称>              ext-flare | ext-sunburst | flare | sunburst，默认 ext-flare
  --size <值>                 auto、比例（如 16:9）或精确尺寸（如 1536x1024）
  --resolution <档位>         1k | 2k | 4k，默认 1k；Ext 固定 1k，精确尺寸时不发送
  --format <格式>             png | jpeg | webp | gif | svg
  --quality <档位>            low | medium | high | xhigh | max
  --complexity <档位>         low | medium | high
  --count <数量>              普通模型 1-4，Ext 固定 1，默认 1
  --background <值>           transparent | opaque
  --reference <文件>          参考图，可重复，最多 16 张
  --output <目录>              下载生成结果到目录；省略时只输出图片 URL
  --task <任务 ID>              继续查询已有任务，需使用同一个网站实例
  --language <语言>            zh | en | ko | ja，默认 zh
  --initial-delay-ms <毫秒>    首次轮询延迟，默认 12000
  --poll-interval-ms <毫秒>    轮询间隔，默认 3000
  --timeout-ms <毫秒>          轮询超时，默认 120000
  --no-wait                    提交后只输出任务 ID
  -h, --help                   显示帮助

API Key 通过 APIMART_API_KEY 环境变量读取，不会放入命令参数。`;

function parseArgs(argv) {
  const options = {
    server: "",
    model: "ext-flare",
    size: "auto",
    resolution: "1k",
    format: "",
    quality: "",
    complexity: "",
    count: 1,
    background: "",
    references: [],
    outputDir: "",
    taskId: "",
    language: "zh",
    initialDelayMs: 12000,
    pollIntervalMs: 3000,
    timeoutMs: 120000,
    noWait: false,
    help: false,
    prompt: "",
  };
  const valueFlags = new Map([
    ["--prompt", "prompt"], ["--server", "server"], ["--model", "model"], ["--size", "size"],
    ["--resolution", "resolution"], ["--format", "format"], ["--output-format", "format"],
    ["--quality", "quality"], ["--complexity", "complexity"], ["--count", "count"],
    ["--background", "background"], ["--reference", "reference"], ["--output", "outputDir"],
    ["--task", "taskId"],
    ["--language", "language"], ["--initial-delay-ms", "initialDelayMs"],
    ["--poll-interval-ms", "pollIntervalMs"], ["--timeout-ms", "timeoutMs"],
  ]);
  const promptParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--no-wait") {
      options.noWait = true;
      continue;
    }
    const key = valueFlags.get(arg);
    if (key) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少参数值。`);
      index += 1;
      if (key === "reference") options.references.push(value);
      else if (["count", "initialDelayMs", "pollIntervalMs", "timeoutMs"].includes(key)) options[key] = Number(value);
      else options[key] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`未知选项: ${arg}\n使用 --help 查看用法。`);
    promptParts.push(arg);
  }

  if (!options.prompt) options.prompt = promptParts.join(" ").trim();
  return options;
}

function validateOptions(options) {
  if (!options.prompt) throw new Error("请使用 --prompt 提供提示词。\n使用 --help 查看用法。");
  if (!MODEL_VARIANTS[options.model]) throw new Error("--model 必须是 ext-flare、ext-sunburst、flare 或 sunburst。");
  if (!/^https?:\/\//i.test(options.server)) throw new Error("网站地址必须以 http:// 或 https:// 开头。");
  if (!["1k", "2k", "4k"].includes(options.resolution)) throw new Error("--resolution 仅支持 1k、2k、4k。");
  if (!["", "png", "jpeg", "webp", "gif", "svg"].includes(options.format)) throw new Error("--format 仅支持 png、jpeg、webp、gif、svg。");
  if (!["", "low", "medium", "high", "xhigh", "max"].includes(options.quality)) throw new Error("--quality 仅支持 low、medium、high、xhigh、max。");
  if (!["", "low", "medium", "high"].includes(options.complexity)) throw new Error("--complexity 仅支持 low、medium、high。");
  if (!["", "transparent", "opaque"].includes(options.background)) throw new Error("--background 仅支持 transparent、opaque。");
  if (!["zh", "en", "ko", "ja"].includes(options.language)) throw new Error("--language 仅支持 zh、en、ko、ja。");
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 4) throw new Error("--count 必须是 1 到 4 之间的整数。");
  if (!Number.isFinite(options.initialDelayMs) || options.initialDelayMs < 0) throw new Error("--initial-delay-ms 必须大于等于 0。");
  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 1) throw new Error("--poll-interval-ms 必须大于 0。");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout-ms 必须大于 0。");
  if (options.references.length > 16) throw new Error("参考图最多 16 张。");

  const model = MODEL_VARIANTS[options.model];
  const customSize = options.size.match(/^(\d+)x(\d+)$/i);
  const isCustom = Boolean(customSize);
  if (options.size !== "auto" && !isCustom && !ImageContract.aspectRatios.includes(options.size)) {
    throw new Error("--size 必须是 auto、文档支持的比例，或类似 1536x1024 的精确尺寸。");
  }
  if (model.isExt) {
    if (options.resolution !== "1k") throw new Error("2.6 Ext 当前仅支持 1K 分辨率。");
    if (options.count !== 1) throw new Error("2.6 Ext 当前仅支持生成 1 张图片。");
    if (isCustom) throw new Error("2.6 Ext 不支持自定义像素尺寸。");
    if (!ImageContract.extAspectRatios.includes(options.size)) throw new Error("2.6 Ext 不支持该比例，请使用文档支持的比例。");
  }
  if (isCustom) {
    const sizeError = ImageContract.validateCustomDimensions(customSize[1], customSize[2]);
    if (sizeError) throw new Error(sizeError);
  }
  if (options.format === "gif" && options.size !== "auto") throw new Error("GIF 输出必须使用自动尺寸。");
  if (options.format === "svg" && options.references.length) throw new Error("SVG 输出不支持参考图。");
  if (options.format === "svg" && options.count !== 1) throw new Error("SVG 输出仅支持生成 1 张图片。");
  if (options.format === "gif" && model.isExt && options.references.length) throw new Error("2.6 Ext 的 GIF 不支持参考图。");
  return { model, customSize };
}

function buildPayload(options, referenceUrls = []) {
  const { model, customSize } = validateOptions(options);
  const payload = {
    model: model.model,
    prompt: options.prompt.trim(),
    size: customSize ? `${customSize[1]}x${customSize[2]}` : options.size,
    n: options.count,
  };
  if (!customSize) payload.resolution = options.resolution;
  if (options.quality) payload.quality = options.quality;
  if (options.complexity) payload.complexity = options.complexity;
  if (options.background && !model.isExt && !["gif", "svg"].includes(options.format)) {
    payload.background = options.background;
  }
  if (options.format) payload.output_format = options.format;
  if (model.isExt) payload.version = model.version;
  if (referenceUrls.length) payload.image_urls = referenceUrls;
  return payload;
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env || process.env;
  const print = dependencies.print || console.log;
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const fileSystem = dependencies.fs || fs;
  const delay = dependencies.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const cwd = dependencies.cwd || process.cwd();
  const options = parseArgs(argv);
  if (options.help) {
    print(HELP);
    return { help: true };
  }

  options.server = (options.server || env.IMAGE_STUDIO_URL || "http://127.0.0.1:43888").replace(/\/+$/, "");
  if (options.taskId) {
    if (options.prompt) throw new Error("--task 不能与提示词同时使用。");
    if (!/^https?:\/\//i.test(options.server)) throw new Error("网站地址必须以 http:// 或 https:// 开头。");
    const result = await waitForTask({
      server: options.server,
      taskId: options.taskId,
      language: options.language,
      initialDelayMs: options.initialDelayMs,
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
      fetchImpl,
      delay,
      print,
    });
    return await finishTask(options, options.taskId, result, print, fetchImpl, fileSystem, cwd, null);
  }

  validateOptions(options);
  const apiKey = String(env.APIMART_API_KEY || "").trim();
  if (!apiKey) throw new Error("缺少 APIMART_API_KEY 环境变量。请先设置 API Key，再运行 CLI。");

  const referenceUrls = [];
  for (const referencePath of options.references) {
    referenceUrls.push(await uploadReference(referencePath, options.server, apiKey, fetchImpl, fileSystem, cwd));
  }

  const payload = buildPayload(options, referenceUrls);
  const submitResult = await fetchJson(fetchImpl, endpoint(options.server, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, payload }),
  });
  const taskId = extractTaskId(submitResult);
  if (!taskId) throw new Error("网站响应中未找到 task_id。");
  print(`任务已提交: ${taskId}`);
  if (options.noWait) return { taskId, payload, submitResult };

  const result = await waitForTask({
    server: options.server,
    taskId,
    language: options.language,
    initialDelayMs: options.initialDelayMs,
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.timeoutMs,
    fetchImpl,
    delay,
    print,
  });
  return finishTask(options, taskId, result, print, fetchImpl, fileSystem, cwd, payload);
}

async function finishTask(options, taskId, result, print, fetchImpl, fileSystem, cwd, payload) {
  const imageUrls = extractImageUrls(result);
  if (!imageUrls.length) throw new Error(`任务 ${taskId} 已完成，但响应中没有识别到图片 URL。`);

  let files = [];
  if (options.outputDir) {
    files = await downloadImages(imageUrls, options.outputDir, options.server, taskId, fetchImpl, fileSystem, cwd);
    files.forEach((file) => print(`已保存: ${file}`));
  } else {
    imageUrls.forEach((url) => print(url));
  }
  return { taskId, payload, result, imageUrls, files };
}

async function uploadReference(referencePath, server, apiKey, fetchImpl, fileSystem, cwd) {
  const absolutePath = path.resolve(cwd, referencePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`参考图格式不支持: ${referencePath}`);
  const fileStats = await fileSystem.stat(absolutePath);
  if (!fileStats.isFile()) throw new Error(`参考图不是文件: ${referencePath}`);
  if (fileStats.size > 19 * 1024 * 1024) throw new Error(`参考图超过 19 MiB: ${referencePath}`);
  const bytes = await fileSystem.readFile(absolutePath);
  const body = new FormData();
  body.append("file", new Blob([bytes], { type: mimeType }), path.basename(absolutePath));
  const result = await fetchJson(fetchImpl, endpoint(server, "/api/uploads/images"), {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body,
  });
  const imageUrl = result.url || result.data?.url || result.data?.image_url || result.data?.[0]?.url || result.data?.[0]?.image_url;
  if (!imageUrl) throw new Error(`参考图上传未返回 URL: ${referencePath}`);
  return imageUrl;
}

async function waitForTask({ server, taskId, language, initialDelayMs, pollIntervalMs, timeoutMs, fetchImpl, delay, print }) {
  const startTime = Date.now();
  if (initialDelayMs > 0) await delay(Math.min(initialDelayMs, timeoutMs));
  let latestResult = null;
  let previousStatus = "";

  while (Date.now() - startTime <= timeoutMs) {
    const url = endpoint(server, `/api/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(language)}`);
    latestResult = await fetchJson(fetchImpl, url);
    const status = extractTaskStatus(latestResult).toLowerCase();
    if (status !== previousStatus) {
      print(`[${taskId}] ${status || "unknown"}`);
      previousStatus = status;
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(extractFailureMessage(latestResult) || `任务失败: ${status}`);
    }
    if (["succeeded", "success", "completed", "finished"].includes(status)) return latestResult;
    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) break;
    await delay(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(`任务 ${taskId} 查询超时。可用 --task ${taskId} 继续查询。`);
}

async function downloadImages(imageUrls, outputDir, server, taskId, fetchImpl, fileSystem, cwd) {
  const absoluteOutputDir = path.resolve(cwd, outputDir);
  await fileSystem.mkdir(absoluteOutputDir, { recursive: true });
  const safeTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const files = [];

  for (let index = 0; index < imageUrls.length; index += 1) {
    const downloadUrl = new URL(endpoint(server, "/api/download"));
    downloadUrl.searchParams.set("url", imageUrls[index]);
    const response = await fetchImpl(downloadUrl);
    if (!response.ok) throw new Error(`图片下载失败 (${response.status}): ${await response.text()}`);
    const extension = extensionFor(response.headers.get("content-type"), imageUrls[index]);
    const filePath = path.join(absoluteOutputDir, `apimart-${safeTaskId}-${index + 1}${extension}`);
    await fileSystem.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    files.push(filePath);
  }
  return files;
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const raw = await response.text();
  let result = {};
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`网站返回了无效 JSON (${response.status})。`);
  }
  if (!response.ok) throw new Error(result?.error?.message || result?.message || `请求失败 (${response.status})`);
  return result;
}

function endpoint(server, route) {
  return new URL(route, `${server}/`);
}

function extractTaskId(result) {
  return result.task_id || result.id || result.data?.task_id || result.data?.[0]?.task_id || result.data?.id || "";
}

function extractTaskStatus(result) {
  return result.status || result.data?.status || result.data?.[0]?.status || result.data?.task?.status || result.task?.status || "unknown";
}

function extractImageUrls(result) {
  const candidates = [
    result.image_urls, result.data?.image_urls, result.data?.output?.image_urls,
    result.data?.result?.image_urls, result.output?.image_urls, result.result?.image_urls,
    result.data?.result?.images, result.data?.images, result.images,
    result.data?.result?.files, result.data?.files, result.result?.files, result.files,
  ];
  const urls = new Set();
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (typeof item === "string") urls.add(item);
      else if (typeof item?.url === "string") urls.add(item.url);
      else if (typeof item?.image_url === "string") urls.add(item.image_url);
      else if (Array.isArray(item?.url)) item.url.filter(Boolean).forEach((url) => urls.add(url));
    }
  }
  return [...urls];
}

function extractFailureMessage(result) {
  return result.error?.message || result.message || result.data?.error?.message || result.data?.message || "";
}

function extensionFor(contentType = "", imageUrl = "") {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const byType = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
  if (byType[type]) return byType[type];
  try {
    const extension = path.extname(new URL(imageUrl).pathname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) return extension;
  } catch {}
  return ".png";
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, validateOptions, buildPayload, extractImageUrls, extractTaskId };
