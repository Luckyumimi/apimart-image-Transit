const STORAGE_KEY = "apimart-image-bridge";
const HISTORY_KEY = "apimart-image-bridge-history";
const FIXED_BASE_URL = "https://api.apimart.ai";
const MAX_HISTORY_ITEMS = 20;
const MAX_REFERENCE_IMAGES = 16;
const EXT_IMAGE_RATIOS = ImageContract.extAspectRatios;
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

const DEFAULTS = {
  modelVariant: "gpt-image-2.6-ext-flare",
  aspectRatio: "auto",
  sizeMode: "auto",
  customWidth: "1024",
  customHeight: "1024",
  resolution: "1k",
  outputFormat: "",
  quality: "",
  complexity: "",
  imageCount: "1",
  taskLanguage: "zh",
  pollInterval: "3000",
  initialPollDelay: "12000",
  pollTimeout: "120000",
};

const elements = {
  form: document.getElementById("imageForm"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKey: document.getElementById("apiKey"),
  fixedBaseUrl: document.getElementById("fixedBaseUrl"),
  modelVariant: document.getElementById("modelVariant"),
  modelBillingHint: document.getElementById("modelBillingHint"),
  aspectRatio: document.getElementById("aspectRatio"),
  sizeMode: document.getElementById("sizeMode"),
  customWidth: document.getElementById("customWidth"),
  customHeight: document.getElementById("customHeight"),
  sizeSummary: document.getElementById("sizeSummary"),
  openSizeSettingsBtn: document.getElementById("openSizeSettingsBtn"),
  sizeSettingsModal: document.getElementById("sizeSettingsModal"),
  closeSizeSettingsBtn: document.getElementById("closeSizeSettingsBtn"),
  cancelSizeSettingsBtn: document.getElementById("cancelSizeSettingsBtn"),
  confirmSizeSettingsBtn: document.getElementById("confirmSizeSettingsBtn"),
  customSizeModeBtn: document.getElementById("customSizeModeBtn"),
  sizeModeHint: document.getElementById("sizeModeHint"),
  sizeRatioGrid: document.getElementById("sizeRatioGrid"),
  customSizeControls: document.getElementById("customSizeControls"),
  customWidthInput: document.getElementById("customWidthInput"),
  customHeightInput: document.getElementById("customHeightInput"),
  customSizeError: document.getElementById("customSizeError"),
  sizePreviewDimensions: document.getElementById("sizePreviewDimensions"),
  sizePreviewFrame: document.getElementById("sizePreviewFrame"),
  sizePreviewNote: document.getElementById("sizePreviewNote"),
  fixedGifRatio: document.getElementById("fixedGifRatio"),
  resolution: document.getElementById("resolution"),
  resolutionControl: document.getElementById("resolutionCtrl"),
  fixedExtResolution: document.getElementById("fixedExtResolution"),
  outputFormat: document.getElementById("outputFormat"),
  quality: document.getElementById("quality"),
  complexity: document.getElementById("complexity"),
  imageCount: document.getElementById("imageCount"),
  prompt: document.getElementById("prompt"),
  background: document.getElementById("background"),
  backgroundControl: document.getElementById("backgroundCtrl"),
  taskLanguage: document.getElementById("taskLanguage"),
  pollInterval: document.getElementById("pollInterval"),
  initialPollDelay: document.getElementById("initialPollDelay"),
  pollTimeout: document.getElementById("pollTimeout"),
  referenceUploadInput: document.getElementById("referenceUploadInput"),
  uploadReferenceBtn: document.getElementById("uploadReferenceBtn"),
  attachmentTray: document.getElementById("attachmentTray"),
  referenceHint: document.getElementById("referenceHint"),
  submitBtn: document.querySelector('#imageForm button[type="submit"]'),
  resetBtn: document.getElementById("resetBtn"),
  statusText: document.getElementById("statusText"),
  requestPreview: document.getElementById("requestPreview"),
  diagnosticsCard: document.getElementById("diagnosticsCard"),
  diagnosticsContent: document.getElementById("diagnosticsContent"),
  toggleDiagnosticsBtn: document.getElementById("toggleDiagnosticsBtn"),
  rawResultContent: document.getElementById("rawResultContent"),
  headerStatus: document.querySelector(".header__status"),
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
  dropOverlay: document.getElementById("dropOverlay"),
};

let activeTasks = new Map();
let generationHistory = [];
let attachmentItems = [];
let attachmentCounter = 0;
let lightboxItems = [];
let lightboxIndex = 0;
let activeSelectPicker = null;
let lastFlexibleResolution = null;
let lastFlexibleAspectRatio = null;
let lastFlexibleSizeMode = null;
let lastFlexibleCustomWidth = null;
let lastFlexibleCustomHeight = null;
let lastFlexibleImageCount = null;
let previousControlMode = null;
let sizeDialogDraft = null;
let fileDragDepth = 0;

init();

function init() {
  const savedState = getSavedState();
  if (savedState?.modelVariant === "gpt-image-2.6-flare") {
    savedState.modelVariant = DEFAULTS.modelVariant;
  }
  generationHistory = getHistoryState();
  hydrateForm(savedState);
  enhanceSelects();
  syncModelControls();
  syncModeBadge();
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
  elements.openSizeSettingsBtn.addEventListener("click", openSizeSettingsModal);
  elements.closeSizeSettingsBtn.addEventListener("click", closeSizeSettingsModal);
  elements.cancelSizeSettingsBtn.addEventListener("click", closeSizeSettingsModal);
  elements.confirmSizeSettingsBtn.addEventListener("click", confirmSizeSettings);
  elements.sizeSettingsModal.addEventListener("click", (event) => {
    if (event.target === elements.sizeSettingsModal) closeSizeSettingsModal();
  });
  elements.sizeSettingsModal.querySelectorAll("[data-size-mode]").forEach((button) => {
    button.addEventListener("click", () => setSizeDialogMode(button.dataset.sizeMode));
  });
  elements.sizeRatioGrid.addEventListener("click", (event) => {
    const option = event.target.closest("[data-ratio]");
    if (!option || option.disabled) return;
    sizeDialogDraft.aspectRatio = option.dataset.ratio;
    setSizeDialogMode("ratio");
  });
  elements.customWidthInput.addEventListener("input", updateSizeDialog);
  elements.customHeightInput.addEventListener("input", updateSizeDialog);
  elements.toggleDiagnosticsBtn.addEventListener("click", toggleDiagnostics);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.settingsModal.hidden) {
      closeSettingsModal();
    } else if (event.key === "Escape" && !elements.sizeSettingsModal.hidden) {
      closeSizeSettingsModal();
    }
  });

  elements.form.addEventListener("input", persistForm);
  elements.form.addEventListener("change", persistForm);
  elements.modelVariant.addEventListener("change", syncModelControls);
  elements.outputFormat.addEventListener("change", syncModelControls);
  elements.aspectRatio.addEventListener("change", () => {
    if (elements.outputFormat.value !== "gif") {
      elements.sizeMode.value = elements.aspectRatio.value === "auto" ? "auto" : "ratio";
      rememberFlexibleSize();
      syncSizeSummary();
    }
  });
  elements.form.addEventListener("submit", handleSubmit);
  elements.prompt.addEventListener("paste", handlePromptPaste);
  elements.referenceUploadInput.addEventListener("change", handleReferenceUpload);
  elements.uploadReferenceBtn.addEventListener("click", () => elements.referenceUploadInput.click());

  elements.attachmentTray.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-attachment-id]");
    if (!removeButton) return;
    removeAttachment(removeButton.dataset.removeAttachmentId);
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

  elements.resetBtn.addEventListener("click", () => {
    clearStorage();
    generationHistory = getHistoryState();
    attachmentItems.forEach(revokeAttachmentPreview);
    attachmentItems = [];
    previousControlMode = null;
    hydrateForm(DEFAULTS);
    syncModeBadge();
    renderAttachmentTray();
    renderHistory();
    elements.taskBadge.textContent = "暂无";
    setStatus("准备就绪。", "idle");
    elements.requestPreview.textContent = "尚未提交请求";
    renderRawResult(null);
    elements.diagnosticsCard.hidden = true;
    setDiagnosticsExpanded(false);
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

  window.addEventListener("dragenter", handlePageImageDragEnter);
  window.addEventListener("dragover", handlePageImageDragOver);
  window.addEventListener("dragleave", handlePageImageDragLeave);
  window.addEventListener("drop", handlePageImageDrop);
}

function hydrateForm(savedState = {}) {
  const state = { ...DEFAULTS, ...savedState };
  if (!Object.prototype.hasOwnProperty.call(savedState, "sizeMode")) {
    state.sizeMode = state.aspectRatio === "auto" ? "auto" : "ratio";
  }
  elements.fixedBaseUrl.value = FIXED_BASE_URL;
  elements.apiKey.value = state.apiKey || "";
  elements.modelVariant.value = state.modelVariant || DEFAULTS.modelVariant;
  elements.aspectRatio.value = state.aspectRatio || DEFAULTS.aspectRatio;
  elements.sizeMode.value = state.sizeMode || DEFAULTS.sizeMode;
  elements.customWidth.value = state.customWidth || DEFAULTS.customWidth;
  elements.customHeight.value = state.customHeight || DEFAULTS.customHeight;
  elements.resolution.value = state.resolution || DEFAULTS.resolution;
  elements.outputFormat.value = state.outputFormat || DEFAULTS.outputFormat;
  elements.quality.value = state.quality || DEFAULTS.quality;
  elements.complexity.value = state.complexity || DEFAULTS.complexity;
  elements.imageCount.value = state.imageCount || DEFAULTS.imageCount;
  elements.prompt.value = state.prompt || "";
  elements.background.value = state.background || "";
  elements.taskLanguage.value = state.taskLanguage || DEFAULTS.taskLanguage;
  elements.pollInterval.value = state.pollInterval || DEFAULTS.pollInterval;
  elements.initialPollDelay.value = state.initialPollDelay || DEFAULTS.initialPollDelay;
  elements.pollTimeout.value = state.pollTimeout || DEFAULTS.pollTimeout;
  syncSelectPickers();
}

function enhanceSelects() {
  document.querySelectorAll("select").forEach((select) => {
    if (select.dataset.enhanced === "true") return;
    if (select.id === "aspectRatio") {
      select.classList.add("select-native");
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      return;
    }

    const control = select.closest(".ctrl");
    const label = control?.querySelector(`label[for="${select.id}"]`);
    const picker = document.createElement("div");
    const trigger = document.createElement("button");
    const value = document.createElement("span");
    const chevron = document.createElement("span");
    const options = document.createElement("div");
    const listId = `${select.id}-options`;

    picker.className = "display-picker";
    picker.setAttribute("data-picker", "");
    trigger.type = "button";
    trigger.className = "picker-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", listId);
    if (label) {
      if (!label.id) label.id = `${select.id}-label`;
      trigger.setAttribute("aria-labelledby", label.id);
    }
    value.className = "picker-value";
    chevron.className = "picker-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(value, chevron);

    options.id = listId;
    options.className = "picker-options";
    options.setAttribute("role", "listbox");
    options.setAttribute("aria-labelledby", label?.id || select.id);

    [...select.options].forEach((option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.value = option.value;
      item.dataset.index = String(index);
      item.textContent = option.textContent.trim();
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.selected));
      item.disabled = option.disabled;
      item.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeSelectPicker(picker, true);
      });
      options.append(item);
    });

    picker.append(trigger, options);
    select.after(picker);
    select.classList.add("select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.dataset.enhanced = "true";

    const instance = { select, picker, trigger, options, value };
    trigger.addEventListener("click", () => {
      if (picker.classList.contains("is-open")) closeSelectPicker(picker);
      else openSelectPicker(instance, false);
    });
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openSelectPicker(instance, event.key === "ArrowUp");
    });
    options.addEventListener("keydown", (event) => handleSelectPickerKeydown(event, instance));
    select.addEventListener("change", () => syncSelectPicker(instance));
    select._pickerInstance = instance;
    syncSelectPicker(instance);
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      activeSelectPicker &&
      !activeSelectPicker.picker.contains(event.target)
    ) {
      closeSelectPicker(activeSelectPicker.picker);
    }
  });
  window.addEventListener("resize", repositionActiveSelectPicker);
  window.addEventListener("scroll", repositionActiveSelectPicker, true);
}

function syncSelectPickers() {
  document.querySelectorAll("select[data-enhanced='true']").forEach((select) => {
    if (select._pickerInstance) syncSelectPicker(select._pickerInstance);
  });
}

function syncSelectPicker(instance) {
  const selected = instance.select.selectedOptions[0];
  instance.value.textContent = selected?.textContent.trim() || "请选择";
  instance.options.querySelectorAll("[role='option']").forEach((item) => {
    item.setAttribute("aria-selected", String(item.dataset.value === instance.select.value));
  });
}

function setSelectOptionsDisabled(select, disabledValues) {
  [...select.options].forEach((option) => {
    const disabled = disabledValues.has(option.value);
    option.disabled = disabled;
    const pickerItem = select._pickerInstance?.options.querySelector(`[data-value="${option.value}"]`);
    if (pickerItem) {
      pickerItem.disabled = disabled;
      pickerItem.setAttribute("aria-disabled", String(disabled));
    }
  });
}

function syncModelControls() {
  const isExt = elements.modelVariant.value.startsWith("gpt-image-2.6-ext-");
  const outputFormat = elements.outputFormat.value;
  const hasReferences = attachmentItems.length > 0;
  const isGif = outputFormat === "gif";
  const isSvg = outputFormat === "svg";
  const requiresSingleImage = isExt || isSvg;

  if (!previousControlMode) {
    lastFlexibleResolution = elements.resolution.value || "1k";
    lastFlexibleAspectRatio = elements.aspectRatio.value || "auto";
    lastFlexibleImageCount = elements.imageCount.value || "1";
    rememberFlexibleSize();
  } else {
    if (previousControlMode.isExt && !isExt) {
      elements.resolution.value = lastFlexibleResolution || "1k";
    } else if (!previousControlMode.isExt && isExt) {
      lastFlexibleResolution = elements.resolution.value || "1k";
    } else if (!isExt) {
      lastFlexibleResolution = elements.resolution.value || "1k";
    }

    if (previousControlMode.isGif && !isGif) {
      elements.aspectRatio.value = lastFlexibleAspectRatio || "auto";
    } else if (!previousControlMode.isGif && isGif) {
      lastFlexibleAspectRatio = elements.aspectRatio.value || "auto";
    } else if (previousControlMode.isExt && !isExt) {
      elements.aspectRatio.value = lastFlexibleAspectRatio || "auto";
    } else if (!isGif && !isExt) {
      lastFlexibleAspectRatio = elements.aspectRatio.value || "auto";
    }

    if (previousControlMode.requiresSingleImage && !requiresSingleImage) {
      elements.imageCount.value = lastFlexibleImageCount || "1";
    } else if (!previousControlMode.requiresSingleImage && requiresSingleImage) {
      lastFlexibleImageCount = elements.imageCount.value || "1";
    } else if (!requiresSingleImage) {
      lastFlexibleImageCount = elements.imageCount.value || "1";
    }

    const wasRestrictedSize = previousControlMode.isExt || previousControlMode.isGif;
    const isRestrictedSize = isExt || isGif;
    if (!wasRestrictedSize && isRestrictedSize) {
      rememberFlexibleSize();
    } else if (wasRestrictedSize && !isRestrictedSize) {
      restoreFlexibleSize();
    } else if (!isRestrictedSize) {
      rememberFlexibleSize();
    }
  }

  const disabledRatios = new Set();
  [...elements.aspectRatio.options].forEach((option) => {
    const allowed = isGif
      ? option.value === "auto"
      : !isExt || EXT_IMAGE_RATIOS.includes(option.value);
    if (!allowed) disabledRatios.add(option.value);
  });
  setSelectOptionsDisabled(elements.aspectRatio, disabledRatios);
  if (isExt && elements.sizeMode.value === "custom") {
    elements.sizeMode.value = "ratio";
    elements.aspectRatio.value = "auto";
  }
  if (isGif) {
    elements.sizeMode.value = "auto";
    elements.aspectRatio.value = "auto";
  } else if (disabledRatios.has(elements.aspectRatio.value)) {
    elements.aspectRatio.value = "auto";
  }
  elements.openSizeSettingsBtn.hidden = isGif;
  elements.fixedGifRatio.hidden = !isGif;

  if (isExt) elements.resolution.value = "1k";
  const isCustomSize = elements.sizeMode.value === "custom";
  elements.resolution._pickerInstance.picker.hidden = isExt || isCustomSize;
  elements.resolutionControl.hidden = isCustomSize;
  elements.fixedExtResolution.hidden = !isExt;

  elements.imageCount.disabled = requiresSingleImage;
  elements.imageCount.min = "1";
  elements.imageCount.max = requiresSingleImage ? "1" : "4";
  if (requiresSingleImage) elements.imageCount.value = "1";
  else {
    const count = Number(elements.imageCount.value);
    if (!Number.isFinite(count) || count < 1) elements.imageCount.value = "1";
    else if (count > 4) elements.imageCount.value = "4";
  }

  const disabledFormats = new Set();
  if (hasReferences) {
    disabledFormats.add("svg");
    if (isExt) disabledFormats.add("gif");
  }
  setSelectOptionsDisabled(elements.outputFormat, disabledFormats);

  const disabledBackgrounds = elements.outputFormat.value === "jpeg"
    ? new Set(["transparent"])
    : new Set();
  setSelectOptionsDisabled(elements.background, disabledBackgrounds);
  if (disabledBackgrounds.has(elements.background.value)) elements.background.value = "";
  elements.backgroundControl.hidden = isExt || isGif || isSvg;
  elements.modelBillingHint.textContent = isExt
    ? "按张固定价 · 当前仅开放 1K、单张；单价由版本和分辨率决定，质量档位不另收费。"
    : `按图片 Token 用量计费；自动质量按 max 档预留，最终按实际档位结算${isSvg ? "；SVG 还会产生文本模型 Token 用量。" : "。需要固定单价时，请选择 Ext Flare 或 Ext Sunburst。"}`;
  elements.modelBillingHint.dataset.billing = isExt ? "fixed" : "usage";

  const textOnlyFormat = isSvg || (isExt && isGif);
  elements.uploadReferenceBtn.disabled = textOnlyFormat;
  elements.referenceUploadInput.disabled = textOnlyFormat;
  elements.referenceHint.textContent = hasReferences && (isSvg || (isExt && isGif))
    ? "当前参考图与输出格式不兼容，请改用 PNG、JPEG、WebP 或移除参考图。"
    : textOnlyFormat
    ? isSvg
      ? "SVG 仅支持文生图，参考图上传和粘贴已暂停。"
      : "GIF 仅支持文生图，参考图上传和粘贴已暂停。"
    : "最多 16 张参考图，按添加顺序用于图生图。";

  previousControlMode = { isExt, isGif, requiresSingleImage };
  syncSizeSummary();
  syncSelectPickers();
  syncSubmitAvailability();
}

function rememberFlexibleSize() {
  lastFlexibleSizeMode = elements.sizeMode.value || "auto";
  lastFlexibleCustomWidth = elements.customWidth.value || "1024";
  lastFlexibleCustomHeight = elements.customHeight.value || "1024";
  lastFlexibleAspectRatio = elements.aspectRatio.value || "auto";
}

function restoreFlexibleSize() {
  elements.sizeMode.value = lastFlexibleSizeMode || "auto";
  elements.customWidth.value = lastFlexibleCustomWidth || "1024";
  elements.customHeight.value = lastFlexibleCustomHeight || "1024";
  elements.aspectRatio.value = lastFlexibleAspectRatio || "auto";
}

function getCurrentSizeLabel() {
  if (elements.sizeMode.value === "custom") {
    return `${elements.customWidth.value} × ${elements.customHeight.value}`;
  }
  if (elements.sizeMode.value === "ratio") return elements.aspectRatio.value;
  return "自动";
}

function syncSizeSummary() {
  elements.sizeSummary.textContent = getCurrentSizeLabel();
}

function openSizeSettingsModal() {
  if (elements.outputFormat.value === "gif") return;
  sizeDialogDraft = {
    mode: elements.sizeMode.value || "auto",
    aspectRatio: elements.aspectRatio.value || "auto",
    width: elements.customWidth.value || "1024",
    height: elements.customHeight.value || "1024",
  };
  elements.customWidthInput.value = sizeDialogDraft.width;
  elements.customHeightInput.value = sizeDialogDraft.height;
  elements.sizeSettingsModal.hidden = false;
  updateSizeDialog();
  requestAnimationFrame(() => {
    const selected = elements.sizeSettingsModal.querySelector(`[data-size-mode="${sizeDialogDraft.mode}"]`);
    (selected && !selected.hidden ? selected : elements.closeSizeSettingsBtn).focus();
  });
}

function closeSizeSettingsModal() {
  elements.sizeSettingsModal.hidden = true;
  sizeDialogDraft = null;
  elements.openSizeSettingsBtn.focus();
}

function setSizeDialogMode(mode) {
  if (!sizeDialogDraft) return;
  const isExt = elements.modelVariant.value.startsWith("gpt-image-2.6-ext-");
  if (mode === "custom" && isExt) return;
  if (mode === "ratio" && sizeDialogDraft.aspectRatio === "auto") {
    sizeDialogDraft.aspectRatio = "1:1";
  }
  sizeDialogDraft.mode = mode;
  updateSizeDialog();
}

function updateSizeDialog() {
  if (!sizeDialogDraft) return;
  sizeDialogDraft.width = elements.customWidthInput.value;
  sizeDialogDraft.height = elements.customHeightInput.value;

  const isExt = elements.modelVariant.value.startsWith("gpt-image-2.6-ext-");
  elements.customSizeModeBtn.hidden = isExt;
  if (isExt && sizeDialogDraft.mode === "custom") sizeDialogDraft.mode = "ratio";

  const allowedRatios = isExt ? EXT_IMAGE_RATIOS.filter((ratio) => ratio !== "auto") : ImageContract.aspectRatios;
  if (!allowedRatios.includes(sizeDialogDraft.aspectRatio)) {
    sizeDialogDraft.aspectRatio = allowedRatios.includes("1:1") ? "1:1" : allowedRatios[0];
  }

  elements.sizeSettingsModal.querySelectorAll("[data-size-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.sizeMode === sizeDialogDraft.mode));
  });
  elements.sizeRatioGrid.hidden = sizeDialogDraft.mode !== "ratio";
  elements.customSizeControls.hidden = sizeDialogDraft.mode !== "custom";
  elements.sizeRatioGrid.querySelectorAll("[data-ratio]").forEach((button) => {
    const disabled = !allowedRatios.includes(button.dataset.ratio);
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(button.dataset.ratio === sizeDialogDraft.aspectRatio && sizeDialogDraft.mode === "ratio"));
  });

  const customError = sizeDialogDraft.mode === "custom"
    ? ImageContract.validateCustomDimensions(sizeDialogDraft.width, sizeDialogDraft.height)
    : "";
  elements.customSizeError.textContent = customError;
  elements.confirmSizeSettingsBtn.disabled = Boolean(customError);

  const ratioParts = sizeDialogDraft.mode === "custom"
    ? [Number(sizeDialogDraft.width), Number(sizeDialogDraft.height)]
    : sizeDialogDraft.mode === "ratio"
    ? sizeDialogDraft.aspectRatio.split(":").map(Number)
    : [1, 1];
  const ratio = ratioParts.every((value) => Number.isFinite(value) && value > 0) ? ratioParts.join(" / ") : "1 / 1";
  elements.sizePreviewFrame.style.aspectRatio = ratio;

  const summary = sizeDialogDraft.mode === "custom"
    ? `${sizeDialogDraft.width || "?"} × ${sizeDialogDraft.height || "?"} px`
    : sizeDialogDraft.mode === "ratio"
    ? sizeDialogDraft.aspectRatio
    : "自动尺寸";
  elements.sizePreviewDimensions.textContent = summary;
  elements.sizeModeHint.textContent = isExt
    ? "Ext Flare / Sunburst 当前仅开放 1K 和文档支持的比例。"
    : sizeDialogDraft.mode === "custom"
    ? "精确像素尺寸会替代比例；此模式不发送分辨率档位。"
    : "普通 Flare / Sunburst 支持 1K、2K、4K 及精确像素尺寸。";
  elements.sizePreviewNote.textContent = sizeDialogDraft.mode === "auto"
    ? "由模型按提示词自动决定画布比例。"
    : sizeDialogDraft.mode === "custom"
    ? customError || "尺寸符合接口限制。"
    : "预览仅表示画布长宽关系。";
}

function confirmSizeSettings() {
  if (!sizeDialogDraft) return;
  if (sizeDialogDraft.mode === "custom") {
    const error = ImageContract.validateCustomDimensions(sizeDialogDraft.width, sizeDialogDraft.height);
    if (error) {
      elements.customSizeError.textContent = error;
      return;
    }
  }

  elements.sizeMode.value = sizeDialogDraft.mode;
  elements.aspectRatio.value = sizeDialogDraft.mode === "ratio" ? sizeDialogDraft.aspectRatio : "auto";
  elements.customWidth.value = sizeDialogDraft.width;
  elements.customHeight.value = sizeDialogDraft.height;
  rememberFlexibleSize();
  syncSizeSummary();
  syncModelControls();
  persistForm();
  closeSizeSettingsModal();
}

function openSelectPicker(instance, fromEnd) {
  if (activeSelectPicker && activeSelectPicker !== instance) {
    closeSelectPicker(activeSelectPicker.picker);
  }
  activeSelectPicker = instance;
  instance.picker.classList.add("is-open");
  instance.trigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => positionSelectPicker(instance));
  const enabled = [...instance.options.querySelectorAll("[role='option']:not(:disabled)")];
  const selectedIndex = enabled.findIndex((item) => item.getAttribute("aria-selected") === "true");
  const target = fromEnd ? enabled.at(-1) : enabled[Math.max(0, selectedIndex)];
  target?.focus();
  target?.scrollIntoView({ block: "nearest" });
}

function closeSelectPicker(picker, restoreFocus = false) {
  if (!picker) return;
  const trigger = picker.querySelector(".picker-trigger");
  picker.classList.remove("is-open");
  trigger?.setAttribute("aria-expanded", "false");
  if (activeSelectPicker?.picker === picker) activeSelectPicker = null;
  if (restoreFocus) trigger?.focus();
}

function positionSelectPicker(instance) {
  const rect = instance.trigger.getBoundingClientRect();
  const gap = 7;
  const menuStyle = getComputedStyle(instance.options);
  const rows = [...instance.options.children];
  const rowGap = parseFloat(menuStyle.rowGap) || 0;
  const verticalPadding = 12;
  const rowsHeight = rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0);
  const contentHeight = Math.min(280, rowsHeight + rowGap * Math.max(0, rows.length - 1) + verticalPadding);
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap);
  const spaceAbove = Math.max(0, rect.top - gap);
  const opensAbove = spaceBelow < contentHeight && spaceAbove > spaceBelow;
  const maxHeight = Math.max(0, Math.min(contentHeight, opensAbove ? spaceAbove : spaceBelow));
  instance.picker.style.setProperty("--dropdown-top", `${Math.max(8, opensAbove ? rect.top - gap - maxHeight : rect.bottom + gap)}px`);
  instance.picker.style.setProperty("--dropdown-left", `${rect.left}px`);
  instance.picker.style.setProperty("--dropdown-width", `${rect.width}px`);
  instance.picker.style.setProperty("--dropdown-max-height", `${maxHeight}px`);
}

function repositionActiveSelectPicker() {
  if (activeSelectPicker) positionSelectPicker(activeSelectPicker);
}

function handleSelectPickerKeydown(event, instance) {
  const items = [...instance.options.querySelectorAll("[role='option']:not(:disabled)")];
  const currentIndex = items.indexOf(document.activeElement);
  let nextIndex = currentIndex;

  if (event.key === "Escape") {
    event.preventDefault();
    closeSelectPicker(instance.picker, true);
    return;
  }
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else if (event.key === "Tab") {
    closeSelectPicker(instance.picker);
    return;
  } else return;

  event.preventDefault();
  items[nextIndex]?.focus();
  items[nextIndex]?.scrollIntoView({ block: "nearest" });
}

function persistForm() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormState()));
}

function collectFormState() {
  return {
    apiKey: elements.apiKey.value.trim(),
    modelVariant: elements.modelVariant.value,
    aspectRatio: elements.aspectRatio.value,
    sizeMode: elements.sizeMode.value,
    customWidth: elements.customWidth.value,
    customHeight: elements.customHeight.value,
    resolution: elements.resolution.value,
    outputFormat: elements.outputFormat.value,
    quality: elements.quality.value,
    complexity: elements.complexity.value,
    imageCount: elements.imageCount.value,
    prompt: elements.prompt.value,
    background: elements.background.value,
    taskLanguage: elements.taskLanguage.value,
    pollInterval: elements.pollInterval.value,
    initialPollDelay: elements.initialPollDelay.value,
    pollTimeout: elements.pollTimeout.value,
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
                `<a class="launcher-button launcher-button--compact history-action history-action--download" href="/api/download?url=${encodeURIComponent(url)}" download>下载</a>`
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
                <button type="button" class="launcher-button launcher-button--compact history-action history-action--query" data-history-task-id="${escapeHtml(item.taskId)}">重新查询</button>
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
  elements.diagnosticsCard.hidden = false;
  setDiagnosticsExpanded(false);
  elements.requestPreview.textContent = JSON.stringify(payload, null, 2);
  renderRawResult(null);

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
  const isExt = state.modelVariant.startsWith("gpt-image-2.6-ext-");
  const version = state.modelVariant.endsWith("sunburst") ? "sunburst" : "flare";
  const model = isExt ? "gpt-image-2.6-ext" : `gpt-image-2.6-${version}`;
  const payload = {
    model,
    prompt: state.prompt.trim(),
    size: state.sizeMode === "custom"
      ? `${state.customWidth}x${state.customHeight}`
      : state.sizeMode === "ratio"
      ? state.aspectRatio
      : "auto",
    n: Number(state.imageCount) || 1,
  };
  if (state.sizeMode !== "custom") payload.resolution = state.resolution;

  if (!payload.prompt) {
    throw new Error("提示词不能为空。");
  }

  validateResolution(state, isExt);

  if (state.quality) payload.quality = state.quality;
  if (state.complexity) payload.complexity = state.complexity;
  if (state.background && !isExt && !["gif", "svg"].includes(state.outputFormat)) {
    payload.background = state.background;
  }
  if (state.outputFormat) payload.output_format = state.outputFormat;

  if (isExt) {
    payload.version = version;
  }

  if (references.length) {
    payload.image_urls = references;
  }

  return payload;
}

function validateResolution(state, isExt) {
  if (state.sizeMode === "custom") {
    if (isExt) throw new Error("2.6 Ext 不支持自定义像素尺寸。");
    const sizeError = ImageContract.validateCustomDimensions(state.customWidth, state.customHeight);
    if (sizeError) throw new Error(sizeError);
  }
  if (isExt && !EXT_IMAGE_RATIOS.includes(state.aspectRatio)) {
    throw new Error("2.6 Ext 不支持当前比例，请选择自动或文档列出的 1K 比例。");
  }
  if (isExt && state.resolution !== "1k") {
    throw new Error("2.6 Ext 当前仅支持 1K 分辨率。");
  }
  if (isExt && Number(state.imageCount) !== 1) {
    throw new Error("2.6 Ext 当前仅支持生成 1 张图片。");
  }
  if (state.outputFormat === "gif" && state.aspectRatio !== "auto") {
    throw new Error("GIF 输出的比例必须使用自动。");
  }
  if (state.outputFormat === "svg" && getUploadedReferenceUrls().length) {
    throw new Error("SVG 输出不支持参考图。");
  }
  if (state.outputFormat === "svg" && Number(state.imageCount) !== 1) {
    throw new Error("SVG 输出仅支持生成 1 张图片。");
  }
  if (state.outputFormat === "gif" && isExt && getUploadedReferenceUrls().length) {
    throw new Error("2.6 Ext 的 GIF 仅支持文生图，不支持参考图。");
  }
}

async function refreshHistoryEntry(taskId) {
  const historyEntry = generationHistory.find((item) => item.taskId === taskId);
  const state = collectFormState();
  const refreshState = {
    ...state,
    taskLanguage: historyEntry?.taskLanguage || state.taskLanguage || "zh",
  };

  setDiagnosticsExpanded(false);
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

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function handlePageImageDragEnter(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  elements.dropOverlay.hidden = false;
}

function handlePageImageDragOver(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handlePageImageDragLeave(event) {
  if (!hasDraggedFiles(event)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) elements.dropOverlay.hidden = true;
}

async function handlePageImageDrop(event) {
  const droppedFiles = [...(event.dataTransfer?.files || [])];
  if (!hasDraggedFiles(event) && !droppedFiles.length) return;
  event.preventDefault();
  fileDragDepth = 0;
  elements.dropOverlay.hidden = true;
  const allowedExtensions = /\.(jpe?g|png|gif|webp)$/i;
  const files = droppedFiles.filter((file) =>
    ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type.toLowerCase()) || allowedExtensions.test(file.name)
  );
  if (!files.length) {
    setStatus("拖入的文件中没有受支持的图片。", "warning");
    return;
  }
  await queueAttachments(files);
}

async function handleReferenceUpload(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  await queueAttachments(files);
  event.target.value = "";
}

async function queueAttachments(files) {
  const format = elements.outputFormat.value;
  const isExt = elements.modelVariant.value.startsWith("gpt-image-2.6-ext-");
  if (format === "svg" || (isExt && format === "gif")) {
    setStatus("当前格式仅支持文生图，请先切换为 PNG、JPEG 或 WebP 后再添加参考图。", "warning");
    return;
  }

  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    setStatus("请先填写 API Key，再上传参考图。", "warning");
    openSettingsModal();
    return;
  }

  const availableSlots = MAX_REFERENCE_IMAGES - attachmentItems.length;
  if (availableSlots <= 0) {
    setStatus(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图，请先移除已有图片。`, "warning");
    return;
  }
  const acceptedFiles = files.slice(0, availableSlots);
  const ignoredCount = files.length - acceptedFiles.length;
  const items = acceptedFiles.map((file) => createAttachmentItem(file));
  attachmentItems.push(...items);
  syncModeBadge();
  renderAttachmentTray();
  persistForm();

  for (const item of items) {
    await uploadAttachmentItem(item, apiKey);
  }
  if (ignoredCount > 0) {
    setStatus(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图，超出的 ${ignoredCount} 张未添加。`, "warning");
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
  syncModelControls();
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
    result.data?.result?.files,
    result.data?.files,
    result.result?.files,
    result.files,
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
      if (typeof item?.image_url === "string") {
        urls.add(item.image_url);
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

function toggleDiagnostics() {
  setDiagnosticsExpanded(elements.diagnosticsContent.hidden);
}

function setDiagnosticsExpanded(expanded) {
  elements.diagnosticsContent.hidden = !expanded;
  elements.toggleDiagnosticsBtn.setAttribute("aria-expanded", String(expanded));
  elements.toggleDiagnosticsBtn.textContent = expanded ? "收起" : "展开";
}

function renderRawResult(result) {
  elements.rawResultContent.textContent = result
    ? JSON.stringify(result, null, 2)
    : "等待生成响应";
  if (result) elements.diagnosticsCard.hidden = false;
}

function syncSubmitAvailability() {
  if (!elements.submitBtn) return;
  const hasUploadingAttachments = attachmentItems.some((item) => item.status === "uploading");
  const isExt = elements.modelVariant.value.startsWith("gpt-image-2.6-ext-");
  const incompatibleReferences = attachmentItems.length > 0 && (
    elements.outputFormat.value === "svg" ||
    (isExt && elements.outputFormat.value === "gif")
  );
  elements.submitBtn.disabled = hasUploadingAttachments || incompatibleReferences;
}

function setStatus(message, state) {
  elements.statusText.textContent = message;
  elements.statusBadge.textContent = mapStatusLabel(state);
  elements.statusBadge.dataset.state = state || "idle";
  elements.headerStatus.dataset.state = state || "idle";
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
