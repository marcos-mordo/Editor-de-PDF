# Editor de PDF

Editor de PDF profesional, multiplataforma y libre. Alternativa a Adobe Acrobat, Foxit y Nitro — todo procesado **localmente** en tu equipo, sin suscripciones ni telemetría.

---

## Características

### Visualización y navegación
- Visor PDF multi-página con zoom (25%–500%), rotación por página, panel de miniaturas, marcadores y lista de anotaciones.
- Selección y copia de texto desde el visor.

### Edición y anotaciones
- Resaltar, subrayar, tachar (markup completo).
- Rectángulos, elipses, flechas y dibujo libre con color, grosor y opacidad ajustables.
- Insertar **texto** sobre el PDF (fuente, tamaño, color).
- Insertar **imágenes** (PNG/JPG) en una o varias páginas.
- Notas adhesivas con contenido.
- Captura de **firma manuscrita** con el ratón/lápiz y colocación en cualquier página.
- Panel lateral con todas las anotaciones del documento.

### Gestión de páginas
- Reordenar páginas arrastrando.
- Rotar páginas (individual o todas a la vez).
- Eliminar páginas.
- Combinar varios PDFs en uno.
- Dividir un PDF: cada N páginas, por rangos personalizados, o extraer páginas sueltas.

### OCR (reconocimiento de texto)
- Tesseract.js integrado, 100% local.
- Idiomas: español, inglés, francés, portugués, alemán y combinaciones.
- Modos de salida:
  - **PDF buscable** (texto invisible sobre el escaneo).
  - **PDF con texto visible** sobre el escaneo.
  - **Texto plano** (.txt).

### Conversión
- Exportar a **imágenes PNG** (ZIP con todas las páginas).
- Exportar a **Word (.docx)** con texto extraído y saltos de página.
- Exportar a **Excel (.xlsx)** con detección heurística de tablas.

### Seguridad
- Marcas de agua de texto: posición centrada o mosaico diagonal, color, opacidad y rotación.
- Protección con contraseña (marca el documento; encriptación AES nativa en próximas versiones).

---

## Stack técnico

| Componente | Tecnología |
|---|---|
| Aplicación de escritorio | Electron 33 |
| UI | React 18 + TypeScript + Tailwind CSS |
| Build | Vite 5 + electron-builder |
| Renderizado PDF | PDF.js (pdfjs-dist) |
| Manipulación PDF | pdf-lib |
| OCR | Tesseract.js v5 |
| Estado | Zustand |
| Drag & drop | dnd-kit |
| Exportación | docx, xlsx, jszip |

---

## Instalación (desarrollo)

Requiere **Node.js ≥ 20** y npm.

```bash
# Instalar dependencias
npm install

# Iniciar en modo desarrollo (Electron + Vite + hot reload)
npm run dev
```

---

## Empaquetado y distribución

Genera instaladores para distribución:

```bash
# Tu plataforma actual
npm run dist

# Específicos
npm run dist:win     # Instalador NSIS para Windows
npm run dist:mac     # DMG para macOS (Intel y Apple Silicon)
npm run dist:linux   # AppImage y .deb para Linux

# Las tres a la vez (solo desde macOS o con dependencias)
npm run dist:all
```

Los binarios resultantes se generan en `release/`.

---

## Estructura del proyecto

```
.
├── electron/                  Proceso main de Electron + preload (IPC seguro)
│   ├── main.ts                Ventana, menús nativos, file dialogs
│   └── preload.ts             Bridge a la API expuesta a la UI (window.api)
├── src/
│   ├── App.tsx                Layout principal
│   ├── main.tsx               Entrada React
│   ├── styles.css             Tailwind + componentes
│   ├── lib/                   Helpers (pdfjs, utils)
│   ├── stores/                Estado global (Zustand)
│   │   ├── document.ts        Documento abierto, páginas, zoom
│   │   ├── tools.ts           Herramienta activa, color, grosor
│   │   └── annotations.ts     Anotaciones por página
│   ├── components/
│   │   ├── Viewer/            Visor PDF + capa de anotaciones SVG
│   │   ├── Toolbar/           Toolbar superior y paleta de herramientas
│   │   ├── Sidebar/           Miniaturas, marcadores, anotaciones
│   │   ├── Welcome/           Pantalla de inicio con drag & drop
│   │   └── Modal/             Sistema de diálogos
│   └── features/
│       ├── save/              Aplicar ediciones y flatten anotaciones
│       ├── pages/             Combinar y dividir
│       ├── ocr/               Reconocimiento de texto
│       ├── security/          Marcas de agua y protección
│       ├── convert/           Export a imágenes, Word, Excel
│       ├── edit/              Insertar imágenes
│       └── forms/             Firmas manuscritas
└── package.json
```

---

## Atajos de teclado

| Acción | Atajo |
|---|---|
| Abrir PDF | `Ctrl/Cmd + O` |
| Guardar | `Ctrl/Cmd + S` |
| Guardar como | `Ctrl/Cmd + Shift + S` |
| Acercar | `Ctrl/Cmd + =` |
| Alejar | `Ctrl/Cmd + -` |
| 100% | `Ctrl/Cmd + 0` |
| Eliminar anotación seleccionada | `Supr` / `Backspace` |

---

## Privacidad

**No hay servidores**. Todo el procesamiento (renderizado, OCR, ediciones, conversiones, firmas) ocurre en tu equipo. La aplicación nunca sube tus archivos a internet.

La primera vez que ejecutes OCR, Tesseract descargará el modelo del idioma seleccionado (~10–30 MB) desde el CDN público de Tesseract. A partir de ahí queda cacheado localmente.

---

## Limitaciones conocidas y roadmap

Versión actual (v0.1):
- **Edición de texto existente del PDF**: actualmente puedes añadir texto nuevo, pero no editar el texto original (similar limitación que muchos editores). Roadmap: integrar selección y reemplazo de runs de texto.
- **Cifrado AES nativo**: la protección con contraseña marca metadatos y guarda. La encriptación AES-256 completa requiere bundlear `qpdf` o un módulo WASM dedicado (próxima versión).
- **Conversión Word/Excel**: extracción heurística de texto y tablas. Documentos muy complejos pueden requerir ajuste manual posterior.

Próximas versiones:
- Edición in-place del texto original.
- Encriptación AES-256.
- Comparación de documentos.
- Formularios: crear campos nuevos (text fields, checkboxes, dropdowns).
- Firmas digitales con certificados X.509.
- Redacción permanente (no solo cubrir).
- Plantillas (membretes, marcas de agua reutilizables).

---

## Licencia

Uso personal y comercial permitido. Adapta y distribuye como prefieras.
