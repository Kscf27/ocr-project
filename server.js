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

// Limpiar prefijos del modelo
function cleanOcrResponse(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^Do not (?:generate|write|include)[\s\S]*?document\.\s*/i, '');
  return cleaned.trim();
}

// Ejecutar OCR con Ollama
async function runOcrOnImage({ base64Image, model = 'deepseek-ocr:latest', promptMode = 'markdown', customPrompt }) {
  let prompt = '<image>\nConvert the image of this medical disability / sick leave certificate to markdown text. Output only the extracted document text.';
  if (customPrompt && customPrompt.trim()) {
    prompt = `<image>\n${customPrompt.trim()}`;
  } else if (promptMode === 'text') {
    prompt = '<image>\nExtract all readable text from this medical certificate image in plain text format without markdown markup.';
  } else if (promptMode === 'table') {
    prompt = '<image>\nExtract all structured tables, forms, and clinical data from this medical certificate image in markdown format.';
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
        stream: false,
        think: false // Evita que modelos de visión con thinking devuelvan respuesta vacía
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error de Ollama (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - startTime;
    let ocrText = (data.response || data.message?.content || data.thinking || '').trim();

    return {
      text: cleanOcrResponse(ocrText),
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

// 📋 Esquema canónico conciso para datos estructurados de incapacidad médica (campos nulos si no existen)
function getDefaultDisabilitySchema() {
  return {
    paciente: null,
    identificacion: null,
    entidad_salud: null,
    medico: null,
    dias_incapacidad: null,
    fecha_inicio: null,
    fecha_fin: null,
    codigo_cie10: null,
    diagnostico: null,
    tipo_contingencia: null,
    observaciones: null
  };
}

// Normaliza el objeto JSON asegurando que todo campo ausente quede estrictamente en null
function normalizeDisabilityData(raw) {
  const defaults = getDefaultDisabilitySchema();
  if (!raw || typeof raw !== 'object') return defaults;

  const normalizeVal = (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const lower = trimmed.toLowerCase();
      if (['null', 'undefined', 'no especificado', 'no disponible', 'no reporta', 'n/a', 'desconocido', 'ninguno', 'none'].includes(lower)) {
        return null;
      }
      return trimmed;
    }
    return val;
  };

  const result = {};
  for (const key of Object.keys(defaults)) {
    const val = raw[key];
    if (key === 'dias_incapacidad' && val !== null && val !== undefined) {
      const num = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
      result[key] = !isNaN(num) ? num : normalizeVal(val);
    } else {
      result[key] = normalizeVal(val);
    }
  }
  return result;
}

// Generar Markdown de auditoría a partir de los datos estructurados en caso de fallback
function generateMarkdownFromDisabilityData(data) {
  return `### 🏥 Resumen de Incapacidad Médica
- **Paciente**: ${data.paciente || 'No especificado'}
- **Identificación**: ${data.identificacion || 'No especificado'}
- **Entidad de Salud**: ${data.entidad_salud || 'No especificada'}
- **Médico Tratante**: ${data.medico || 'No especificado'}
- **Días Otorgados**: ${data.dias_incapacidad !== null ? `${data.dias_incapacidad} día(s)` : 'No especificado'}
- **Período**: ${data.fecha_inicio || 'No especificada'} al ${data.fecha_fin || 'No especificada'}
- **Diagnóstico (CIE-10)**: ${data.codigo_cie10 ? `[${data.codigo_cie10}] ` : ''}${data.diagnostico || 'No especificado'}
- **Contingencia**: ${data.tipo_contingencia || 'Enfermedad General'}
- **Observaciones**: ${data.observaciones || 'Sin observaciones adicionales registradas.'}`;
}

// 🩺 Generar Auditoría y Resumen Clínico de Incapacidad con IA
async function generateDocumentSummary(fullText, modelName = 'gemma4:e4b') {
  if (!fullText || !fullText.trim()) {
    return {
      summary: 'No se pudo extraer texto suficiente del certificado para generar un análisis.',
      jsonData: getDefaultDisabilitySchema(),
      metrics: null
    };
  }

  const targetModel = modelName || 'gemma4:e4b';
  const cleanInput = cleanOcrResponse(fullText).slice(0, 8000);
  const sampleSchema = getDefaultDisabilitySchema();

  const prompt = `Eres un asistente experto en auditoría médica y talento humano.
A continuación se encuentra el texto extraído mediante OCR de un certificado de incapacidad médica:

--- DOCUMENTO DE INCAPACIDAD ---
${cleanInput}
--- FIN DOCUMENTO ---

Instrucciones:
1. Extrae los datos clínicos y laborales esenciales de la incapacidad.
2. Si algún dato NO aparece en el texto, su valor DEBE ser estrictamente null.
3. Devuelve ÚNICAMENTE un objeto JSON válido con estas dos claves:
{
  "resumen_markdown": "Resumen conciso en Markdown (con emojis) con los datos clave: Paciente, Entidad, Días, Fechas, CIE-10 y Observaciones.",
  "datos_incapacidad": ${JSON.stringify(sampleSchema, null, 2)}
}

Responde exclusivamente con el JSON válido.`;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: targetModel,
        prompt: prompt,
        stream: false,
        format: 'json',
        think: false, // Evita que modelos como gemma4 consuman tokens en el canal oculto de pensamiento
        options: {
          temperature: 0.1,
          num_predict: 2500
        }
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      return { 
        summary: `### 🏥 Auditoría de Incapacidad\n*No se pudo generar el análisis con el modelo '${targetModel}' (${response.status}): ${err}*`,
        jsonData: getDefaultDisabilitySchema(),
        metrics: null 
      };
    }

    const data = await response.json();
    const durationMs = Date.now() - startTime;

    // Obtener texto generado (manejando response, thinking o message.content según versión de Ollama)
    let rawText = (data.response || data.message?.content || data.thinking || '').trim();
    rawText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    let parsedJson = null;
    let summaryMarkdown = '';
    let normalizedData = getDefaultDisabilitySchema();

    if (rawText) {
      // Intentar parsear JSON directo
      try {
        parsedJson = JSON.parse(rawText);
      } catch (e) {
        // Intentar extraer bloque JSON si vino envuelto en ```json ... ```
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedJson = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.warn('No se pudo parsear bloque JSON extraído:', e2.message);
          }
        }
      }
    }

    if (parsedJson) {
      if (parsedJson.datos_incapacidad) {
        normalizedData = normalizeDisabilityData(parsedJson.datos_incapacidad);
      } else if (parsedJson.paciente || parsedJson.tipo_documento || parsedJson.incapacidad) {
        normalizedData = normalizeDisabilityData(parsedJson);
      }

      if (parsedJson.resumen_markdown && typeof parsedJson.resumen_markdown === 'string' && parsedJson.resumen_markdown.trim().length > 30) {
        summaryMarkdown = parsedJson.resumen_markdown.trim();
      } else {
        summaryMarkdown = generateMarkdownFromDisabilityData(normalizedData);
      }
    } else {
      // Si el modelo devolvió texto plano o markdown
      summaryMarkdown = rawText || 'Análisis de incapacidad completado.';
      normalizedData = getDefaultDisabilitySchema();
    }

    return {
      summary: summaryMarkdown,
      jsonData: normalizedData,
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
    console.error('Error en generación de resumen de incapacidad:', error);
    const isTimeout = error.name === 'AbortError';
    return {
      summary: `### 🏥 Auditoría de Incapacidad\n${isTimeout ? `*El modelo '${targetModel}' tardó más de 90 segundos en responder.*` : `*Error con el modelo '${targetModel}': ${error.message}*`}`,
      jsonData: getDefaultDisabilitySchema(),
      metrics: null
    };
  }
}

// Endpoint de estado y modelos clasificados
app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      return res.status(502).json({ connected: false, error: 'Ollama no responde' });
    }
    const data = await response.json();
    const allModels = data.models || [];
    
    // Modelos con capacidad de visión para OCR
    const visionModels = allModels.filter(m => {
      const name = m.name.toLowerCase();
      const caps = m.capabilities || [];
      return caps.includes('vision') || name.includes('ocr');
    }).map(m => m.name);

    const summaryModels = allModels.map(m => m.name);

    const defaultOcr = visionModels.find(m => m.includes('deepseek-ocr')) || visionModels[0] || 'deepseek-ocr:latest';
    const defaultSummary = summaryModels.find(m => m.includes('gemma4:e4b')) || summaryModels.find(m => m.includes('gemma') || m.includes('llama')) || defaultOcr;

    return res.json({
      connected: true,
      ollamaHost: OLLAMA_HOST,
      visionModels: visionModels.length > 0 ? visionModels : ['deepseek-ocr:latest', 'glm-ocr:latest'],
      summaryModels,
      defaultOcrModel: defaultOcr,
      defaultSummaryModel: defaultSummary
    });
  } catch (err) {
    return res.status(503).json({ connected: false, error: 'No se pudo conectar a Ollama' });
  }
});

// Endpoint SSE para streaming del OCR y resumen
app.post('/api/ocr-stream', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ningún archivo' });
  }

  const model = req.body.model || 'deepseek-ocr:latest';
  const summaryModel = req.body.summaryModel || 'gemma4:e4b';
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
      sendEvent('status', { message: 'Cargando y analizando certificado de incapacidad en PDF...', stage: 'loading' });
      
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
          message: `Escaneando texto médico (${model}) en página ${pageNum} de ${totalPages}...`,
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
        message: `Escaneando certificado médico con (${model})...`,
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
      sendEvent('error', { message: 'Formato de archivo no soportado. Sube un PDF o imagen médica.' });
      return;
    }

    // 🩺 Generación de Auditoría y Resumen con JSON estructurado
    let summary = '';
    let jsonData = getDefaultDisabilitySchema();
    if (autoSummary && fullText.trim()) {
      sendEvent('progress', {
        page: totalPages,
        totalPages,
        status: 'summarizing',
        message: `Auditando incapacidad y extrayendo datos con '${summaryModel}'...`
      });

      try {
        const summaryRes = await generateDocumentSummary(fullText, summaryModel);
        summary = summaryRes.summary;
        jsonData = summaryRes.jsonData || getDefaultDisabilitySchema();

        if (summaryRes.metrics) {
          totalPromptTokens += summaryRes.metrics.promptTokens;
          totalEvalTokens += summaryRes.metrics.evalTokens;
          totalEvalDurationNs += summaryRes.metrics.evalDurationNs;
        }

        sendEvent('summary', { summary, jsonData, metrics: summaryRes.metrics });
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

    sendEvent('complete', {
      totalPages,
      results,
      fullText,
      summary,
      jsonData,
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
  const summaryModel = req.body.summaryModel || 'gemma4:e4b';
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
    let jsonData = getDefaultDisabilitySchema();
    if (autoSummary && fullText.trim()) {
      const summaryRes = await generateDocumentSummary(fullText, summaryModel);
      summary = summaryRes.summary;
      jsonData = summaryRes.jsonData || getDefaultDisabilitySchema();
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
      jsonData,
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
  console.log(`=======================================================`);
  console.log(` Escáner de Incapacidades Médicas con IA Local`);
  console.log(` Servidor web iniciado en: http://localhost:${PORT}`);
  console.log(` Conectado a Ollama en: ${OLLAMA_HOST}`);
  console.log(`=======================================================`);
});
