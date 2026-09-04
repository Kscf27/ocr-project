# 🏥 Escáner de Incapacidades Médicas con IA Local

Aplicación web local de alto rendimiento diseñada específicamente para el **escaneo, lectura OCR y auditoría inteligente de certificados de incapacidad médica** (en formato PDF o imágenes), procesada 100% en tu entorno local mediante **Ollama** y modelos de visión e inferencia de texto (como **DeepSeek OCR** y **Gemma / Llama**).

> [!NOTE]
> **Privacidad y Seguridad Médica:** Al ejecutarse completamente en local con Ollama, ningún dato clínico o sensible de los pacientes o trabajadores es transmitido a servicios externos en la nube.

---

## 🌟 Características Principales

- 📑 **Escaneo de Incapacidades en PDF e Imágenes:** Soporte para certificados multi-página en PDF y formatos gráficos escaneados o fotografías (`.png`, `.jpg`, `.jpeg`, `.webp`) hasta 100 MB.
- 🩺 **Auditoría Clínica y Laboral Automatizada con IA:** Extracción estructurada de los datos más críticos del certificado de incapacidad:
  - **Identificación del Paciente/Trabajador:** Nombres y número de identificación / cédula.
  - **Entidad de Salud:** EPS, IPS, clínica u hospital emisor.
  - **Médico Tratante:** Nombre, especialidad y registro médico.
  - **Período de Incapacidad:** Fecha de inicio, fecha de terminación y días totales otorgados.
  - **Tipo de Contingencia:** Origen de la incapacidad (Enfermedad general, Accidente de trabajo, Enfermedad laboral, Maternidad/Paternidad, Accidente de tránsito).
  - **Diagnóstico y CIE-10:** Código(s) de diagnóstico y descripción de la condición de salud.
  - **Tipo de Trámite:** Validación si es incapacidad inicial o prórroga.
  - **Recomendaciones y Restricciones:** Cuidados laborales y controles médicos.
- ⚡ **Progreso en Tiempo Real con SSE (Server-Sent Events):** Visualización en vivo del renderizado, escaneo página por página y previsualización de cada página procesada.
- 📊 **Métricas de Rendimiento en Tiempo Real:** Monitor de tokens consumidos, velocidad (tokens/segundo) y tiempo de procesamiento.
- 🎛️ **Formatos de Lectura OCR:**
  - **Markdown:** Conserva formato estructurado, encabezados y listas.
  - **Texto plano:** Extracción directa sin etiquetas.
  - **Tablas:** Diseñado para formularios y formatos tabulados del sector salud.
  - **Instrucción personalizada:** Permite ajustar el prompt enviado al modelo de visión.
- 💾 **Exportación Inmediata:** Copia rápida de datos de auditoría al portapapeles y descarga de informes en `.md` y `.txt`.

---

## 🏗️ Arquitectura y Tecnologías

- **Backend:** [Node.js](https://nodejs.org/) (ES Modules), [Express](https://expressjs.com/), [Multer](https://github.com/expressjs/multer) (en memoria).
- **Motor de Renderizado PDF:** [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) + [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas).
- **Motor de Inferencia IA:** [Ollama](https://ollama.com/) (API local en `http://127.0.0.1:11434`).
- **Modelos Recomendados:**
  - **OCR / Visión:** `deepseek-ocr:latest`
  - **Auditoría y Resumen Clínico:** `gemma4:e4b`, `llama3.2`, `mistral`, `qwen2.5`, etc.
- **Frontend:** HTML5, [Tailwind CSS](https://tailwindcss.com/), [Marked.js](https://marked.js.org/), [DOMPurify](https://github.com/cure53/DOMPurify) y [Lucide Icons](https://lucide.dev/).

---

## 📋 Requisitos Previos

1. **Node.js** v18 o superior instalado en el sistema ([Descargar Node.js](https://nodejs.org/)).
2. **Ollama** instalado y en ejecución ([Descargar Ollama](https://ollama.com/)).
3. Descargar el modelo de visión / OCR en Ollama:
   ```bash
   ollama run deepseek-ocr:latest
   ```
   *(Opcional: puedes contar con modelos de lenguaje como `gemma4:e4b`, `llama3.2` o `mistral` para la auditoría y extracción clínica).*

---

## 🚀 Instalación y Puesta en Marcha

### 1. Instalar dependencias
```bash
npm install
```

### 2. Iniciar la aplicación

#### Opción A: Inicio rápido en Windows (Recomendado)
Haz doble clic sobre el archivo **`iniciar.bat`**. 
El script validará Node.js, iniciará el servidor Express y abrirá tu navegador en `http://localhost:3000`.

#### Opción B: Mediante terminal
```bash
# Modo producción
npm start

# Modo desarrollo con recarga automática
npm run dev
```

Abre tu navegador en: [http://localhost:3000](http://localhost:3000).

---

## ⚙️ Variables de Entorno

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `PORT` | Puerto donde escucha el servidor web | `3000` |
| `OLLAMA_HOST` | URL base de la instancia de Ollama | `http://127.0.0.1:11434` |

---

## 📡 API Endpoints

### 1. Comprobar Estado y Modelos Disponibles
- **Ruta:** `GET /api/status`
- **Respuesta:**
  ```json
  {
    "connected": true,
    "ollamaHost": "http://127.0.0.1:11434",
    "visionModels": ["deepseek-ocr:latest"],
    "summaryModels": ["deepseek-ocr:latest", "gemma4:e4b"],
    "defaultOcrModel": "deepseek-ocr:latest",
    "defaultSummaryModel": "gemma4:e4b"
  }
  ```

### 2. Escaneo de Incapacidad en Tiempo Real (Server-Sent Events)
- **Ruta:** `POST /api/ocr-stream`
- **Content-Type:** `multipart/form-data`
- **Parámetros (`FormData`):**
  - `file`: Archivo PDF o imagen de la incapacidad.
  - `model`: Modelo de visión OCR (ej. `deepseek-ocr:latest`).
  - `summaryModel`: Modelo para la auditoría clínica (ej. `gemma4:e4b`).
  - `format`: Formato de lectura (`markdown`, `text`, `table`).
  - `autoSummary`: `"true"` o `"false"`.

### 3. Escaneo Estándar (JSON Sync)
- **Ruta:** `POST /api/ocr`
- **Content-Type:** `multipart/form-data`

---

## 📁 Estructura del Proyecto

```text
ocr/
├── public/
│   ├── index.html       # Interfaz gráfica adaptada para escaneo de incapacidades
│   ├── app.js           # Lógica frontend, cliente SSE y exportación
│   └── style.css        # Estilos personalizados y utilidades de interfaz
├── iniciar.bat          # Script de inicio rápido en Windows
├── package.json         # Configuración y dependencias del proyecto
├── server.js            # Servidor Express, renderizado y conexión a Ollama
└── README.md            # Documentación del proyecto
```

---

## 📄 Licencia

Este proyecto es de uso libre bajo la licencia [MIT](https://opensource.org/licenses/MIT).
