# Khmer Font Factory (KFF)

A 100% serverless, zero-backend, client-side font generation and compilation sandbox for Khmer fonts. The application operates entirely in the browser using WebAssembly (Wasm) and Web Workers.

## Key Features

- **In-Browser Font Compilation**: Compiles/generates fonts directly inside the browser using Pyodide (Python in WebAssembly).
- **Non-blocking Architecture**: Offloads CPU-intensive tasks (like Pyodide and the compilation pipeline) to Web Workers.
- **Visual Panels**:
  - **Vector Panel**: For rendering and examining vector font data.
  - **Raster Panel**: For rasterized previews and testing.
  - **Font Gallery**: To browse and manage generated fonts.


## Few-Shot AI Font Generation Pipeline

The core AI engine runs completely client-side via **ONNX Runtime Web** (utilizing WASM multi-threading). It implements a **few-shot style-transfer font generator** (based on MXFont) to generate style-consistent Khmer glyphs from just a few reference style images.

The generation flow inside [pipeline.worker.js](file:///h:/KFF/src/workers/pipeline.worker.js) operates as follows:
1. **Style Encoding**: The user's reference style images are processed by the `image_encoder.onnx` and `sequence_encoder.onnx` sessions to extract style embeddings.
2. **Glyph Generation**: The `mxfont_generator.onnx`, `sequence_decoder_step.onnx`, and `target_embedding_helper.onnx` sessions generate the target Khmer glyphs in raster form, matching the extracted style.
3. **Self-Refinement**: The generated glyphs are passed through the `self_refinement_module.onnx` (`sessionSRM`) to polish and denoise details.
4. **Vectorization (VTracer)**: The refined raster glyphs are vectorized into SVG path commands using **VTracer** compiled to WebAssembly.
5. **Font Compilation**: The SVG paths are packaged into a standard OpenType/WOFF2 font file using `opentype.js` and `wawoff2`.

## Tech Stack

- **Frontend Framework**: [React](https://react.dev/) + [Vite](https://vite.dev/)
- **Python in Browser**: [Pyodide](https://pyodide.org/) (runs Wasm-compiled Python packages and scripts like `font_compiler.py`)
- **Font Manipulation**: [opentype.js](https://opentype.js.org/) & [wawoff2](https://github.com/google/wawoff2)
- **AI/ML Runtime**: [ONNX Runtime Web](https://onnxruntime.ai/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)

## Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) installed.

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the local development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```
