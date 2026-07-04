const STORAGE_KEY = "apimart-image-bridge";
const HISTORY_KEY = "apimart-image-bridge-history";
const FIXED_BASE_URL = "https://api.apimart.ai";
const MAX_HISTORY_ITEMS = 20;
const IDB_NAME = "apimart-image-store";
const IDB_STORE = "images";
const IDB_VERSION = 1;

let idb = null;
const blobUrlCache = new Map();

function proxyImageUrl(url) {
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

function getImageSrc(remoteUrl) {
  if (blobUrlCache.has(remoteUrl)) return blobUrlCache.get(remoteUrl);
  return proxyImageUrl(remoteUrl);
}

function openIDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => { idb = req.result; resolve(idb); };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function cacheRemoteImage(url) {
  if (blobUrlCache.has(url)) return;
  try {
    const existing = await idbGet(url);
    if (existing) {
      const blobUrl = URL.createObjectURL(existing);
      blobUrlCache.set(url, blobUrl);
      return;
    }
    const response = await fetch(proxyImageUrl(url));
    const blob = await response.blob();
    await idbPut(url, blob);
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(url, blobUrl);
  } catch {}
}

async function getLocalImageUrl(url) {
  if (blobUrlCache.has(url)) return blobUrlCache.get(url);
  try {
    const blob = await idbGet(url);
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(url, blobUrl);
      return blobUrl;
    }
  } catch {}
  return proxyImageUrl(url);
}

async function pruneOrphanedImages() {
  const keptUrls = new Set();
  for (const item of generationHistory) {
    if (item.previewImage) keptUrls.add(item.previewImage);
    if (Array.isArray(item.previewImages)) item.previewImages.forEach((u) => keptUrls.add(u));
  }
  const db = await openIDB();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result) {
        if (!keptUrls.has(key)) store.delete(key);
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
}

async function upgradeToLocalImages() {
  const imgs = elements.historyList.querySelectorAll("img[data-remote-src]");
  for (const img of imgs) {
    const remoteUrl = img.dataset.remoteSrc;
    if (!remoteUrl || blobUrlCache.has(remoteUrl)) continue;
    const localUrl = await getLocalImageUrl(remoteUrl);
    if (img.src !== localUrl) {
      img.src = localUrl;
      img.dataset.lightbox = localUrl;
    }
  }
}

async function cacheAllHistoryImages() {
  const urls = [];
  for (const item of generationHistory) {
    const imgs = Array.isArray(item.previewImages) && item.previewImages.length
      ? item.previewImages
      : (item.previewImage ? [item.previewImage] : []);
    urls.push(...imgs);
  }
  await Promise.all(urls.map((url) => cacheRemoteImage(url)));
}

async function loadBlobCache() {
  try {
    const db = await openIDB();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const key of keys) {
      if (blobUrlCache.has(key)) continue;
      const blob = await idbGet(key);
      if (blob) blobUrlCache.set(key, URL.createObjectURL(blob));
    }
  } catch {}
}

const NEGATIVE_TEMPLATES = {
  general:
    "worst quality, low quality, normal quality, lowres, blurry, out of focus, noise, grain, jpeg artifacts, watermark, cropped, out of frame, duplicate, extra limbs, extra fingers, missing fingers, fused fingers, malformed hands, bad hands, bad anatomy, deformed, disfigured, mutated, unnatural pose, broken limbs, long neck, cross-eye, lazy eye, asymmetrical eyes, bad face, distorted face, poorly drawn face, poorly drawn hands, extra arms, extra legs, missing arms, missing legs, floating limbs, disconnected limbs, inaccurate proportions, ugly, messy background, cluttered background, oversaturated, underexposed, overexposed",
  portrait:
    "worst quality, low quality, lowres, blurry, bad anatomy, bad proportions, deformed, disfigured, malformed hands, extra fingers, fused fingers, missing fingers, bad hands, extra limbs, missing limbs, unnatural pose, twisted body, broken body, distorted face, asymmetrical eyes, cross-eyed, poorly drawn face, poorly drawn hands, ugly, duplicate, watermark, jpeg artifacts",
  anime:
    "bad composition, flat color, messy lines, sketch, unfinished, rough draft, bad perspective, inconsistent lighting, extra character, duplicated features, lowres, blurry, worst quality, low quality, deformed, bad anatomy",
};

const DEFAULTS = {
  aspectRatio: "auto",
  resolution: "1k",
  outputFormat: "",
  imageCount: "1",
  officialFallback: "false",
  taskLanguage: "zh",
  pollInterval: "3000",
  initialPollDelay: "12000",
  pollTimeout: "120000",
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
  referenceUploadInput: document.getElementById("referenceUploadInput"),
  attachmentTray: document.getElementById("attachmentTray"),
  submitBtn: document.querySelector('#imageForm button[type="submit"]'),
  resetBtn: document.getElementById("resetBtn"),
  clearNegativeBtn: document.getElementById("clearNegativeBtn"),
  negativeTemplateTabs: document.getElementById("negativeTemplateTabs"),
  statusText: document.getElementById("statusText"),
  requestPreview: document.getElementById("requestPreview"),
  requestDetails: document.getElementById("requestDetails"),
  rawResult: document.getElementById("rawResult"),
  rawResultContent: document.getElementById("rawResultContent"),
  modeBadge: document.getElementById("modeBadge"),
  statusBadge: document.getElementById("statusBadge"),
  taskBadge: document.getElementById("taskBadge"),
  historyList: document.getElementById("historyList"),
  refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  clearHistoryModal: document.getElementById("clearHistoryModal"),
  cancelClearHistoryIconBtn: document.getElementById("cancelClearHistoryIconBtn"),
  cancelClearHistoryBtn: document.getElementById("cancelClearHistoryBtn"),
  confirmClearHistoryBtn: document.getElementById("confirmClearHistoryBtn"),
  lightboxModal: document.getElementById("lightboxModal"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxPrevBtn: document.getElementById("lightboxPrevBtn"),
  lightboxNextBtn: document.getElementById("lightboxNextBtn"),
  lightboxCloseBtn: document.getElementById("lightboxCloseBtn"),
};

let activeTasks = new Map();
let selectedNegativeTemplate = DEFAULTS.selectedNegativeTemplate;
let generationHistory = [];
let attachmentItems = [];
let attachmentCounter = 0;
let lightboxItems = [];
let lightboxIndex = 0;

init();

function init() {
  const savedState = getSavedState();
  generationHistory = getHistoryState();
  selectedNegativeTemplate = savedState.selectedNegativeTemplate || DEFAULTS.selectedNegativeTemplate;
  hydrateForm(savedState);
  syncModeBadge();
  syncTemplateUI();
  loadBlobCache().then(() => {
    renderHistory();
  });
  renderAttachmentTray();
  syncSubmitAvailability();
  attachEvents();
  pruneOrphanedImages();
  cacheAllHistoryImages();
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

  elements.form.addEventListener("input", persistForm);
  elements.form.addEventListener("submit", handleSubmit);
  elements.prompt.addEventListener("paste", handlePromptPaste);
  elements.referenceUploadInput.addEventListener("change", handleReferenceUpload);

  elements.attachmentTray.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-attachment-id]");
    if (!removeButton) return;
    removeAttachment(removeButton.dataset.removeAttachmentId);
  });

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

  elements.clearHistoryBtn.addEventListener("click", openClearHistoryModal);
  elements.cancelClearHistoryIconBtn.addEventListener("click", closeClearHistoryModal);
  elements.cancelClearHistoryBtn.addEventListener("click", closeClearHistoryModal);
  elements.confirmClearHistoryBtn.addEventListener("click", clearHistory);
  elements.clearHistoryModal.addEventListener("click", (event) => {
    if (event.target === elements.clearHistoryModal) closeClearHistoryModal();
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

  elements.resetBtn.addEventListener("click", () => {
    clearStorage();
    generationHistory = getHistoryState();
    selectedNegativeTemplate = DEFAULTS.selectedNegativeTemplate;
    attachmentItems.forEach(revokeAttachmentPreview);
    attachmentItems = [];
    hydrateForm(DEFAULTS);
    syncTemplateUI();
    syncModeBadge();
    renderAttachmentTray();
    renderHistory();
    elements.taskBadge.textContent = "暂无";
    setStatus("准备就绪。", "idle");
    elements.requestPreview.textContent = "尚未提交请求";
    if (elements.requestDetails) elements.requestDetails.open = false;
    renderRawResult(null);
  });

  elements.lightboxCloseBtn.addEventListener("click", closeLightbox);
  elements.lightboxPrevBtn.addEventListener("click", showPreviousLightboxImage);
  elements.lightboxNextBtn.addEventListener("click", showNextLightboxImage);
  elements.lightboxModal.addEventListener("click", (event) => {
    if (event.target === elements.lightboxModal) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.clearHistoryModal.hidden) {
      closeClearHistoryModal();
      return;
    }
    if (elements.lightboxModal.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") showPreviousLightboxImage();
    if (event.key === "ArrowRight") showNextLightboxImage();
  });

  document.addEventListener("click", (event) => {
    const img = event.target.closest("[data-lightbox]");
    if (!img) return;
    const sources = String(img.dataset.lightboxSources || "")
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    const activeSrc = img.dataset.lightbox || img.getAttribute("src") || "";
    openLightbox(sources.length ? sources : [activeSrc], activeSrc);
  });
}

function hydrateForm(savedState = {}) {
  const state = { ...DEFAULTS, ...savedState };
  elements.fixedBaseUrl.value = FIXED_BASE_URL;
  elements.apiKey.value = state.apiKey || "";
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

function persistForm() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormState()));
}

function collectFormState() {
  return {
    apiKey: elements.apiKey.value.trim(),
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
    selectedNegativeTemplate,
  };
}

function getSavedState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getHistoryState() {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryState() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(generationHistory));
}

function addHistoryEntry(taskId, state) {
  const now = new Date();
  const entry = {
    taskId,
    prompt: state.prompt.trim(),
    mode: detectModeFromAttachments(),
    taskLanguage: state.taskLanguage,
    createdAt: now.toISOString(),
    createdLabel: now.toLocaleString("zh-CN"),
    lastStatus: "queued",
    errorMessage: "",
    previewImage: "",
    previewImages: [],
  };

  generationHistory = generationHistory.filter((item) => item.taskId !== taskId);
  generationHistory.unshift(entry);
  generationHistory = generationHistory.slice(0, MAX_HISTORY_ITEMS);
  saveHistoryState();
  renderHistory();
}

function addErrorHistoryEntry(state, errorMessage) {
  const now = new Date();
  const entry = {
    taskId: `error-${Date.now()}`,
    prompt: state.prompt.trim(),
    mode: detectModeFromAttachments(),
    taskLanguage: state.taskLanguage,
    createdAt: now.toISOString(),
    createdLabel: now.toLocaleString("zh-CN"),
    lastStatus: "error",
    errorMessage: errorMessage || "未知错误",
    previewImage: "",
    previewImages: [],
  };

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
    multi: "多图生图",
  };

  const cards = generationHistory
    .map((item) => {
      const modeLabel = modeLabels[item.mode] || item.mode;
      const previewImages = Array.isArray(item.previewImages) && item.previewImages.length
        ? item.previewImages
        : (item.previewImage ? [item.previewImage] : []);

      let previewMarkup = `<div class="history-thumb"><div class="history-placeholder">等待生成结果</div></div>`;
      if (previewImages.length >= 1) {
        const firstRemoteUrl = previewImages[0];
        const lightboxSources = previewImages.map((url) => getImageSrc(url)).join("|");
        previewMarkup = `<div class="history-thumb"><img src="${escapeHtml(getImageSrc(firstRemoteUrl))}" alt="历史缩略图" data-lightbox="${escapeHtml(getImageSrc(firstRemoteUrl))}" data-lightbox-sources="${escapeHtml(lightboxSources)}" data-remote-src="${escapeHtml(firstRemoteUrl)}" loading="lazy"></div>`;
      }

      const downloadButtons = previewImages.length
        ? `<div class="history-download-list">${previewImages
            .map(
              (url) =>
                `<a class="history-action history-action--download" href="/api/download?url=${encodeURIComponent(url)}" download>下载</a>`
            )
            .join("")}</div>`
        : "";

      return `
        <article class="history-item">
          <div class="history-item__content">
            ${previewMarkup}
          </div>
          <div class="history-item__panel">
            <div class="history-item__text">
              <strong>${escapeHtml(modeLabel)}</strong>
              ${item.errorMessage ? `<div class="history-error">${escapeHtml(item.errorMessage)}</div>` : ""}
              <div class="history-meta">提示词: ${escapeHtml(item.prompt || "无提示词")}</div>
            </div>
            <div class="history-item__info">
              <div class="history-meta">${escapeHtml(item.createdLabel || "")} · ${escapeHtml(item.lastStatus || "unknown")}</div>
              <div class="history-task">${escapeHtml(item.taskId)}</div>
              <div class="history-item__actions">
                <button type="button" class="history-action history-action--query" data-history-task-id="${escapeHtml(item.taskId)}">重新查询</button>
                ${downloadButtons}
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.historyList.className = "history-list";
  elements.historyList.innerHTML = cards;
  upgradeToLocalImages();
}
async function handleSubmit(event) {
  event.preventDefault();
  persistForm();

  let state;
  let payload;

  try {
    ensureAttachmentsReady();
    state = collectFormState();
    payload = buildPayload(state);
  } catch (error) {
    setStatus(error.message || "请求参数无效", "error");
    return;
  }

  setStatus("正在提交生成任务...", "submitting");
  if (elements.requestDetails) elements.requestDetails.open = false;
  elements.requestPreview.textContent = JSON.stringify(payload, null, 2);

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
      const errMsg = result?.error?.message || result?.message || "任务提交失败";
      addErrorHistoryEntry(state, errMsg);
      throw new Error(errMsg);
    }

    const taskId =
      result.task_id ||
      result.id ||
      result.data?.task_id ||
      result.data?.[0]?.task_id ||
      result.data?.id;

    if (!taskId) {
      const errMsg = "响应中未找到 task_id";
      addErrorHistoryEntry(state, errMsg);
      throw new Error(errMsg);
    }

    addHistoryEntry(taskId, state);
    elements.taskBadge.textContent = `${taskId} (等 ${activeTasks.size + 1} 个)`;
    setStatus(`任务已提交，正在轮询 ${taskId} ...`, "queued");

    pollTask(state, taskId).catch((error) => {
      updateHistoryEntry(taskId, { lastStatus: "error", errorMessage: error.message || "轮询失败" });
      setStatus(error.message || "轮询失败", "error");
    });
  } catch (error) {
    setStatus(error.message || "请求失败", "error");
  }
}

function buildPayload(state) {
  const references = getUploadedReferenceUrls();
  const payload = {
    model: "gpt-image-2",
    prompt: state.prompt.trim(),
    size: state.aspectRatio,
    resolution: state.resolution,
    n: Number(state.imageCount) || 1,
    response_format: "url",
  };

  if (!payload.prompt) {
    throw new Error("提示词不能为空。");
  }

  validateResolution(state.aspectRatio, state.resolution);

  if (state.negativePrompt.trim()) payload.negative_prompt = state.negativePrompt.trim();
  if (state.background) payload.background = state.background;
  if (state.outputFormat) payload.output_format = state.outputFormat;
  payload.official_fallback = state.officialFallback === "true";
  payload.lang = state.taskLanguage;

  if (references.length) {
    payload.image_urls = references;
  }

  return payload;
}

function validateResolution(aspectRatio, resolution) {
  const unsupported = resolution === "4k" && ["21:9", "9:21"].includes(aspectRatio);
  if (unsupported) {
    throw new Error("当前比例暂不支持 4K，请切换到 1K / 2K 或调整比例。");
  }
}

async function refreshHistoryEntry(taskId) {
  const historyEntry = generationHistory.find((item) => item.taskId === taskId);
  const state = collectFormState();
  const refreshState = {
    ...state,
    taskLanguage: historyEntry?.taskLanguage || state.taskLanguage || "zh",
  };

  if (elements.requestDetails) elements.requestDetails.open = false;
  elements.taskBadge.textContent = `${taskId} (等 ${activeTasks.size + 1} 个)`;
  setStatus(`正在重新查询任务 ${taskId} ...`, "queued");

  pollTask(refreshState, taskId, { skipInitialDelay: true }).catch((error) => {
    setStatus(error.message || "查询失败", "error");
  });
}

async function pollTask(state, taskId, options = {}) {
  const pollUrl = `/api/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(state.taskLanguage || "zh")}`;
  const interval = Number(state.pollInterval) || 3000;
  const initialDelay = options.skipInitialDelay ? 0 : Number(state.initialPollDelay) || 0;
  const timeout = Number(state.pollTimeout) || 120000;
  const startedAt = Date.now();

  const abortController = new AbortController();
  activeTasks.set(taskId, { abortController });

  try {
    if (initialDelay > 0) {
      setStatus(`任务已提交，等待 ${Math.round(initialDelay / 1000)} 秒后开始首次轮询...`, "queued");
      await wait(initialDelay, abortController.signal);
    }

    let pollCount = 0;
    let taskImages = [];

    while (Date.now() - startedAt < timeout) {
      if (abortController.signal.aborted) return;

      pollCount += 1;
      syncGlobalStatus();
      setStatus(`[${taskId}] 第 ${pollCount} 次轮询...`, "processing");

      const response = await fetch(pollUrl, { signal: abortController.signal });
      const result = await response.json();
      renderRawResult(result);

      if (!response.ok) {
        updateHistoryEntry(taskId, { lastStatus: "error" });
        throw new Error(result?.error?.message || result?.message || "任务状态查询失败");
      }

      const status = extractTaskStatus(result);
      updateHistoryEntry(taskId, { lastStatus: status });
      setStatus(`[${taskId}] 第 ${pollCount} 次轮询 — ${buildStatusMessage(result, status)}`, status);

      const imageUrls = extractImageUrls(result);
      if (imageUrls.length) {
        taskImages = imageUrls;
        updateHistoryEntry(taskId, {
          previewImage: imageUrls[0] || "",
          previewImages: imageUrls,
        });
        for (const url of imageUrls) cacheRemoteImage(url);
      }

      if (isTaskCompleted(status)) {
        if (!taskImages.length) {
          setStatus("任务已完成，但未识别到图片地址，请检查原始响应。", "warning");
        } else {
          setStatus(`任务 ${taskId} 已完成，共获得 ${taskImages.length} 张图片。`, "success");
        }
        return;
      }

      if (isTaskFailed(status)) {
        updateHistoryEntry(taskId, { lastStatus: status });
        throw new Error(extractFailureMessage(result) || `任务失败：${status}`);
      }

      await wait(interval, abortController.signal);
    }

    updateHistoryEntry(taskId, { lastStatus: "timeout" });
    throw new Error("轮询超时，请稍后再试。");
  } finally {
    activeTasks.delete(taskId);
    syncGlobalStatus();
  }
}

async function handlePromptPaste(event) {
  const clipboardItems = [...(event.clipboardData?.items || [])];
  const imageItems = clipboardItems.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItems.length) return;

  event.preventDefault();
  const files = imageItems
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      return new File([file], file.name || `pasted-image-${Date.now()}-${index}.png`, {
        type: file.type || "image/png",
        lastModified: Date.now(),
      });
    })
    .filter(Boolean);

  await queueAttachments(files);
}

async function handleReferenceUpload(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  await queueAttachments(files);
  event.target.value = "";
}

async function queueAttachments(files) {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    setStatus("请先填写 API Key，再上传参考图。", "warning");
    openSettingsModal();
    return;
  }

  const items = files.map((file) => createAttachmentItem(file));
  attachmentItems.push(...items);
  syncModeBadge();
  renderAttachmentTray();
  persistForm();

  for (const item of items) {
    await uploadAttachmentItem(item, apiKey);
  }
}

function createAttachmentItem(file) {
  attachmentCounter += 1;
  return {
    id: `attachment-${attachmentCounter}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: "uploading",
    uploadedUrl: "",
    errorMessage: "",
  };
}

async function uploadAttachmentItem(item, apiKey) {
  updateAttachmentItem(item.id, { status: "uploading", errorMessage: "" });
  try {
    const uploadedUrl = await uploadReferenceFile(item.file, apiKey);
    updateAttachmentItem(item.id, { status: "success", uploadedUrl, errorMessage: "" });
    setStatus(`参考图已上传：${item.file.name}`, "queued");
  } catch (error) {
    updateAttachmentItem(item.id, {
      status: "error",
      uploadedUrl: "",
      errorMessage: error.message || "图片上传失败",
    });
    setStatus(error.message || "参考图上传失败", "error");
  }
}

function updateAttachmentItem(id, patch) {
  attachmentItems = attachmentItems.map((item) => (item.id === id ? { ...item, ...patch } : item));
  renderAttachmentTray();
  syncModeBadge();
  syncSubmitAvailability();
  persistForm();
}

function removeAttachment(id) {
  const target = attachmentItems.find((item) => item.id === id);
  if (target) revokeAttachmentPreview(target);
  attachmentItems = attachmentItems.filter((item) => item.id !== id);
  renderAttachmentTray();
  syncModeBadge();
  syncSubmitAvailability();
  persistForm();
}

function revokeAttachmentPreview(item) {
  if (item?.previewUrl) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function renderAttachmentTray() {
  if (!attachmentItems.length) {
    elements.attachmentTray.hidden = true;
    elements.attachmentTray.innerHTML = "";
    syncSubmitAvailability();
    return;
  }

  elements.attachmentTray.hidden = false;
  elements.attachmentTray.innerHTML = attachmentItems
    .map((item, index) => `
      <article class="attachment-chip attachment-chip--${escapeHtml(item.status)}">
        <div class="attachment-chip__thumb">
          <img src="${escapeHtml(item.previewUrl)}" alt="参考图 ${index + 1}">
          <button type="button" class="attachment-chip__remove" data-remove-attachment-id="${escapeHtml(item.id)}" aria-label="移除图片">×</button>
        </div>
        <div class="attachment-chip__meta">
          <span class="attachment-chip__name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
          <span class="attachment-chip__state">${buildAttachmentStateMarkup(item)}</span>
        </div>
      </article>
    `)
    .join("");
  syncSubmitAvailability();
}

function buildAttachmentStateMarkup(item) {
  if (item.status === "uploading") {
    return '<span class="attachment-state attachment-state--loading" aria-label="上传中"></span>';
  }
  if (item.status === "success") {
    return '<span class="attachment-state attachment-state--success" aria-label="上传成功">✓</span>';
  }
  return `<span class="attachment-state attachment-state--error" aria-label="上传失败" title="${escapeHtml(item.errorMessage || "上传失败")}">!</span>`;
}

function ensureAttachmentsReady() {
  const uploading = attachmentItems.find((item) => item.status === "uploading");
  if (uploading) {
    throw new Error("还有图片正在上传，请稍等上传完成后再提交。");
  }

  const failed = attachmentItems.find((item) => item.status === "error");
  if (failed) {
    throw new Error("有图片上传失败，请移除后重试。");
  }
}

function getUploadedReferenceUrls() {
  return attachmentItems
    .filter((item) => item.status === "success" && item.uploadedUrl)
    .map((item) => item.uploadedUrl);
}

function detectModeFromAttachments() {
  const count = attachmentItems.length;
  if (count <= 0) return "text";
  if (count === 1) return "image";
  return "multi";
}

async function uploadReferenceFile(file, apiKey) {
  const formData = new FormData();
  const normalizedFile = normalizeUploadFile(file);
  formData.append("file", normalizedFile, normalizedFile.name);

  const response = await fetch("/api/uploads/images", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
    },
    body: formData,
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result?.error?.message || result?.message || "图片上传失败");
  }

  const imageUrl =
    result.url ||
    result.data?.url ||
    result.data?.image_url ||
    result.data?.[0]?.url ||
    result.data?.[0]?.image_url;

  if (!imageUrl) {
    throw new Error("上传成功，但未返回图片 URL");
  }

  return imageUrl;
}

function normalizeUploadFile(file) {
  const mimeByExt = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const extension = String(file.name.split(".").pop() || "").toLowerCase();
  const inferredType = mimeByExt[extension] || "";
  const currentType = String(file.type || "").toLowerCase();
  const normalizedType = currentType && currentType !== "application/octet-stream" ? currentType : inferredType;

  if (!normalizedType || !Object.values(mimeByExt).includes(normalizedType)) {
    throw new Error("参考图仅支持 JPEG、PNG、GIF、WebP，请换一张图片试试。");
  }

  if (normalizedType === currentType) {
    return file;
  }

  return new File([file], file.name, {
    type: normalizedType,
    lastModified: file.lastModified,
  });
}

function syncModeBadge() {
  const mode = detectModeFromAttachments();
  const labelMap = {
    text: "文生图",
    image: "图生图",
    multi: "多图生图",
  };
  elements.modeBadge.textContent = labelMap[mode] || "文生图";
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

function openClearHistoryModal() {
  if (!generationHistory.length) {
    setStatus("暂无历史记录可清空。", "idle");
    return;
  }
  elements.clearHistoryModal.hidden = false;
  requestAnimationFrame(() => {
    elements.confirmClearHistoryBtn.focus();
  });
}

function closeClearHistoryModal() {
  elements.clearHistoryModal.hidden = true;
}

function clearHistory() {
  generationHistory = [];
  saveHistoryState();
  renderHistory();
  closeClearHistoryModal();
  setStatus("历史记录已清空。", "idle");
}

function getTemplateText(templateKey) {
  if (templateKey === "custom") {
    return "";
  }
  return NEGATIVE_TEMPLATES[templateKey] || NEGATIVE_TEMPLATES.general;
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

function renderGallery() {}

function renderRawResult(result) {
  if (!result) {
    elements.rawResult.hidden = true;
    elements.rawResultContent.textContent = "";
    return;
  }

  elements.rawResult.hidden = false;
  elements.rawResult.innerHTML = `
    <div class="raw-result__head">
      <h3 class="raw-result__title">原始响应</h3>
      <button type="button" class="ghost" data-raw-toggle aria-expanded="false">展开</button>
    </div>
    <pre id="rawResultContent" hidden>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
  `;
  elements.rawResultContent = elements.rawResult.querySelector("#rawResultContent");
}

function syncSubmitAvailability() {
  if (!elements.submitBtn) return;
  const hasUploadingAttachments = attachmentItems.some((item) => item.status === "uploading");
  elements.submitBtn.disabled = hasUploadingAttachments;
}

function setStatus(message, state) {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = mapStatusLabel(state);
}

function buildStatusMessage(result, status) {
  const normalized = String(status || "").toLowerCase();
  if (result?.code === 200 && ["completed", "success", "succeeded", "finished"].includes(normalized)) {
    return "任务已完成。";
  }
  if (normalized === "queued") return "任务排队中...";
  if (normalized === "processing" || normalized === "running") return "任务处理中...";
  return `任务状态：${status}`;
}

function mapStatusLabel(state) {
  const mapping = {
    idle: "空闲",
    warning: "注意",
    error: "错误",
    queued: "排队中",
    processing: "处理中",
    running: "处理中",
    submitting: "提交中",
    success: "完成",
    completed: "完成",
  };
  return mapping[state] || "空闲";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function writeCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

function updateLightboxImage() {
  const src = lightboxItems[lightboxIndex] || "";
  elements.lightboxImage.src = src;
  elements.lightboxPrevBtn.hidden = lightboxItems.length <= 1;
  elements.lightboxNextBtn.hidden = lightboxItems.length <= 1;
}

function openLightbox(items, activeSrc = "") {
  lightboxItems = Array.isArray(items) ? items.filter(Boolean) : [items].filter(Boolean);
  if (!lightboxItems.length) return;
  const matchedIndex = activeSrc ? lightboxItems.indexOf(activeSrc) : -1;
  lightboxIndex = matchedIndex >= 0 ? matchedIndex : 0;
  updateLightboxImage();
  elements.lightboxModal.hidden = false;
}

function showPreviousLightboxImage() {
  if (lightboxItems.length <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
  updateLightboxImage();
}

function showNextLightboxImage() {
  if (lightboxItems.length <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxItems.length;
  updateLightboxImage();
}

function closeLightbox() {
  elements.lightboxModal.hidden = true;
  elements.lightboxImage.src = "";
  lightboxItems = [];
  lightboxIndex = 0;
}

function syncGlobalStatus() {
  const count = activeTasks.size;
  if (count === 0) {
    elements.taskBadge.textContent = "暂无";
    setStatus("准备就绪", "idle");
  } else {
    const ids = [...activeTasks.keys()];
    elements.taskBadge.textContent = `${ids.length} 个任务进行中`;
    setStatus(`${ids.length} 个任务轮询中 (${ids.map((id) => id.slice(0, 8)).join(", ")}...)`, "processing");
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }
  });
}
