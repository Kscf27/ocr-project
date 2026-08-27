import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer en memoria (hasta 100MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Canvas Factory para PDF.js en Node
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.floor(width), Math.floor(height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.floor(width);
    canvasAndContext.canvas.height = Math.floor(height);
    canvasAndContext.context.fillStyle = '#ffffff';
    canvasAndContext.context.fillRect(0, 0, width, height);
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// Renderizar una página de PDF a imagen Base64 con fondo blanco
async function renderPdfPageToImage(pdfDoc, pageNum, scale = 2.0) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

  const renderContext = {
    canvasContext: canvasAndContext.context,
    viewport: viewport,
    canvasFactory: canvasFactory,
    background: 'white'
  };

  await page.render(renderContext).promise;
  const imageBuffer = canvasAndContext.canvas.toBuffer('image/png');
  const base64 = imageBuffer.toString('base64');
  return {
    pageNumber: pageNum,
    width: Math.floor(viewport.width),
    height: Math.floor(viewport.height),
    base64,
    dataUrl: `data:image/png;base64,${base64}`
  };
}

// Limpiar prompt o prefijos del modelo
function cleanOcrResponse(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^Do not (?:generate|write|include)[\s\S]*?document\.\s*/i, '');
  return cleaned.trim();
}

// Ejecutar OCR con Ollama
async function runOcrOnImage({ base64Image, model = 'deepseek-ocr:latest', promptMode = 'markdown', customPrompt }) {
  let prompt = '<image>\nConvert the image to markdown text. Output only the extracted document text.';
  if (customPrompt && customPrompt.trim()) {
    prompt = `<image>\n${customPrompt.trim()}`;
  } else if (promptMode === 'text') {
    prompt = '<image>\nExtract all readable text from this document image in plain text format without markdown markup.';
  } else if (promptMode === 'table') {
    prompt = '<image>\nExtract all structured tables, forms, and data from this document image in markdown format.';
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || 'deepseek-ocr:latest',
        prompt: prompt,
        images: [base64Image],
        stream: false
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error de Ollama (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - startTime;

    return {
      text: cleanOcrResponse(data.response || ''),
      metrics: {
        promptTokens: data.prompt_eval_count || 0,
        evalTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        totalDurationNs: data.total_duration || (durationMs * 1e6),
        evalDurationNs: data.eval_duration || 0,
        durationMs
      }
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Limpiar repeticiones en caso de bucle de modelo
function cleanSummaryText(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const uniqueLines = [];
  const seen = new Set();
  let repeatCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 3 && seen.has(trimmed)) {
      repeatCount++;
      if (repeatCount > 3) continue; // Cortar repeticiones infinitas
    } else {
      if (trimmed.length > 3) seen.add(trimmed);
      repeatCount = 0;
    }
    uniqueLines.push(line);
  }

  return uniqueLines.join('\n').trim();
}

// 🧠 Generar Descripción y Resumen con IA (Ultra-rápido, num_predict acotado)
async function generateDocumentSummary(fullText, modelName = 'deepseek-ocr:latest') {
  if (!fullText || !fullText.trim()) {
    return { summary: 'No se pudo extraer texto suficiente para generar un análisis.', metrics: null };
  }

  const targetModel = modelName || 'deepseek-ocr:latest';
  const cleanInput = cleanOcrResponse(fullText).slice(0, 3000);

  const prompt = `Analiza este documento y describe brevemente:
1. Tipo de documento
2. Resumen en 2 lineas
3. Datos clave

Texto:
${cleanInput}`;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s max

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: targetModel,
        prompt: prompt,
        stream: false,
        options: {
          num_predict: 250, // Límite estricto para evitar loops
          temperature: 0.2,
          top_p: 0.9
        }
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { 
        summary: `### 📌 Análisis del Documento\n*Documento procesado correctamente. Resumen omitido.*`, 
        metrics: null 
      };
    }

    const data = await response.json();
    const durationMs = Date.now() - startTime;
    let summaryText = cleanSummaryText(data.response || '');

    return {
      summary: summaryText || 'Documento procesado exitosamente.',
      metrics: {
        promptTokens: data.prompt_eval_count || 0,
        evalTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        totalDurationNs: data.total_duration || (durationMs * 1e6),
        evalDurationNs: data.eval_duration || 0,
        durationMs
      }
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('Timeout o error en resumen (continuando flujo normal):', error.message);
    return {
      summary: `### 📌 Análisis del Documento\n*Documento procesado con éxito.*`,
      metrics: null
    };
  }
}

// Endpoint de estado y modelos
app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      return res.status(502).json({ connected: false, error: 'Ollama no responde' });
    }
    const data = await response.json();
    const allModels = (data.models || []).map(m => m.name);
    const ocrModel = allModels.find(m => m.includes('deepseek-ocr')) || allModels.find(m => m.includes('ocr')) || allModels[0] || 'deepseek-ocr:latest';

    return res.json({
      connected: true,
      ollamaHost: OLLAMA_HOST,
      models: allModels,
      defaultOcrModel: ocrModel,
      defaultSummaryModel: ocrModel
    });
  } catch (err) {
    return res.status(503).json({ connected: false, error: 'No se pudo conectar a Ollama' });
  }
});

// Endpoint SSE para streaming del OCR, resumen y cálculo de métricas
app.post('/api/ocr-stream', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ningún archivo' });
  }

  const model = req.body.model || 'deepseek-ocr:latest';
  const summaryModel = req.body.summaryModel || model;
  const format = req.body.format || 'markdown';
  const customPrompt = req.body.customPrompt || '';
  const scale = parseFloat(req.body.scale) || 2.0;
  const autoSummary = req.body.autoSummary !== 'false';
  const mimeType = req.file.mimetype;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const processStartTime = Date.now();
  let totalPromptTokens = 0;
  let totalEvalTokens = 0;
  let totalEvalDurationNs = 0;

  try {
    let fullText = '';
    const results = [];
    let totalPages = 1;

    if (mimeType === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      sendEvent('status', { message: 'Cargando y analizando PDF...', stage: 'loading' });
      
      const uint8Array = new Uint8Array(req.file.buffer);
      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        disableFontFace: true
      });
      const pdfDoc = await loadingTask.promise;
      totalPages = pdfDoc.numPages;

      sendEvent('init', {
        filename: req.file.originalname,
        totalPages,
        filesize: req.file.size
      });

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        sendEvent('progress', {
          page: pageNum,
          totalPages,
          status: 'rendering',
          message: `Renderizando página ${pageNum} de ${totalPages}...`
        });

        const rendered = await renderPdfPageToImage(pdfDoc, pageNum, scale);

        sendEvent('progress', {
          page: pageNum,
          totalPages,
          status: 'ocr',
          message: `Ejecutando OCR (${model}) en página ${pageNum} de ${totalPages}...`,
          previewUrl: rendered.dataUrl
        });

        const ocrResult = await runOcrOnImage({
          base64Image: rendered.base64,
          model,
          promptMode: format,
          customPrompt
        });

        if (ocrResult.metrics) {
          totalPromptTokens += ocrResult.metrics.promptTokens;
          totalEvalTokens += ocrResult.metrics.evalTokens;
          totalEvalDurationNs += ocrResult.metrics.evalDurationNs;
        }

        const pageResult = {
          pageNumber: pageNum,
          text: ocrResult.text,
          previewUrl: rendered.dataUrl,
          metrics: ocrResult.metrics
        };
        results.push(pageResult);

        sendEvent('page_result', pageResult);
      }

      fullText = results.map(r => `--- Página ${r.pageNumber} ---\n\n${r.text}`).join('\n\n');
    } else if (mimeType.startsWith('image/')) {
      sendEvent('init', {
        filename: req.file.originalname,
        totalPages: 1,
        filesize: req.file.size
      });

      const base64 = req.file.buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      sendEvent('progress', {
        page: 1,
        totalPages: 1,
        status: 'ocr',
        message: `Ejecutando OCR (${model}) en la imagen...`,
        previewUrl: dataUrl
      });

      const ocrResult = await runOcrOnImage({
        base64Image: base64,
        model,
        promptMode: format,
        customPrompt
      });

      if (ocrResult.metrics) {
        totalPromptTokens += ocrResult.metrics.promptTokens;
        totalEvalTokens += ocrResult.metrics.evalTokens;
        totalEvalDurationNs += ocrResult.metrics.evalDurationNs;
      }

      const pageResult = {
        pageNumber: 1,
        text: ocrResult.text,
        previewUrl: dataUrl,
        metrics: ocrResult.metrics
      };
      results.push(pageResult);
      fullText = ocrResult.text;

      sendEvent('page_result', pageResult);
    } else {
      sendEvent('error', { message: 'Formato de archivo no soportado. Sube un archivo PDF o imagen.' });
      return;
    }

    // 🧠 Paso de Resumen y Descripción Inteligente protegido
    let summary = '';
    if (autoSummary && fullText.trim()) {
      sendEvent('progress', {
        page: totalPages,
        totalPages,
        status: 'summarizing',
        message: `Generando descripción y resumen inteligente...`
      });

      try {
        const summaryRes = await generateDocumentSummary(fullText, summaryModel);
        summary = summaryRes.summary;

        if (summaryRes.metrics) {
          totalPromptTokens += summaryRes.metrics.promptTokens;
          totalEvalTokens += summaryRes.metrics.evalTokens;
          totalEvalDurationNs += summaryRes.metrics.evalDurationNs;
        }

        sendEvent('summary', { summary, metrics: summaryRes.metrics });
      } catch (err) {
        console.error('Error no fatal en resumen:', err);
      }
    }

    const totalElapsedTimeMs = Date.now() - processStartTime;
    const evalDurationSec = totalEvalDurationNs > 0 ? (totalEvalDurationNs / 1e9) : (totalElapsedTimeMs / 1000);
    const tokensPerSec = evalDurationSec > 0 ? (totalEvalTokens / evalDurationSec).toFixed(1) : '0.0';

    const globalMetrics = {
      promptTokens: totalPromptTokens,
      evalTokens: totalEvalTokens,
      totalTokens: totalPromptTokens + totalEvalTokens,
      totalDurationMs: totalElapsedTimeMs,
      totalDurationSec: (totalElapsedTimeMs / 1000).toFixed(2),
      evalDurationSec: evalDurationSec.toFixed(2),
      tokensPerSecond: parseFloat(tokensPerSec),
      pagesProcessed: totalPages
    };

    // Garantizar que SIEMPRE se emite complete
    sendEvent('complete', {
      totalPages,
      results,
      fullText,
      summary,
      metrics: globalMetrics
    });

  } catch (error) {
    console.error('Error durante OCR:', error);
    sendEvent('error', { message: error.message || 'Error inesperado durante el procesamiento' });
  } finally {
    res.end();
  }
});

// Endpoint estándar POST
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  const model = req.body.model || 'deepseek-ocr:latest';
  const summaryModel = req.body.summaryModel || model;
  const format = req.body.format || 'markdown';
  const customPrompt = req.body.customPrompt || '';
  const scale = parseFloat(req.body.scale) || 2.0;
  const autoSummary = req.body.autoSummary !== 'false';
  const mimeType = req.file.mimetype;

  const processStartTime = Date.now();
  let totalPromptTokens = 0;
  let totalEvalTokens = 0;
  let totalEvalDurationNs = 0;

  try {
    let fullText = '';
    let pages = [];
    let totalPages = 1;

    if (mimeType === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      const uint8Array = new Uint8Array(req.file.buffer);
      const loadingTask = pdfjsLib.getDocument({ data: uint8Array, useSystemFonts: true, disableFontFace: true });
      const pdfDoc = await loadingTask.promise;
      totalPages = pdfDoc.numPages;

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const rendered = await renderPdfPageToImage(pdfDoc, pageNum, scale);
        const ocrResult = await runOcrOnImage({ base64Image: rendered.base64, model, promptMode: format, customPrompt });
        
        if (ocrResult.metrics) {
          totalPromptTokens += ocrResult.metrics.promptTokens;
          totalEvalTokens += ocrResult.metrics.evalTokens;
          totalEvalDurationNs += ocrResult.metrics.evalDurationNs;
        }

        pages.push({ pageNumber: pageNum, text: ocrResult.text });
      }

      fullText = pages.map(p => `--- Página ${p.pageNumber} ---\n\n${p.text}`).join('\n\n');
    } else if (mimeType.startsWith('image/')) {
      const base64 = req.file.buffer.toString('base64');
      const ocrResult = await runOcrOnImage({ base64Image: base64, model, promptMode: format, customPrompt });
      
      if (ocrResult.metrics) {
        totalPromptTokens += ocrResult.metrics.promptTokens;
        totalEvalTokens += ocrResult.metrics.evalTokens;
        totalEvalDurationNs += ocrResult.metrics.evalDurationNs;
      }

      pages.push({ pageNumber: 1, text: ocrResult.text });
      fullText = ocrResult.text;
    }

    let summary = '';
    if (autoSummary && fullText.trim()) {
      const summaryRes = await generateDocumentSummary(fullText, summaryModel);
      summary = summaryRes.summary;
      if (summaryRes.metrics) {
        totalPromptTokens += summaryRes.metrics.promptTokens;
        totalEvalTokens += summaryRes.metrics.evalTokens;
        totalEvalDurationNs += summaryRes.metrics.evalDurationNs;
      }
    }

    const totalElapsedTimeMs = Date.now() - processStartTime;
    const evalDurationSec = totalEvalDurationNs > 0 ? (totalEvalDurationNs / 1e9) : (totalElapsedTimeMs / 1000);
    const tokensPerSec = evalDurationSec > 0 ? (totalEvalTokens / evalDurationSec).toFixed(1) : '0.0';

    return res.json({
      success: true,
      filename: req.file.originalname,
      totalPages,
      pages,
      fullText,
      summary,
      metrics: {
        promptTokens: totalPromptTokens,
        evalTokens: totalEvalTokens,
        totalTokens: totalPromptTokens + totalEvalTokens,
        totalDurationMs: totalElapsedTimeMs,
        totalDurationSec: (totalElapsedTimeMs / 1000).toFixed(2),
        tokensPerSecond: parseFloat(tokensPerSec)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` Servidor OCR iniciado en: http://localhost:${PORT}`);
  console.log(` Conectado a Ollama en: ${OLLAMA_HOST}`);
  console.log(`=========================================`);
});
