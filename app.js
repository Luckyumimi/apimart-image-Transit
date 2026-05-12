const STORAGE_KEY = "apimart-image-bridge";
const HISTORY_KEY = "apimart-image-bridge-history";
const FIXED_BASE_URL = "https://api.apimart.ai";
const MAX_HISTORY_ITEMS = 20;

const NEGATIVE_TEMPLATES = {
  general:
    "worst quality, low quality, normal quality, lowres, blurry, out of focus, noise, grain, jpeg artifacts, watermark, text, logo, signature, username, cropped, out of frame, duplicate, extra limbs, extra fingers, missing fingers, fused fingers, malformed hands, bad hands, bad anatomy, deformed, disfigured, mutated, unnatural pose, broken limbs, long neck, cross-eye, lazy eye, asymmetrical eyes, bad face, distorted face, poorly drawn face, poorly drawn hands, extra arms, extra legs, missing arms, missing legs, floating limbs, disconnected limbs, inaccurate proportions, ugly, messy background, cluttered background, oversaturated, underexposed, overexposed",
  portrait:
    "worst quality, low quality, lowres, blurry, bad anatomy, bad proportions, deformed, disfigured, malformed hands, extra fingers, fused fingers, missing fingers, bad hands, extra limbs, missing limbs, unnatural pose, twisted body, broken body, distorted face, asymmetrical eyes, cross-eyed, poorly drawn face, poorly drawn hands, ugly, duplicate, watermark, text, logo, signature, jpeg artifacts",
  anime:
    "bad composition, flat color, messy lines, sketch, unfinished, rough draft, bad perspective, inconsistent lighting, extra character, duplicated features",
};

const DEFAULTS = {
  mode: "text",
  aspectRatio: "auto",
  resolution: "1k",
  outputFormat: "",
  imageCount: "1",
  officialFallback: "false",
  taskLanguage: "zh",
  pollInterval: "3000",
  initialPollDelay: "12000",
  pollTimeout: "120000",
  references: [""],
  selectedNegativeTemplate: "general",
  negativePrompt: NEGATIVE_TEMPLATES.general,
};

const elements = {
  form: document.getElementById("imageForm"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKey: document.getElementById("apiKey"),
  fixedBaseUrl: document.getElementById("fixedBaseUrl"),
  mode: document.getElementById("mode"),
  aspectRatio: document.getElementById("aspectRatio"),
  resolution: document.getElementById("resolution"),
  outputFormat: document.getElementById("outputFormat"),
  imageCount: document.getElementById("imageCount"),
  prompt: document.getElementById("prompt"),
  negativePrompt: document.getElementById("negativePrompt"),
  background: document.getElementById("background"),
  officialFallback: document.getElementById("officialFallback"),
  taskLanguage: document.getElementById("taskLanguage"),
  pollInterval: document.getElementById("pollInterval"),
  initialPollDelay: document.getElementById("initialPollDelay"),
  pollTimeout: document.getElementById("pollTimeout"),
  referenceSection: document.getElementById("referenceSection"),
  referenceList: document.getElementById("referenceList"),
  referenceTemplate: document.getElementById("referenceTemplate"),
  addReferenceBtn: document.getElementById("addReferenceBtn"),
  resetBtn: document.getElementById("resetBtn"),
  clearNegativeBtn: document.getElementById("clearNegativeBtn"),
  negativeTemplateTabs: document.getElementById("negativeTemplateTabs"),
  statusText: document.getElementById("statusText"),
  requestPreview: document.getElementById("requestPreview"),
  requestDetails: document.getElementById("requestDetails"),
  taskIdValue: document.getElementById("taskIdValue"),
  taskStateValue: document.getElementById("taskStateValue"),
  resultGallery: document.getElementById("resultGallery"),
  rawResult: document.getElementById("rawResult"),
  rawResultContent: document.getElementById("rawResultContent"),
  modeBadge: document.getElementById("modeBadge"),
  statusBadge: document.getElementById("statusBadge"),
  taskBadge: document.getElementById("taskBadge"),
  historyList: document.getElementById("historyList"),
  refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
};

let activePoll = null;
let selectedNegativeTemplate = DEFAULTS.selectedNegativeTemplate;
let generationHistory = [];

init();

function init() {
  const savedState = getSavedState();
  generationHistory = getHistoryState();
  selectedNegativeTemplate = savedState.selectedNegativeTemplate || DEFAULTS.selectedNegativeTemplate;
  hydrateForm(savedState);
  renderReferenceInputs(savedState.references || DEFAULTS.references);
  enhanceResultPanel();
  syncModeUI();
  syncTemplateUI();
  renderHistory();
  attachEvents();
}

function enhanceResultPanel() {
  const resultPanel = document.querySelector(".result-panel");
  const resultGallery = elements.resultGallery;
  const requestDetails = elements.requestDetails;
  const resultMeta = document.querySelector(".result-meta");
  const rawResult = elements.rawResult;

  if (!resultPanel || !resultGallery || !requestDetails || !resultMeta || !rawResult) return;

  resultPanel.classList.add("result-panel-layout");
  resultPanel.appendChild(resultGallery);
  resultPanel.appendChild(requestDetails);
  resultPanel.appendChild(resultMeta);
  resultPanel.appendChild(rawResult);
}

function attachEvents() {
  elements.openSettingsBtn.addEventListener("click", openSettingsModal);
  elements.closeSettingsBtn.addEventListener("click", closeSettingsModal);
  elements.saveSettingsBtn.addEventListener("click", () => {
    persistForm();
    closeSettingsModal();
  });
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) closeSettingsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.settingsModal.hidden) {
      closeSettingsModal();
    }
  });

  elements.mode.addEventListener("change", () => {
    syncModeUI();
    persistForm();
  });

  elements.form.addEventListener("input", persistForm);
  elements.form.addEventListener("submit", handleSubmit);

  elements.addReferenceBtn.addEventListener("click", () => {
    addReferenceInput("");
    persistForm();
  });

  elements.referenceList.addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-reference")) return;
    const items = elements.referenceList.querySelectorAll(".reference-item");
    if (items.length === 1) {
      items[0].querySelector(".reference-input").value = "";
    } else {
      event.target.closest(".reference-item").remove();
    }
    persistForm();
  });

  elements.referenceList.addEventListener("input", persistForm);

  elements.negativeTemplateTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".template-chip");
    if (!button) return;
    selectedNegativeTemplate = button.dataset.template || "general";
    if (selectedNegativeTemplate === "custom") {
      elements.negativePrompt.value = "";
    } else {
      elements.negativePrompt.value = getTemplateText(selectedNegativeTemplate);
    }
    syncTemplateUI();
    persistForm();
  });

  elements.clearNegativeBtn.addEventListener("click", () => {
    elements.negativePrompt.value = "";
    selectedNegativeTemplate = "custom";
    syncTemplateUI();
    persistForm();
  });

  elements.negativePrompt.addEventListener("input", (event) => {
    if (event.isComposing) return;
    if (selectedNegativeTemplate !== "custom") {
      const templateText = getTemplateText(selectedNegativeTemplate);
      if (elements.negativePrompt.value !== templateText) {
        selectedNegativeTemplate = "custom";
        syncTemplateUI();
      }
    }
  });

  elements.refreshHistoryBtn.addEventListener("click", async () => {
    if (!generationHistory.length) {
      setStatus("暂无历史记录可刷新。", "idle");
      return;
    }
    await refreshHistoryEntry(generationHistory[0].taskId);
  });

  elements.clearHistoryBtn.addEventListener("click", () => {
    generationHistory = [];
    saveHistoryState();
    renderHistory();
    setStatus("历史记录已清空。", "idle");
  });

  elements.historyList.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-history-task-id]");
    if (!trigger) return;
    const taskId = trigger.dataset.historyTaskId;
    if (!taskId) return;
    await refreshHistoryEntry(taskId);
  });

  elements.rawResult.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-raw-toggle]");
    if (!trigger) return;
    const content = elements.rawResult.querySelector("#rawResultContent");
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!expanded));
    if (content) content.hidden = expanded;
  });

  elements.rawResult.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-raw-toggle]");
    if (!trigger) return;
    const content = elements.rawResult.querySelector("#rawResultContent");
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!expanded));
    if (content) content.hidden = expanded;
  });

  elements.resetBtn.addEventListener("click", () => {
    clearStorage();
    generationHistory = getHistoryState();
    selectedNegativeTemplate = DEFAULTS.selectedNegativeTemplate;
    hydrateForm(DEFAULTS);
    renderReferenceInputs(DEFAULTS.references);
    syncModeUI();
    syncTemplateUI();
    renderHistory();
    elements.taskIdValue.textContent = "-";
    elements.taskStateValue.textContent = "-";
    elements.taskBadge.textContent = "暂无";
    setStatus("准备就绪。", "idle");
    elements.requestPreview.textContent = "尚未提交请求";
    if (elements.requestDetails) elements.requestDetails.open = false;
    renderRawResult(null);
    renderGallery([]);
  });
}

function hydrateForm(savedState = {}) {
  const state = { ...DEFAULTS, ...savedState };
  elements.fixedBaseUrl.value = FIXED_BASE_URL;
  elements.apiKey.value = state.apiKey || "";
  elements.mode.value = state.mode || DEFAULTS.mode;
  elements.aspectRatio.value = state.aspectRatio || DEFAULTS.aspectRatio;
  elements.resolution.value = state.resolution || DEFAULTS.resolution;
  elements.outputFormat.value = state.outputFormat || DEFAULTS.outputFormat;
  elements.imageCount.value = state.imageCount || DEFAULTS.imageCount;
  elements.prompt.value = state.prompt || "";
  elements.negativePrompt.value = state.negativePrompt || DEFAULTS.negativePrompt;
  elements.background.value = state.background || "";
  elements.officialFallback.value = state.officialFallback || DEFAULTS.officialFallback;
  elements.taskLanguage.value = state.taskLanguage || DEFAULTS.taskLanguage;
  elements.pollInterval.value = state.pollInterval || DEFAULTS.pollInterval;
  elements.initialPollDelay.value = state.initialPollDelay || DEFAULTS.initialPollDelay;
  elements.pollTimeout.value = state.pollTimeout || DEFAULTS.pollTimeout;
}

function renderReferenceInputs(references) {
  elements.referenceList.innerHTML = "";
  const source = references.length ? references : [""];
  source.forEach((value) => addReferenceInput(value));
}

function addReferenceInput(value) {
  const fragment = elements.referenceTemplate.content.cloneNode(true);
  const input = fragment.querySelector(".reference-input");
  input.value = value || "";
  elements.referenceList.appendChild(fragment);
}

function syncModeUI() {
  const labelMap = {
    text: "文生图",
    image: "图生图",
    multi: "多图融合",
  };
  const mode = elements.mode.value;
  elements.modeBadge.textContent = labelMap[mode] || "文生图";
  elements.referenceSection.style.display = mode === "text" ? "none" : "grid";

  if (!elements.referenceList.querySelector(".reference-item")) {
    addReferenceInput("");
  }
}

function syncTemplateUI() {
  const buttons = elements.negativeTemplateTabs.querySelectorAll(".template-chip");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.template === selectedNegativeTemplate);
  });
}

function openSettingsModal() {
  elements.settingsModal.hidden = false;
  requestAnimationFrame(() => {
    elements.apiKey.focus();
  });
}

function closeSettingsModal() {
  elements.settingsModal.hidden = true;
}

function getTemplateText(templateKey) {
  if (templateKey === "custom") {
    return "";
  }
  return NEGATIVE_TEMPLATES[templateKey] || NEGATIVE_TEMPLATES.general;
}

function persistForm() {
  writeCookie(STORAGE_KEY, JSON.stringify(collectFormState()), 365);
}

function collectFormState() {
  return {
    apiKey: elements.apiKey.value.trim(),
    mode: elements.mode.value,
    aspectRatio: elements.aspectRatio.value,
    resolution: elements.resolution.value,
    outputFormat: elements.outputFormat.value,
    imageCount: elements.imageCount.value,
    prompt: elements.prompt.value,
    negativePrompt: elements.negativePrompt.value,
    background: elements.background.value,
    officialFallback: elements.officialFallback.value,
    taskLanguage: elements.taskLanguage.value,
    pollInterval: elements.pollInterval.value,
    initialPollDelay: elements.initialPollDelay.value,
    pollTimeout: elements.pollTimeout.value,
    references: getReferenceValues(),
    selectedNegativeTemplate,
  };
}

function getReferenceValues() {
  return [...elements.referenceList.querySelectorAll(".reference-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function getSavedState() {
  const raw = readCookie(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getHistoryState() {
  const raw = readCookie(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryState() {
  writeCookie(HISTORY_KEY, JSON.stringify(generationHistory), 365);
}

function addHistoryEntry(taskId, state) {
  const now = new Date();
  const entry = {
    taskId,
    prompt: state.prompt.trim(),
    mode: state.mode,
    taskLanguage: state.taskLanguage,
    createdAt: now.toISOString(),
    createdLabel: now.toLocaleString("zh-CN"),
    lastStatus: "queued",
    previewImage: "",
    previewImages: [],
  };

  generationHistory = generationHistory.filter((item) => item.taskId !== taskId);
  generationHistory.unshift(entry);
  generationHistory = generationHistory.slice(0, MAX_HISTORY_ITEMS);
  saveHistoryState();
  renderHistory();
}

function updateHistoryEntry(taskId, patch) {
  let changed = false;
  generationHistory = generationHistory.map((item) => {
    if (item.taskId !== taskId) return item;
    changed = true;
    return { ...item, ...patch };
  });
  if (changed) {
    saveHistoryState();
    renderHistory();
  }
}

function renderHistory() {
  if (!generationHistory.length) {
    elements.historyList.className = "history-list empty";
    elements.historyList.innerHTML = "<p>暂无历史记录。</p>";
    return;
  }

  const modeLabels = {
    text: "文生图",
    image: "图生图",
    multi: "多图融合",
  };

  const cards = generationHistory
    .map((item) => {
      const modeLabel = modeLabels[item.mode] || item.mode;
      const previewImages = Array.isArray(item.previewImages) && item.previewImages.length
        ? item.previewImages
        : (item.previewImage ? [item.previewImage] : []);

      const previewMarkup = previewImages[0]
        ? `<div class="history-thumb"><img src="${escapeHtml(previewImages[0])}" alt="历史缩略图"></div>`
        : `<div class="history-thumb"><div class="history-placeholder">等待生成结果</div></div>`;

      const downloadButtons = previewImages.length
        ? `<div class="history-download-list">${previewImages
            .map(
              (url, index) =>
                `<a class="secondary history-download" href="${escapeHtml(url)}" download target="_blank" rel="noopener noreferrer">下载结果 ${index + 1}</a>`
            )
            .join("")}</div>`
        : "";

      return `
        <article class="history-item">
          ${previewMarkup}
          <div class="history-row">
            <strong>${escapeHtml(modeLabel)}</strong>
            <div class="history-actions-group">
              <button type="button" class="ghost" data-history-task-id="${escapeHtml(item.taskId)}">重新查询</button>
            </div>
          </div>
          ${downloadButtons}
          <div class="history-task">${escapeHtml(item.taskId)}</div>
          <div class="history-meta">状态: ${escapeHtml(item.lastStatus || "unknown")}</div>
          <div class="history-meta">时间: ${escapeHtml(item.createdLabel || "")}</div>
          <div class="history-meta">提示词: ${escapeHtml((item.prompt || "").slice(0, 80) || "无提示词")}</div>
        </article>
      `;
    })
    .join("");

  elements.historyList.className = "history-list";
  elements.historyList.innerHTML = cards;
}

async function handleSubmit(event) {
  event.preventDefault();
  persistForm();

  let state;
  let payload;

  try {
    state = collectFormState();
    payload = buildPayload(state);
  } catch (error) {
    setStatus(error.message || "请求参数无效", "error");
    return;
  }

  setBusy(true);
  setStatus("正在提交生成任务...", "submitting");
  if (elements.requestDetails) elements.requestDetails.open = false;
  elements.requestPreview.textContent = JSON.stringify(payload, null, 2);
  renderRawResult(null);
  renderGallery([]);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: state.apiKey,
        payload,
      }),
    });

    const result = await response.json();
    renderRawResult(result);

    if (!response.ok) {
      throw new Error(result?.error?.message || result?.message || "任务提交失败");
    }

    const taskId =
      result.task_id ||
      result.id ||
      result.data?.task_id ||
      result.data?.[0]?.task_id ||
      result.data?.id;

    if (!taskId) {
      throw new Error("响应中未找到 task_id");
    }

    addHistoryEntry(taskId, state);
    elements.taskIdValue.textContent = taskId;
    elements.taskBadge.textContent = taskId;
    setStatus(`任务已提交，正在轮询 ${taskId} ...`, "queued");
    await pollTask(state, taskId);
  } catch (error) {
    setStatus(error.message || "请求失败", "error");
  } finally {
    setBusy(false);
  }
}

function buildPayload(state) {
  const payload = {
    model: "gpt-image-2",
    prompt: state.prompt.trim(),
    size: state.aspectRatio,
    resolution: state.resolution,
    n: Number(state.imageCount) || 1,
    response_format: "url",
  };

  if (!payload.prompt) {
    throw new Error("提示词不能为空");
  }

  validateResolution(state.aspectRatio, state.resolution);

  if (state.negativePrompt.trim()) payload.negative_prompt = state.negativePrompt.trim();
  if (state.background) payload.background = state.background;
  if (state.outputFormat) payload.output_format = state.outputFormat;
  payload.official_fallback = state.officialFallback === "true";
  payload.lang = state.taskLanguage;

  if (state.mode !== "text") {
    if (!state.references.length) {
      throw new Error("当前模式至少需要填写一张参考图");
    }
    if (state.references.length > 16) {
      throw new Error("APIMart 最多支持 16 张参考图");
    }
    payload.image_urls = state.references;
  }

  return payload;
}

async function refreshHistoryEntry(taskId) {
  const historyEntry = generationHistory.find((item) => item.taskId === taskId);
  const state = collectFormState();
  const refreshState = {
    ...state,
    taskLanguage: historyEntry?.taskLanguage || state.taskLanguage || "zh",
  };

  setBusy(true);
  if (elements.requestDetails) elements.requestDetails.open = false;
  elements.taskIdValue.textContent = taskId;
  elements.taskBadge.textContent = taskId;
  setStatus(`正在重新查询任务 ${taskId} ...`, "queued");
  renderGallery([]);

  try {
    await pollTask(refreshState, taskId);
  } catch (error) {
    setStatus(error.message || "查询失败", "error");
  } finally {
    setBusy(false);
  }
}

async function pollTask(state, taskId) {
  const pollUrl = `/api/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(state.taskLanguage || "zh")}`;
  const interval = Number(state.pollInterval) || 3000;
  const initialDelay = Number(state.initialPollDelay) || 0;
  const timeout = Number(state.pollTimeout) || 120000;
  const startedAt = Date.now();

  if (activePoll) {
    clearTimeout(activePoll);
    activePoll = null;
  }

  if (initialDelay > 0) {
    setStatus(`任务已提交，等待 ${Math.round(initialDelay / 1000)} 秒后开始首次轮询...`, "queued");
    await wait(initialDelay);
  }

  while (Date.now() - startedAt < timeout) {
    const response = await fetch(pollUrl);
    const result = await response.json();
    renderRawResult(result);

    if (!response.ok) {
      updateHistoryEntry(taskId, { lastStatus: "error" });
      throw new Error(result?.error?.message || result?.message || "任务状态查询失败");
    }

    const status = extractTaskStatus(result);
    updateHistoryEntry(taskId, { lastStatus: status });
    elements.taskStateValue.textContent = status;
    setStatus(buildStatusMessage(result, status), status);

    if (isTaskCompleted(status)) {
      const imageUrls = extractImageUrls(result);
      updateHistoryEntry(taskId, {
        lastStatus: status,
        previewImage: imageUrls[0] || "",
        previewImages: imageUrls,
      });
      renderGallery(imageUrls);
      if (!imageUrls.length) {
        setStatus("任务已完成，但未识别到图片地址，请检查原始响应。", "warning");
      } else {
        setStatus(`任务已完成，共获得 ${imageUrls.length} 张图片。`, "success");
      }
      return;
    }

    if (isTaskFailed(status)) {
      updateHistoryEntry(taskId, { lastStatus: status });
      throw new Error(extractFailureMessage(result) || `任务失败：${status}`);
    }

    await wait(interval);
  }

  updateHistoryEntry(taskId, { lastStatus: "timeout" });
  throw new Error("轮询超时，请稍后再试。");
}

function extractTaskStatus(result) {
  return (
    result.status ||
    result.data?.status ||
    result.data?.[0]?.status ||
    result.data?.task?.status ||
    result.task?.status ||
    "unknown"
  );
}

function extractImageUrls(result) {
  const urls = new Set();
  const candidates = [
    result.image_urls,
    result.data?.image_urls,
    result.data?.output?.image_urls,
    result.data?.result?.image_urls,
    result.output?.image_urls,
    result.result?.image_urls,
    result.data?.result?.images,
    result.data?.images,
    result.images,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || !candidate.length) continue;
    for (const item of candidate) {
      if (typeof item === "string") {
        urls.add(item);
        continue;
      }
      if (typeof item?.url === "string") {
        urls.add(item.url);
      }
      if (Array.isArray(item?.url)) {
        item.url.filter(Boolean).forEach((value) => urls.add(value));
      }
    }
  }

  return [...urls];
}

function extractFailureMessage(result) {
  return (
    result.error?.message ||
    result.message ||
    result.data?.error?.message ||
    result.data?.message ||
    ""
  );
}

function isTaskCompleted(status) {
  return ["succeeded", "success", "completed", "finished"].includes(String(status).toLowerCase());
}

function isTaskFailed(status) {
  return ["failed", "error", "cancelled", "canceled"].includes(String(status).toLowerCase());
}

function renderGallery(imageUrls) {
  if (!imageUrls.length) {
    elements.resultGallery.className = "gallery empty";
    elements.resultGallery.innerHTML = "<p></p>";
    return;
  }

  const cards = imageUrls
    .map(
      (url, index) => `
        <article class="image-card">
          <img src="${escapeHtml(url)}" alt="生成结果 ${index + 1}">
          <div class="image-card-body">
            <strong>结果 ${index + 1}</strong>
            <code>${escapeHtml(shortenUrl(url))}</code>
            <a class="secondary download-link" href="${escapeHtml(url)}" download target="_blank" rel="noopener noreferrer">下载图片</a>
          </div>
        </article>
      `
    )
    .join("");

  elements.resultGallery.className = "gallery";
  elements.resultGallery.innerHTML = `<div class="gallery-grid">${cards}</div>`;
}

function renderRawResult(result) {
  elements.rawResult.hidden = true;
  elements.rawResult.innerHTML = "";
}

function setBusy(isBusy) {
  const buttons = elements.form.querySelectorAll("button");
  const fields = elements.form.querySelectorAll("input, textarea, select");
  buttons.forEach((button) => {
    if (button.id !== "resetBtn") button.disabled = isBusy;
  });
  fields.forEach((field) => {
    field.disabled = isBusy;
  });
  elements.resetBtn.disabled = false;
}

function setStatus(message, state) {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = mapStatusLabel(state);
}

function buildStatusMessage(result, status) {
  const normalized = String(status || "").toLowerCase();
  if (result?.code === 200 && ["completed", "success", "succeeded", "finished"].includes(normalized)) {
    return "生成成功";
  }
  return `任务状态：${status}`;
}

function mapStatusLabel(state) {
  const labels = {
    idle: "空闲",
    submitting: "提交中",
    queued: "排队中",
    success: "已完成",
    warning: "已完成",
    error: "失败",
    processing: "处理中",
    pending: "排队中",
    completed: "已完成",
    failed: "失败",
    timeout: "超时",
  };
  return labels[state] || state || "处理中";
}

function validateResolution(size, resolution) {
  if (resolution !== "4k") return;
  const allowed = new Set(["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]);
  if (!allowed.has(size)) {
    throw new Error("4k 仅支持 16:9、9:16、2:1、1:2、21:9 和 9:21 这些比例");
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    activePoll = setTimeout(resolve, ms);
  });
}

function clearStorage() {
  document.cookie = `${STORAGE_KEY}=; Max-Age=0; path=/`;
}

function writeCookie(name, value, days) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; path=/; SameSite=Lax`;
}

function readCookie(name) {
  const prefix = `${name}=`;
  const hit = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}

function shortenUrl(value) {
  const text = String(value);
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
