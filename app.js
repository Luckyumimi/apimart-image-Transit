const STORAGE_KEY = "apimart-image-bridge";
const HISTORY_KEY = "apimart-image-bridge-history";
const FIXED_BASE_URL = "https://api.apimart.ai";
const MAX_HISTORY_ITEMS = 20;

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
  lightboxModal: document.getElementById("lightboxModal"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxCloseBtn: document.getElementById("lightboxCloseBtn"),
};

let activePoll = null;
let selectedNegativeTemplate = DEFAULTS.selectedNegativeTemplate;
let generationHistory = [];
let attachmentItems = [];
let attachmentCounter = 0;

init();

function init() {
  const savedState = getSavedState();
  generationHistory = getHistoryState();
  selectedNegativeTemplate = savedState.selectedNegativeTemplate || DEFAULTS.selectedNegativeTemplate;
  hydrateForm(savedState);
  enhanceResultPanel();
  syncModeBadge();
  syncTemplateUI();
  renderHistory();
  renderAttachmentTray();
  syncSubmitAvailability();
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
    elements.taskIdValue.textContent = "-";
    elements.taskStateValue.textContent = "-";
    elements.taskBadge.textContent = "暂无";
    setStatus("准备就绪。", "idle");
    elements.requestPreview.textContent = "尚未提交请求";
    if (elements.requestDetails) elements.requestDetails.open = false;
    renderRawResult(null);
    renderGallery([]);
  });

  elements.lightboxCloseBtn.addEventListener("click", closeLightbox);
  elements.lightboxModal.addEventListener("click", (event) => {
    if (event.target === elements.lightboxModal) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.lightboxModal.hidden) closeLightbox();
  });

  document.addEventListener("click", (event) => {
    const downloadTrigger = event.target.closest("[data-force-download]");
    if (!downloadTrigger) return;
    event.preventDefault();
    forceDownload(downloadTrigger.dataset.forceDownload);
  });

  document.addEventListener("click", (event) => {
    const img = event.target.closest("[data-lightbox]");
    if (!img) return;
    openLightbox(img.dataset.lightbox);
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
  writeCookie(STORAGE_KEY, JSON.stringify(collectFormState()), 365);
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
    mode: detectModeFromAttachments(),
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
    multi: "多图生图",
  };

  const cards = generationHistory
    .map((item) => {
      const modeLabel = modeLabels[item.mode] || item.mode;
      const previewImages = Array.isArray(item.previewImages) && item.previewImages.length
        ? item.previewImages
        : (item.previewImage ? [item.previewImage] : []);

      const previewMarkup = previewImages.length
        ? `<div class="history-thumbs">${previewImages.map((url) => `<div class="history-thumbs__item"><img src="${escapeHtml(url)}" alt="历史缩略图" data-lightbox="${escapeHtml(url)}"></div>`).join("")}</div>`
        : `<div class="history-thumb"><div class="history-placeholder">等待生成结果</div></div>`;

      const downloadButtons = previewImages.length
        ? `<div class="history-download-list">${previewImages
            .map(
              (url) =>
                `<button type="button" class="secondary history-download" data-force-download="${escapeHtml(url)}">下载</button>`
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
    ensureAttachmentsReady();
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

  setBusy(true);
  if (elements.requestDetails) elements.requestDetails.open = false;
  elements.taskIdValue.textContent = taskId;
  elements.taskBadge.textContent = taskId;
  setStatus(`正在重新查询任务 ${taskId} ...`, "queued");

  try {
    await pollTask(refreshState, taskId, { skipInitialDelay: true });
  } catch (error) {
    setStatus(error.message || "查询失败", "error");
  } finally {
    setBusy(false);
  }
}

async function pollTask(state, taskId, options = {}) {
  const pollUrl = `/api/tasks/${encodeURIComponent(taskId)}?language=${encodeURIComponent(state.taskLanguage || "zh")}`;
  const interval = Number(state.pollInterval) || 3000;
  const initialDelay = options.skipInitialDelay ? 0 : Number(state.initialPollDelay) || 0;
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
          <img src="${escapeHtml(url)}" alt="生成结果 ${index + 1}" data-lightbox="${escapeHtml(url)}" style="cursor:zoom-in">
          <div class="image-card-body">
            <strong>结果 ${index + 1}</strong>
            <code>${escapeHtml(url)}</code>
            <button type="button" class="btn btn--ghost btn--sm download-link" data-force-download="${escapeHtml(url)}">下载</button>
          </div>
        </article>
      `
    )
    .join("");

  elements.resultGallery.className = "gallery";
  elements.resultGallery.innerHTML = `<div class="gallery-grid">${cards}</div>`;
}

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

function setBusy(isBusy) {
  const controls = elements.form.querySelectorAll("button, input, textarea, select");
  controls.forEach((control) => {
    if (control === elements.referenceUploadInput) return;
    control.disabled = isBusy;
  });
  if (!isBusy) {
    syncSubmitAvailability();
  }
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
  writeCookie(STORAGE_KEY, "", -1);
}

function openLightbox(src) {
  elements.lightboxImage.src = src;
  elements.lightboxModal.hidden = false;
}

function closeLightbox() {
  elements.lightboxModal.hidden = true;
  elements.lightboxImage.src = "";
}

async function forceDownload(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    const filename = url.split("/").pop().split("?")[0] || "image.png";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    activePoll = setTimeout(resolve, ms);
  });
}
