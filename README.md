# 📄 DeepSeek OCR Studio

Aplicación web local de alto rendimiento para el **reconocimiento óptico de caracteres (OCR)**, extracción de texto estructurado y **análisis/resumen inteligente de documentos** (PDFs e imágenes) impulsado por **Ollama** y el modelo **DeepSeek OCR**.

---

## 🌟 Características Principales

- 📑 **Procesamiento de PDFs Multi-Página:** Carga de documentos de hasta 100 MB. Cada página se rasteriza a alta resolución en el servidor mediante `@napi-rs/canvas` y `pdfjs-dist`.
- 🖼️ **Soporte para Imágenes:** Procesamiento directo de archivos individuales (`.png`, `.jpg`, `.jpeg`, `.webp`).
- ⚡ **Progreso en Tiempo Real con SSE (Server-Sent Events):** Visualización en vivo del estado de renderizado, escaneo página por página y previsualización de miniaturas.
- 🧠 **Descripción y Resumen Inteligente con IA:** Análisis automático del documento tras el OCR:
  - Identificación del tipo de documento (facturas, contratos, recibos, reportes técnicos, etc.).
  - Resumen ejecutivo conciso.
  - Extracción de datos clave (fechas, montos monetarios, nombres de empresas/personas y decisiones).
- 🎛️ **Formatos de Extracción Configurables:**
  - **Markdown enriquecido:** Conserva títulos, listas, tablas y bloques de texto.
  - **Texto plano:** Extracción limpia sin etiquetas ni marcado.
  - **Tablas y formularios:** Optimizado para la captura estructurada de datos tabulares.
  - **Prompt personalizado:** Posibilidad de enviar instrucciones a medida al modelo de IA.
- 💻 **Interfaz Web Moderna e Interactiva:**
  - **Vista Formateada:** Renderizado HTML estilizado con soporte Markdown.
  - **Vista en Bruto (Raw):** Editor de texto plano editable con contador de caracteres.
  - **Vista por Páginas:** Navegación individual por página con miniatura de la imagen procesada.
  - **Búsqueda en Vivo:** Filtrado y resaltado de palabras clave en el texto extraído.
- 💾 **Exportación Inmediata:** Copia directa al portapapeles o descarga en archivos `.md` y `.txt`.

---

## 🏗️ Arquitectura y Tecnologías

- **Backend:** [Node.js](https://nodejs.org/) (ES Modules), [Express](https://expressjs.com/), [Multer](https://github.com/expressjs/multer) (en memoria).
- **Motor de Renderizado PDF:** [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) + [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas).
- **Motor de Inferencia IA:** [Ollama](https://ollama.com/) (API local en `http://127.0.0.1:11434`).
- **Modelos Recomendados:**
  - **OCR / Visión:** `deepseek-ocr:latest`
  - **Resumen y Análisis:** `mistral`, `llama3`, `qwen2.5`, `deepseek-r1`, etc.
- **Frontend:** HTML5, [Tailwind CSS](https://tailwindcss.com/), [Marked.js](https://marked.js.org/), [DOMPurify](https://github.com/cure53/DOMPurify) y [Lucide Icons](https://lucide.dev/).

---

## 📋 Requisitos Previos

1. **Node.js** v18 o superior instalado en el sistema ([Descargar Node.js](https://nodejs.org/)).
2. **Ollama** instalado y ejecutándose ([Descargar Ollama](https://ollama.com/)).
3. Descargar el modelo de OCR en Ollama:
   ```bash
   ollama run deepseek-ocr:latest
   ```
   *(Opcional: puedes tener modelos de texto adicionales como `llama3.2` o `mistral` para el resumen automático).*

---

## 🚀 Instalación y Puesta en Marcha

### 1. Instalar dependencias
```bash
npm install
```

### 2. Iniciar la aplicación

#### Opción A: Inicio rápido en Windows (Recomendado)
Haz doble clic sobre el archivo **`iniciar.bat`**. 
Este script verificará Node.js, iniciará el servidor Express y abrirá automáticamente tu navegador en `http://localhost:3000`.

#### Opción B: Mediante terminal
```bash
# Modo producción
npm start

# O modo desarrollo con recarga en caliente (watch mode)
npm run dev
```

Abre tu navegador en: [http://localhost:3000](http://localhost:3000).

---

## ⚙️ Variables de Entorno y Configuración

El servidor puede configurarse mediante variables de entorno estándar:

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `PORT` | Puerto donde escucha el servidor web | `3000` |
| `OLLAMA_HOST` | URL base de la instancia de Ollama | `http://127.0.0.1:11434` |

*Ejemplo de ejecución con puerto y host personalizado:*
```bash
PORT=8080 OLLAMA_HOST=http://192.168.1.50:11434 npm start
```

---

## 📡 API Endpoints

La aplicación expone los siguientes endpoints REST para integraciones o consumo externo:

### 1. Comprobar Estado y Modelos Disponibles
- **Ruta:** `GET /api/status`
- **Respuesta:**
  ```json
  {
    "connected": true,
    "ollamaHost": "http://127.0.0.1:11434",
    "models": ["deepseek-ocr:latest", "llama3.2:latest"],
    "defaultOcrModel": "deepseek-ocr:latest",
    "defaultSummaryModel": "llama3.2:latest"
  }
  ```

### 2. OCR en Tiempo Real (Server-Sent Events)
- **Ruta:** `POST /api/ocr-stream`
- **Content-Type:** `multipart/form-data`
- **Parámetros (`FormData`):**
  - `file`: Archivo PDF o imagen (hasta 100 MB).
  - `model`: Nombre del modelo OCR (ej. `deepseek-ocr:latest`).
  - `summaryModel`: Nombre del modelo para el resumen (opcional).
  - `format`: Formato de salida (`markdown`, `text`, `table`).
  - `customPrompt`: Instrucción personalizada opcional.
  - `autoSummary`: `"true"` o `"false"`.
  - `scale`: Escala de resolución para renderizar PDF (ej. `2.0`).

### 3. OCR Estándar (JSON Sync)
- **Ruta:** `POST /api/ocr`
- **Content-Type:** `multipart/form-data`
- **Respuesta:**
  ```json
  {
    "success": true,
    "filename": "documento.pdf",
    "totalPages": 3,
    "pages": [
      { "pageNumber": 1, "text": "..." }
    ],
    "fullText": "...",
    "summary": "### 📌 Tipo y Descripción..."
  }
  ```

---

## 📁 Estructura del Proyecto

```text
ocr/
├── public/
│   ├── index.html       # Interfaz gráfica de usuario
│   ├── app.js           # Lógica del cliente, SSE, renderizado y descarga
│   └── style.css        # Estilos personalizados y utilidades de interfaz
├── iniciar.bat          # Lanzador automático de un clic para Windows
├── package.json         # Configuración y dependencias de Node.js
├── server.js            # Servidor Express, renderizado PDF y conexión a Ollama
└── README.md            # Documentación del proyecto
```

---

## 📄 Licencia

Este proyecto es de uso libre bajo la licencia [MIT](https://opensource.org/licenses/MIT).
