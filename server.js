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

// Limpiar prompt o prefijos no deseados del modelo
function cleanOcrResponse(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^Do not generate or write[\s\S]*?content of the document\.\s*/i, '');
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

  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'deepseek-ocr:latest',
      prompt: prompt,
      images: [base64Image],
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error de Ollama (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return cleanOcrResponse(data.response || '');
}

// 🧠 Generar Descripción y Resumen con IA
async function generateDocumentSummary(fullText, modelName) {
  if (!fullText || !fullText.trim()) {
    return 'No se pudo extraer texto suficiente para generar un análisis.';
  }

  let selectedModel = modelName;
  if (!selectedModel) {
    try {
      const tagRes = await fetch(`${OLLAMA_HOST}/api/tags`);
      if (tagRes.ok) {
        const tagData = await tagRes.json();
        const available = (tagData.models || []).map(m => m.name);
        const textModel = available.find(m => 
          !m.includes('ocr') && (m.includes('gpt') || m.includes('llama') || m.includes('mistral') || m.includes('deepseek') || m.includes('qwen'))
        );
        selectedModel = textModel || available[0] || 'deepseek-ocr:latest';
      }
    } catch (e) {
      selectedModel = 'deepseek-ocr:latest';
    }
  }

  const prompt = `Eres un asistente experto en análisis documental. A continuación se encuentra el texto extraído mediante OCR de un documento:

--- INICIO DEL DOCUMENTO ---
${fullText.slice(0, 15000)}
--- FIN DEL DOCUMENTO ---

Por favor, realiza un análisis estructurado en formato Markdown en español con las siguientes secciones exactas:

### 📌 Tipo y Descripción del Documento
- **Tipo de documento**: (ej. Factura, Contrato, Recibo, Reporte Técnico, Artículo Académico, Carta Formal, etc.)
- **Descripción general**: Explicación clara de 2 a 3 líneas sobre qué es este documento, su propósito principal y las partes o entidades involucradas (emisor/receptor).

### 📋 Resumen Ejecutivo
- Resumen conciso y claro de los temas principales, acuerdos o información central del documento.

### 🔍 Datos y Puntos Clave
- Fechas importantes o plazos
- Cifras, montos monetarios o valores numéricos relevantes
- Nombres propios, empresas u organizaciones
- Decisiones, obligaciones o conclusiones clave

Responde directamente con este análisis estructurado en Markdown claro y profesional.`;

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        prompt: prompt,
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return `No se pudo generar el resumen automáticamente: ${err}`;
    }

    const data = await response.json();
    let summaryText = data.response || '';
    summaryText = summaryText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return summaryText;
  } catch (error) {
    console.error('Error generando resumen:', error);
    return `Error al conectar con el modelo para generar el resumen: ${error.message}`;
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
    const models = (data.models || []).map(m => m.name);
    const ocrModel = models.find(m => m.includes('deepseek-ocr')) || models[0] || 'deepseek-ocr:latest';
    const textModel = models.find(m => !m.includes('ocr')) || ocrModel;

    return res.json({
      connected: true,
      ollamaHost: OLLAMA_HOST,
      models,
      defaultOcrModel: ocrModel,
      defaultSummaryModel: textModel
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
  const summaryModel = req.body.summaryModel || '';
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
          message: `Ejecutando DeepSeek OCR en página ${pageNum} de ${totalPages}...`,
          previewUrl: rendered.dataUrl
        });

        const pageText = await runOcrOnImage({
          base64Image: rendered.base64,
          model,
          promptMode: format,
          customPrompt
        });

        const pageResult = {
          pageNumber: pageNum,
          text: pageText,
          previewUrl: rendered.dataUrl
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
        message: 'Ejecutando DeepSeek OCR en la imagen...',
        previewUrl: dataUrl
      });

      const text = await runOcrOnImage({
        base64Image: base64,
        model,
        promptMode: format,
        customPrompt
      });

      const pageResult = {
        pageNumber: 1,
        text,
        previewUrl: dataUrl
      };
      results.push(pageResult);
      fullText = text;

      sendEvent('page_result', pageResult);
    } else {
      sendEvent('error', { message: 'Formato de archivo no soportado. Sube un archivo PDF o imagen.' });
      return;
    }

    // 🧠 Paso de Resumen y Descripción Inteligente
    let summary = '';
    if (autoSummary && fullText.trim()) {
      sendEvent('progress', {
        page: totalPages,
        totalPages,
        status: 'summarizing',
        message: 'Generando descripción y resumen inteligente con IA...'
      });

      summary = await generateDocumentSummary(fullText, summaryModel);
      sendEvent('summary', { summary });
    }

    sendEvent('complete', {
      totalPages,
      results,
      fullText,
      summary
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
  const summaryModel = req.body.summaryModel || '';
  const format = req.body.format || 'markdown';
  const customPrompt = req.body.customPrompt || '';
  const scale = parseFloat(req.body.scale) || 2.0;
  const autoSummary = req.body.autoSummary !== 'false';
  const mimeType = req.file.mimetype;

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
        const text = await runOcrOnImage({ base64Image: rendered.base64, model, promptMode: format, customPrompt });
        pages.push({ pageNumber: pageNum, text });
      }

      fullText = pages.map(p => `--- Página ${p.pageNumber} ---\n\n${p.text}`).join('\n\n');
    } else if (mimeType.startsWith('image/')) {
      const base64 = req.file.buffer.toString('base64');
      const text = await runOcrOnImage({ base64Image: base64, model, promptMode: format, customPrompt });
      pages.push({ pageNumber: 1, text });
      fullText = text;
    }

    let summary = '';
    if (autoSummary && fullText.trim()) {
      summary = await generateDocumentSummary(fullText, summaryModel);
    }

    return res.json({ success: true, filename: req.file.originalname, totalPages, pages, fullText, summary });
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
