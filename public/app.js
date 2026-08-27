function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

let selectedFile = null;
let currentResults = [];
let fullTextResult = '';
let currentSummary = '';

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const dropZonePrompt = document.getElementById('dropZonePrompt');
const fileSelectedView = document.getElementById('fileSelectedView');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSize = document.getElementById('selectedFileSize');
const removeFileBtn = document.getElementById('removeFileBtn');
const startOcrBtn = document.getElementById('startOcrBtn');

const modelSelect = document.getElementById('modelSelect');
const autoSummaryCheck = document.getElementById('autoSummaryCheck');
const summaryModelSelect = document.getElementById('summaryModelSelect');
const summaryModelWrapper = document.getElementById('summaryModelWrapper');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const progressSection = document.getElementById('progressSection');
const progressStageTitle = document.getElementById('progressStageTitle');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentage = document.getElementById('progressPercentage');
const progressBarFill = document.getElementById('progressBarFill');

// Métricas DOM
const metricsSection = document.getElementById('metricsSection');
const metricTotalTokens = document.getElementById('metricTotalTokens');
const metricPromptTokens = document.getElementById('metricPromptTokens');
const metricEvalTokens = document.getElementById('metricEvalTokens');
const metricTokensPerSec = document.getElementById('metricTokensPerSec');
const metricTotalDuration = document.getElementById('metricTotalDuration');
const metricDurationDetail = document.getElementById('metricDurationDetail');
const metricPagesCount = document.getElementById('metricPagesCount');
const metricAvgPerPage = document.getElementById('metricAvgPerPage');

const resultsSection = document.getElementById('resultsSection');
const summaryCard = document.getElementById('summaryCard');
const summaryContent = document.getElementById('summaryContent');
const copySummaryBtn = document.getElementById('copySummaryBtn');

const formattedContent = document.getElementById('formattedContent');
const rawTextarea = document.getElementById('rawTextarea');
const pagesViewContainer = document.getElementById('pagesViewContainer');
const tabPagesCount = document.getElementById('tabPagesCount');

const tabFormattedBtn = document.getElementById('tabFormattedBtn');
const tabRawBtn = document.getElementById('tabRawBtn');
const tabPagesBtn = document.getElementById('tabPagesBtn');
const copyBtn = document.getElementById('copyBtn');
const copyBtnText = document.getElementById('copyBtnText');
const downloadMdBtn = document.getElementById('downloadMdBtn');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');
const searchInput = document.getElementById('searchInput');

// Ocultar/mostrar selector de modelo de resumen según checkbox
if (autoSummaryCheck && summaryModelWrapper) {
  autoSummaryCheck.addEventListener('change', () => {
    if (autoSummaryCheck.checked) {
      summaryModelWrapper.classList.remove('hidden');
    } else {
      summaryModelWrapper.classList.add('hidden');
    }
  });
}

async function checkOllamaStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.connected) {
      statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
      statusText.textContent = `Ollama Conectado (${data.models.length} modelos)`;
      statusText.className = 'text-emerald-300 font-medium';

      modelSelect.innerHTML = '';
      summaryModelSelect.innerHTML = '<option value="">Mismo modelo OCR (Recomendado, rápido)</option>';

      data.models.forEach(model => {
        // Selector OCR
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        if (model.includes('deepseek-ocr')) {
          opt.selected = true;
          opt.textContent += ' (DeepSeek OCR)';
        } else if (model.includes('ocr')) {
          opt.textContent += ' (OCR)';
        }
        modelSelect.appendChild(opt);

        // Selector Resumen
        const optSummary = document.createElement('option');
        optSummary.value = model;
        optSummary.textContent = model;
        summaryModelSelect.appendChild(optSummary);
      });
    } else {
      statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
      statusText.textContent = 'Ollama desconectado';
      statusText.className = 'text-rose-400 font-medium';
    }
  } catch (err) {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    statusText.textContent = 'Desconectado';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = formatBytes(file.size);

  dropZonePrompt.classList.add('hidden');
  fileSelectedView.classList.remove('hidden');
  fileSelectedView.classList.add('flex');
  startOcrBtn.disabled = false;
  refreshIcons();
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  fileSelectedView.classList.add('hidden');
  fileSelectedView.classList.remove('flex');
  dropZonePrompt.classList.remove('hidden');
  startOcrBtn.disabled = true;
  metricsSection.classList.add('hidden');
  refreshIcons();
}

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-indigo-500', 'bg-slate-800/70');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-500', 'bg-slate-800/70');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-500', 'bg-slate-800/70');
  if (e.dataTransfer.files?.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files?.length) handleFile(e.target.files[0]);
});

removeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearFile();
});

function setActiveTab(tab) {
  const views = {
    formatted: { btn: tabFormattedBtn, container: document.getElementById('formattedViewContainer') },
    raw: { btn: tabRawBtn, container: document.getElementById('rawViewContainer') },
    pages: { btn: tabPagesBtn, container: document.getElementById('pagesViewContainer') }
  };

  Object.keys(views).forEach(k => {
    if (k === tab) {
      views[k].btn.classList.add('active', 'text-white');
      views[k].btn.classList.remove('text-slate-400');
      views[k].container.classList.remove('hidden');
    } else {
      views[k].btn.classList.remove('active', 'text-white');
      views[k].btn.classList.add('text-slate-400');
      views[k].container.classList.add('hidden');
    }
  });
}

tabFormattedBtn.addEventListener('click', () => setActiveTab('formatted'));
tabRawBtn.addEventListener('click', () => setActiveTab('raw'));
tabPagesBtn.addEventListener('click', () => setActiveTab('pages'));

// Iniciar OCR y Análisis
startOcrBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  startOcrBtn.disabled = true;
  progressSection.classList.remove('hidden');
  metricsSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  summaryCard.classList.add('hidden');
  progressBarFill.style.width = '0%';
  progressPercentage.textContent = '0%';
  progressStageTitle.textContent = 'Iniciando escaneo...';
  progressStatusText.textContent = 'Preparando documento...';

  currentResults = [];
  fullTextResult = '';
  currentSummary = '';
  pagesViewContainer.innerHTML = '';

  const format = document.querySelector('input[name="ocrFormat"]:checked')?.value || 'markdown';
  const model = modelSelect.value || 'deepseek-ocr:latest';
  const summaryModel = summaryModelSelect.value || model;
  const autoSummary = autoSummaryCheck.checked;

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('model', model);
  formData.append('summaryModel', summaryModel);
  formData.append('format', format);
  formData.append('autoSummary', autoSummary);

  try {
    const response = await fetch('/api/ocr-stream', { method: 'POST', body: formData });
    if (!response.ok) {
      throw new Error(`Error en el servidor (${response.status}): ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let eventType = 'message';
        let eventData = '';

        const eventMatch = line.match(/^event:\s*(.+)$/m);
        if (eventMatch) eventType = eventMatch[1].trim();

        const dataMatch = line.match(/^data:\s*(.+)$/m);
        if (dataMatch) {
          try { eventData = JSON.parse(dataMatch[1].trim()); } catch (e) { eventData = dataMatch[1].trim(); }
        }

        handleSseEvent(eventType, eventData);
      }
    }
  } catch (err) {
    progressStageTitle.textContent = 'Error durante el proceso';
    progressStatusText.textContent = err.message;
    startOcrBtn.disabled = false;
  }
});

function handleSseEvent(eventType, data) {
  if (eventType === 'init') {
    progressStageTitle.textContent = `Documento: ${data.filename}`;
    tabPagesCount.textContent = data.totalPages;
  } else if (eventType === 'progress') {
    if (data.status === 'summarizing') {
      progressBarFill.style.width = '95%';
      progressPercentage.textContent = '95%';
      progressStageTitle.textContent = '🧠 Analizando Documento con IA';
      progressStatusText.textContent = data.message;
    } else {
      const pct = Math.round(((data.page - 0.5) / data.totalPages) * 90);
      progressBarFill.style.width = `${pct}%`;
      progressPercentage.textContent = `${pct}%`;
      progressStageTitle.textContent = `Página ${data.page} de ${data.totalPages}`;
      progressStatusText.textContent = data.message;
    }
  } else if (eventType === 'page_result') {
    currentResults.push(data);
    addPageCardToView(data);
  } else if (eventType === 'summary') {
    currentSummary = data.summary;
    renderSummary(data.summary);
  } else if (eventType === 'complete') {
    progressBarFill.style.width = '100%';
    progressPercentage.textContent = '100%';
    progressStageTitle.textContent = '¡Escaneo y análisis completados!';
    progressStatusText.textContent = `Procesadas ${data.totalPages} página(s)`;

    fullTextResult = data.fullText;
    displayResults(data.fullText);

    if (data.summary) {
      currentSummary = data.summary;
      renderSummary(data.summary);
    }

    if (data.metrics) {
      renderMetrics(data.metrics, data.totalPages);
    }

    resultsSection.classList.remove('hidden');
    startOcrBtn.disabled = false;
    refreshIcons();
  } else if (eventType === 'error') {
    progressStageTitle.textContent = 'Aviso';
    progressStatusText.textContent = data.message;
    startOcrBtn.disabled = false;
  }
}

// Renderizar métricas de rendimiento y tokens
function renderMetrics(metrics, totalPages) {
  metricTotalTokens.textContent = Number(metrics.totalTokens || 0).toLocaleString();
  metricPromptTokens.textContent = Number(metrics.promptTokens || 0).toLocaleString();
  metricEvalTokens.textContent = Number(metrics.evalTokens || 0).toLocaleString();

  metricTokensPerSec.textContent = Number(metrics.tokensPerSecond || 0).toFixed(1);
  metricTotalDuration.textContent = metrics.totalDurationSec || '0.00';
  metricDurationDetail.textContent = `${metrics.totalDurationSec || '0.00'}s total (${metrics.evalDurationSec || '0.0'}s gen)`;

  metricPagesCount.textContent = totalPages || 1;
  const avgSec = totalPages > 0 ? (parseFloat(metrics.totalDurationSec || 0) / totalPages).toFixed(2) : '0.00';
  metricAvgPerPage.textContent = `${avgSec}s / pág`;

  metricsSection.classList.remove('hidden');
  refreshIcons();
}

function renderSummary(summaryMd) {
  if (!summaryMd) return;
  summaryCard.classList.remove('hidden');
  if (window.marked && window.DOMPurify) {
    summaryContent.innerHTML = DOMPurify.sanitize(marked.parse(summaryMd));
  } else {
    summaryContent.innerText = summaryMd;
  }
  refreshIcons();
}

function displayResults(text) {
  if (window.marked && window.DOMPurify) {
    formattedContent.innerHTML = DOMPurify.sanitize(marked.parse(text));
  } else {
    formattedContent.innerText = text;
  }
  rawTextarea.value = text;
  setActiveTab('formatted');
}

function addPageCardToView(pageData) {
  const card = document.createElement('div');
  card.className = 'bg-slate-800/40 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row gap-6';

  const previewCol = pageData.previewUrl ? `
    <div class="md:w-1/3 flex-shrink-0 flex flex-col gap-2">
      <span class="text-xs font-semibold text-slate-400 uppercase">Página ${pageData.pageNumber}</span>
      <div class="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 p-1">
        <img src="${pageData.previewUrl}" alt="Pág ${pageData.pageNumber}" class="w-full h-auto rounded object-contain max-h-96">
      </div>
    </div>
  ` : '';

  const parsedHtml = window.marked && window.DOMPurify 
    ? DOMPurify.sanitize(marked.parse(pageData.text))
    : `<pre class="text-xs font-mono">${pageData.text}</pre>`;

  card.innerHTML = `
    ${previewCol}
    <div class="flex-1 flex flex-col gap-3 min-w-0">
      <h4 class="text-sm font-bold text-slate-200 pb-2 border-b border-slate-700/60">Página ${pageData.pageNumber}</h4>
      <div class="prose prose-invert prose-indigo text-xs max-w-none overflow-x-auto">${parsedHtml}</div>
    </div>
  `;
  pagesViewContainer.appendChild(card);
}

copySummaryBtn.addEventListener('click', () => {
  if (!currentSummary) return;
  navigator.clipboard.writeText(currentSummary).then(() => {
    copySummaryBtn.querySelector('span').textContent = '¡Copiado!';
    setTimeout(() => { copySummaryBtn.querySelector('span').textContent = 'Copiar Análisis'; }, 2000);
  });
});

copyBtn.addEventListener('click', () => {
  if (!fullTextResult) return;
  const contentToCopy = currentSummary ? `# ANÁLISIS DEL DOCUMENTO\n\n${currentSummary}\n\n---\n\n# TEXTO COMPLETO EXTRAÍDO\n\n${fullTextResult}` : fullTextResult;
  navigator.clipboard.writeText(contentToCopy).then(() => {
    copyBtnText.textContent = '¡Copiado!';
    setTimeout(() => { copyBtnText.textContent = 'Copiar Todo'; }, 2000);
  });
});

downloadMdBtn.addEventListener('click', () => {
  if (!fullTextResult) return;
  const filename = (selectedFile?.name?.replace(/\.[^/.]+$/, "") || 'ocr_resultado') + '.md';
  const fullDocument = currentSummary ? `# Análisis del Documento\n\n${currentSummary}\n\n---\n\n# Texto Extraído por OCR\n\n${fullTextResult}` : fullTextResult;
  downloadBlob(fullDocument, filename, 'text/markdown');
});

downloadTxtBtn.addEventListener('click', () => {
  if (!fullTextResult) return;
  const filename = (selectedFile?.name?.replace(/\.[^/.]+$/, "") || 'ocr_resultado') + '.txt';
  downloadBlob(fullTextResult, filename, 'text/plain');
});

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) { displayResults(fullTextResult); return; }
  const regex = new RegExp(`(${query})`, 'gi');
  const highlighted = fullTextResult.replace(regex, '<mark class="bg-amber-400/30 text-amber-200 rounded px-0.5">$1</mark>');
  if (window.marked && window.DOMPurify) formattedContent.innerHTML = DOMPurify.sanitize(marked.parse(highlighted));
});

document.addEventListener('DOMContentLoaded', () => {
  refreshIcons();
  checkOllamaStatus();
});
