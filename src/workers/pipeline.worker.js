// ONNX Inference Pipeline Web Worker
importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js");
importScripts("/models/vtracer_loader.js");

// Configure CDN for WebAssembly files matching the installed version
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';

let sessionGenerator = null;
let sessionImgEncoder = null;
let sessionSeqDecoderStep = null;
let sessionSeqEncoder = null;
let sessionEmbeddingHelper = null;
let sessionSRM = null;

// Parser for SVG paths produced by VTracer back to standard DeepVecFont sequence coordinates
function extractPathsFromSvg(svgStr) {
    const pathRegex = /<path\s+([^>]+)>/g;
    const paths = [];
    let match;
    while ((match = pathRegex.exec(svgStr)) !== null) {
        const attrsStr = match[1];
        const dMatch = attrsStr.match(/d=["']([^"']+)["']/);
        const transformMatch = attrsStr.match(/transform=["']([^"']+)["']/);

        const d = dMatch ? dMatch[1] : "";
        const transform = transformMatch ? transformMatch[1] : "";
        paths.push({ d, transform });
    }
    return paths;
}

function parseTranslation(transformStr) {
    if (!transformStr) return [0.0, 0.0];
    let match = transformStr.match(/translate\(\s*([+-]?\d*\.\d+|[+-]?\d+)\s*,\s*([+-]?\d*\.\d+|[+-]?\d+)\s*\)/);
    if (match) {
        return [parseFloat(match[1]), parseFloat(match[2])];
    }
    match = transformStr.match(/translate\(\s*([+-]?\d*\.\d+|[+-]?\d+)\s+([+-]?\d*\.\d+|[+-]?\d+)\s*\)/);
    if (match) {
        return [parseFloat(match[1]), parseFloat(match[2])];
    }
    return [0.0, 0.0];
}

function parseSvgPath(dStr, tx = 0.0, ty = 0.0) {
    const tokens = dStr.match(/[MmLlCcZz]|[+-]?(?:\d*\.\d+|\d+)/g) || [];
    const contours = [];
    let currentContour = [];

    let currX = 0.0, currY = 0.0;
    let startX = 0.0, startY = 0.0;
    let activeCmd = null;
    let args = [];

    function processCommand(cmd, vals) {
        if (cmd === 'M' || cmd === 'm') {
            let [x, y] = vals;
            if (cmd === 'm') {
                x += currX;
                y += currY;
            }
            currX = x;
            currY = y;
            startX = x;
            startY = y;

            const absX = x + tx;
            const absY = y + ty;
            if (currentContour.length > 0) {
                contours.push(currentContour);
            }
            currentContour = [['M', [0.0, 0.0, 0.0, 0.0, absX, absY]]];
        } else if (cmd === 'L' || cmd === 'l') {
            let [x, y] = vals;
            if (cmd === 'l') {
                x += currX;
                y += currY;
            }
            currX = x;
            currY = y;

            const absX = x + tx;
            const absY = y + ty;
            currentContour.push(['L', [0.0, 0.0, 0.0, 0.0, absX, absY]]);
        } else if (cmd === 'C' || cmd === 'c') {
            let [x1, y1, x2, y2, x3, y3] = vals;
            if (cmd === 'c') {
                x1 += currX;
                y1 += currY;
                x2 += currX;
                y2 += currY;
                x3 += currX;
                y3 += currY;
            }
            currX = x3;
            currY = y3;

            const absX1 = x1 + tx;
            const absY1 = y1 + ty;
            const absX2 = x2 + tx;
            const absY2 = y2 + ty;
            const absX3 = x3 + tx;
            const absY3 = y3 + ty;
            currentContour.push(['C', [absX1, absY1, absX2, absY2, absX3, absY3]]);
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (['M', 'm', 'L', 'l', 'C', 'c', 'Z', 'z'].includes(token)) {
            activeCmd = token;
            args = [];
            if (token === 'Z' || token === 'z') {
                if (currentContour.length > 0) {
                    currentContour.push(['Z', null]);
                }
                currX = startX;
                currY = startY;
            }
        } else {
            args.push(parseFloat(token));
            if ((activeCmd === 'M' || activeCmd === 'm') && args.length === 2) {
                processCommand(activeCmd, args);
                activeCmd = (activeCmd === 'M') ? 'L' : 'l';
                args = [];
            } else if ((activeCmd === 'L' || activeCmd === 'l') && args.length === 2) {
                processCommand(activeCmd, args);
                args = [];
            } else if ((activeCmd === 'C' || activeCmd === 'c') && args.length === 6) {
                processCommand(activeCmd, args);
                args = [];
            }
        }
    }

    if (currentContour.length > 0) {
        contours.push(currentContour);
    }
    return contours;
}

function parseContoursToSequence(contours, width = 256.0, height = 256.0) {
    const allCmds = [];
    const allCoords = [];
    const allContourEnds = [];

    for (let c = 0; c < contours.length; c++) {
        const contour = contours[c];
        if (contour.length === 0) continue;

        const [firstCmd, firstArgs] = contour[0];
        let isBorder = false;
        if (firstCmd === 'M' && Math.abs(firstArgs[4]) < 2.0 && Math.abs(firstArgs[5]) < 2.0) {
            for (let i = 0; i < contour.length; i++) {
                const [cmdType, args] = contour[i];
                if (['C', 'L'].includes(cmdType) && (Math.abs(args[4] - width) < 2.0 || Math.abs(args[5] - height) < 2.0)) {
                    isBorder = true;
                    break;
                }
            }
        }

        if (isBorder) continue;

        for (let i = 0; i < contour.length; i++) {
            const [cmdType, args] = contour[i];
            if (cmdType === 'M') {
                allCmds.push(0);
                const x = args[4] / width;
                const y = args[5] / height;
                allCoords.push([0.0, 0.0, 0.0, 0.0, x, y]);
                allContourEnds.push(0.0);
            } else if (cmdType === 'L') {
                allCmds.push(1);
                const x = args[4] / width;
                const y = args[5] / height;
                allCoords.push([0.0, 0.0, 0.0, 0.0, x, y]);
                allContourEnds.push(0.0);
            } else if (cmdType === 'C') {
                allCmds.push(2);
                const x1 = args[0] / width;
                const y1 = args[1] / height;
                const x2 = args[2] / width;
                const y2 = args[3] / height;
                const x3 = args[4] / width;
                const y3 = args[5] / height;
                allCoords.push([x1, y1, x2, y2, x3, y3]);
                allContourEnds.push(0.0);
            } else if (cmdType === 'Z') {
                if (allContourEnds.length > 0) {
                    allContourEnds[allContourEnds.length - 1] = 1.0;
                }
            }
        }
    }

    if (allCmds.length === 0) {
        allCmds.push(3);
        allCoords.push([0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        allContourEnds.push(0.0);
    } else {
        allCmds.push(3);
        allCoords.push([0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        allContourEnds.push(0.0);
    }

    return {
        commands: allCmds,
        coords: allCoords
    };
}

// Parser for NumPy .npy files
function parseNpy(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const magic = String.fromCharCode(
        view.getUint8(0), view.getUint8(1), view.getUint8(2),
        view.getUint8(3), view.getUint8(4), view.getUint8(5)
    );
    if (magic !== "\x93NUMPY") {
        throw new Error("Invalid npy file signature");
    }

    const headerLen = view.getUint16(8, true);
    const headerBytes = new Uint8Array(arrayBuffer, 10, headerLen);
    const headerStr = new TextDecoder("ascii").decode(headerBytes);

    const shapeMatch = headerStr.match(/'shape':\s*\((\d+),\s*(\d+)\)/) || headerStr.match(/'shape':\s*\((\d+),\s*\)/);
    if (!shapeMatch) {
        throw new Error("Could not parse shape from npy header: " + headerStr);
    }

    const rows = parseInt(shapeMatch[1], 10);
    const cols = shapeMatch[2] ? parseInt(shapeMatch[2], 10) : 1;

    const dataOffset = 10 + headerLen;
    const floatData = new Float32Array(arrayBuffer, dataOffset);

    return {
        shape: [rows, cols],
        data: floatData
    };
}

// Converts predicted coordinates and commands to an SVG path string
function sequenceToSvg(cmds, coords, width = 256, height = 256, outline = false, strokeWidth = 2.0) {
    let pathD = "";
    for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i];
        if (cmd === 3) break; // EOS

        const x1 = coords[i * 6 + 0] * width;
        const y1 = coords[i * 6 + 1] * height;
        const x2 = coords[i * 6 + 2] * width;
        const y2 = coords[i * 6 + 3] * height;
        const x3 = coords[i * 6 + 4] * width;
        const y3 = coords[i * 6 + 5] * height;

        if (cmd === 0) { // MoveTo
            pathD += ` M ${x3.toFixed(2)} ${y3.toFixed(2)}`;
        } else if (cmd === 1) { // LineTo
            pathD += ` L ${x3.toFixed(2)} ${y3.toFixed(2)}`;
        } else if (cmd === 2) { // CubicTo
            pathD += ` C ${x1.toFixed(2)} ${y1.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}, ${x3.toFixed(2)} ${y3.toFixed(2)}`;
        }
    }

    const fillAttr = outline ? "none" : "black";
    const strokeAttr = outline ? "black" : "none";
    const swAttr = outline ? ` stroke-width="${strokeWidth}"` : "";

    let svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" preserveAspectRatio="xMidYMid meet" width="${width}" height="${height}">\n`;
    svgStr += `  <path d="${pathD.trim()}" fill="${fillAttr}" stroke="${strokeAttr}"${swAttr} fill-rule="evenodd" />\n`;
    svgStr += `</svg>`;
    return svgStr;
}

// Helper to load template image data into greyscale float array
async function loadTemplateImage(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0, 256, 256);

    const imgData = ctx.getImageData(0, 0, 256, 256);
    const floatArr = new Float32Array(256 * 256);
    const data = imgData.data;

    for (let i = 0; i < 256 * 256; i++) {
        // Red channel normalized to [0.0, 1.0]
        floatArr[i] = data[i * 4] / 255.0;
    }
    return floatArr;
}

// Helper to convert Float32Array image back to PNG dataURL
async function floatArrayToDataUrl(floatArr) {
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(256, 256);

    for (let i = 0; i < 256 * 256; i++) {
        const val = Math.max(0, Math.min(255, Math.round(floatArr[i] * 255.0)));
        imgData.data[i * 4 + 0] = val; // R
        imgData.data[i * 4 + 1] = val; // G
        imgData.data[i * 4 + 2] = val; // B
        imgData.data[i * 4 + 3] = 255; // A
    }
    ctx.putImageData(imgData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReaderSync();
    return reader.readAsDataURL(blob);
}

// Handles incoming messages in worker
self.onmessage = async function (e) {
    const data = e.data;

    if (data.type === "init") {
        try {
            console.log("[Pipeline Worker] Initializing ONNX sessions...");

            // Configure WASM to use multi-threading
            const numThreads = navigator.hardwareConcurrency || 4;
            ort.env.wasm.numThreads = numThreads;
            console.log(`[Pipeline Worker] Configuring WASM with ${numThreads} threads.`);

            const sessionOptions = {
                numThreads: numThreads
            };

            // Load sessions sequentially with multi-threading options
            sessionGenerator = await ort.InferenceSession.create("/models/mxfont_generator.onnx", sessionOptions);
            sessionImgEncoder = await ort.InferenceSession.create("/models/image_encoder.onnx", sessionOptions);
            sessionSeqDecoderStep = await ort.InferenceSession.create("/models/sequence_decoder_step.onnx", sessionOptions);
            sessionSeqEncoder = await ort.InferenceSession.create("/models/sequence_encoder.onnx", sessionOptions);
            sessionEmbeddingHelper = await ort.InferenceSession.create("/models/target_embedding_helper.onnx", sessionOptions);
            sessionSRM = await ort.InferenceSession.create("/models/self_refinement_module.onnx", sessionOptions);

            console.log("[Pipeline Worker] Initializing client-side VTracer WASM...");
            await initVTracer("/models/vectortracer_bg.wasm");

            console.log("[Pipeline Worker] ONNX and VTracer sessions loaded successfully.");
            self.postMessage({ type: "ready" });
        } catch (err) {
            console.error("[Pipeline Worker] Session loading failure: ", err);
            self.postMessage({ type: "error", message: err.message });
        }
    }

    else if (data.type === "run") {
        const { 
            styleRefs, 
            glyphs, 
            autoregressive, 
            styleWeight, 
            templateInfluenceWeight, 
            imageInfluenceWeight, 
            vectorEngine, 
            vtracerParams 
        } = data;

        // Expose independent template and image influence weights, mapping backward compatibility to styleWeight if provided
        let templateWeight = 0.5;
        let imageWeight = 1.5;

        if (templateInfluenceWeight !== undefined) {
            templateWeight = templateInfluenceWeight;
        } else if (styleWeight !== undefined) {
            templateWeight = 2.0 * (1 - styleWeight);
        }

        if (imageInfluenceWeight !== undefined) {
            imageWeight = imageInfluenceWeight;
        } else if (styleWeight !== undefined) {
            imageWeight = 2.0 * styleWeight;
        }

        try {
            console.log("[Pipeline Worker] Stacking style reference images...");
            // Stacking 8 style references (padding/duplicating if needed)
            const styleImgData = new Float32Array(8 * 256 * 256);
            for (let i = 0; i < 8; i++) {
                const ref = styleRefs[i % styleRefs.length];
                styleImgData.set(ref, i * 256 * 256);
            }
            const styleTensor = new ort.Tensor('float32', styleImgData, [1, 8, 1, 256, 256]);

            // Run inference for each glyph sequentially with progress reports
            for (let idx = 0; idx < glyphs.length; idx++) {
                const glyph = glyphs[idx];
                const hex = glyph.hex;

                try {
                    // --- STAGE 0: Few-Shot Image Generation ---
                    const imageUrl = `/templates/images/${hex}.png`;
                    const contentImgData = await loadTemplateImage(imageUrl);
                    const contentTensor = new ort.Tensor('float32', contentImgData, [1, 1, 256, 256]);

                    const genFeeds = {
                        style_imgs: styleTensor,
                        content_img: contentTensor
                    };
                    console.log(`[Worker] Running Generator for U+${hex}...`);
                    const genResults = await sessionGenerator.run(genFeeds);
                    const outImgTensor = genResults.out_img; // shape: [1, 1, 256, 256]

                    const outImgDataUrl = await floatArrayToDataUrl(outImgTensor.data);

                    // Notify main thread of Stage 0 generation
                    self.postMessage({
                        type: "stage0_done",
                        hex: hex,
                        dataUrl: outImgDataUrl,
                        progress: (idx + 1) / glyphs.length
                    });

                    if (vectorEngine === 'vtracer') {
                        // --- VTRACER VECTOR TRACING ---
                        console.log(`[Worker] Running VTracer client-side for U+${hex}...`);

                        const floatArr = outImgTensor.data;
                        let isBlank = true;
                        for (let i = 0; i < floatArr.length; i++) {
                            if (floatArr[i] > 0.1) {
                                isBlank = false;
                                break;
                            }
                        }

                        if (isBlank) {
                            console.log(`[Worker] Glyph U+${hex} image is blank/empty. Bypassing VTracer to prevent infinite loop.`);
                            self.postMessage({
                                type: "stage1_2_done",
                                hex: hex,
                                svg: sequenceToSvg([3], [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
                                vectorData: {
                                    commands: [3],
                                    coords: [[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]]
                                },
                                progress: (idx + 1) / glyphs.length
                            });
                            continue;
                        }

                        const convParams = {
                            debug: false,
                            mode: 'spline',
                            cornerThreshold: (vtracerParams.cornerThreshold || 60) * Math.PI / 180.0,
                            lengthThreshold: vtracerParams.lengthThreshold || 4.0,
                            maxIterations: vtracerParams.maxIterations || 10,
                            spliceThreshold: (vtracerParams.spliceThreshold || 45) * Math.PI / 180.0,
                            filterSpeckle: vtracerParams.filterSpeckle || 4,
                            pathPrecision: 2
                        };
                        const opts = {
                            invert: true,
                            pathFill: "black",
                            backgroundColor: "none",
                            attributes: "",
                            scale: 1.0
                        };

                        const uint8ClampedData = new Uint8ClampedArray(256 * 256 * 4);
                        for (let i = 0; i < 256 * 256; i++) {
                            const val = floatArr[i] > 0.2 ? 255 : 0;
                            uint8ClampedData[i * 4 + 0] = val; // R
                            uint8ClampedData[i * 4 + 1] = val; // G
                            uint8ClampedData[i * 4 + 2] = val; // B
                            uint8ClampedData[i * 4 + 3] = 255; // A
                        }

                        const imgData = { data: uint8ClampedData, width: 256, height: 256 };
                        const converter = new BinaryImageConverter(imgData, convParams, opts);
                        converter.init();
                        while (!converter.tick()) {
                            // Run the processing steps
                        }
                        const svgString = converter.getResult();
                        converter.free();

                        // Parse SVG string back to sequence commands and coordinates
                        const paths = extractPathsFromSvg(svgString);
                        let allContours = [];
                        for (let i = 0; i < paths.length; i++) {
                            const path = paths[i];
                            const [tx, ty] = parseTranslation(path.transform);
                            const contours = parseSvgPath(path.d, tx, ty);
                            allContours = allContours.concat(contours);
                        }

                        const vectorData = parseContoursToSequence(allContours, 256.0, 256.0);

                        self.postMessage({
                            type: "stage1_2_done",
                            hex: hex,
                            svg: sequenceToSvg(vectorData.commands, vectorData.coords.flat()),
                            vectorData: {
                                commands: Array.from(vectorData.commands),
                                coords: vectorData.coords
                            },
                            progress: (idx + 1) / glyphs.length
                        });
                    } else {
                        // --- STAGE 1: Image Encoder ---
                        const imgEncFeeds = { img: outImgTensor };
                        console.log(`[Worker] Running Image Encoder for U+${hex}...`);
                        const imgEncResults = await sessionImgEncoder.run(imgEncFeeds);
                        const zImgTensor = imgEncResults.z_img; // shape: [1, 512]

                        let predCmds;
                        let coordsStage1Data;
                        let contourEnds;
                        let seqLen;
                        let seqNpData = null;
                        // --- STAGE 1: Load template tensor and pre-compute memory ---
                        const tensorUrl = `/templates/tensors/${hex}.npy`;
                        const tensorRes = await fetch(tensorUrl);
                        if (!tensorRes.ok) {
                            throw new Error(`Failed to load template tensor for ${hex}`);
                        }
                        const npyBuffer = await tensorRes.arrayBuffer();
                        const seqNp = parseNpy(npyBuffer);
                        const templateSeqLen = seqNp.shape[0];
                        seqNpData = seqNp.data;

                        // Pad template sequence to exactly 128 * 8 elements to match shape-locked model
                        const templateSeqDataPadded = new Float32Array(128 * 8);
                        for (let i = 0; i < Math.min(templateSeqLen * 8, 128 * 8); i++) {
                            templateSeqDataPadded[i] = seqNpData[i];
                        }

                        // Encode template sequence
                        const templateSeqTensor = new ort.Tensor('float32', templateSeqDataPadded, [1, 128, 8]);
                        const encFeeds0 = { seq: templateSeqTensor };
                        const encResults0 = await sessionSeqEncoder.run(encFeeds0);
                        const seqEncTensor = encResults0.seq_enc; // shape: [1, 128, 512]

                        // Modality Fusion: memory = seq_enc + z_img
                        const maxSeqLen = 128;
                        const memoryData = new Float32Array(1 * maxSeqLen * 512);
                        const seqEncData0 = seqEncTensor.data;
                        const zImgData0 = zImgTensor.data;
                        for (let t = 0; t < maxSeqLen; t++) {
                            const offset = t * 512;
                            for (let k = 0; k < 512; k++) {
                                memoryData[offset + k] = templateWeight * seqEncData0[offset + k] + imageWeight * zImgData0[k];
                            }
                        }
                        const memoryTensor = new ort.Tensor('float32', memoryData, [1, maxSeqLen, 512]);

                        // --- STAGE 1: Sequence Decoder (Autoregressive Mode) ---
                        let tgtSeqList = [[0, 0, 0, 0, 0, 0, 0, 0]]; // start with SOS token

                        for (let t = 0; t < maxSeqLen; t++) {
                            const currentLen = tgtSeqList.length;
                            const tgtSeqData = new Float32Array(128 * 8); // ALWAYS 128 * 8
                            for (let i = 0; i < currentLen; i++) {
                                for (let k = 0; k < 8; k++) {
                                    tgtSeqData[i * 8 + k] = tgtSeqList[i][k];
                                }
                            }
                            const tgtSeqTensor = new ort.Tensor('float32', tgtSeqData, [1, 128, 8]);

                            const decFeeds = {
                                tgt_seq: tgtSeqTensor,
                                memory: memoryTensor
                            };
                            if (t === 0) {
                                console.log(`[Worker] Running Decoder Step 0 for U+${hex}...`);
                            }
                            const decResults = await sessionSeqDecoderStep.run(decFeeds);

                            const cmdLogitsData = decResults.cmd_logits.data;
                            const coordsPredData = decResults.coords_pred.data;
                            const contourEndLogitsData = decResults.contour_end_logits.data;

                            const lastStepOffsetCmd = (currentLen - 1) * 4;
                            const lastStepOffsetCoords = (currentLen - 1) * 6;
                            const lastStepOffsetContour = currentLen - 1;

                            // Argmax for command prediction
                            let maxVal = -Infinity;
                            let maxIdx = 0;
                            for (let k = 0; k < 4; k++) {
                                const val = cmdLogitsData[lastStepOffsetCmd + k];
                                if (val > maxVal) {
                                    maxVal = val;
                                    maxIdx = k;
                                }
                            }
                            const predCmd = maxIdx;

                            // Predicted coordinates
                            const predCoords = [];
                            for (let k = 0; k < 6; k++) {
                                predCoords.push(coordsPredData[lastStepOffsetCoords + k]);
                            }

                            // Contour end activation (sigmoid)
                            const logitVal = contourEndLogitsData[lastStepOffsetContour];
                            const sigmoidVal = 1.0 / (1.0 + Math.exp(-logitVal));
                            const predContour = sigmoidVal > 0.5 ? 1.0 : 0.0;

                            if (predCmd === 3) { // EOS
                                tgtSeqList.push([3, 0, 0, 0, 0, 0, 0, 0]);
                                break;
                            }

                            tgtSeqList.push([
                                predCmd,
                                predCoords[0],
                                predCoords[1],
                                predCoords[2],
                                predCoords[3],
                                predCoords[4],
                                predCoords[5],
                                predContour
                            ]);
                        }

                        // Slice out SOS token
                        const predSeqList = tgtSeqList.slice(1);
                        seqLen = predSeqList.length;

                        predCmds = new Int32Array(seqLen);
                        coordsStage1Data = new Float32Array(seqLen * 6);
                        contourEnds = new Float32Array(seqLen);

                        for (let t = 0; t < seqLen; t++) {
                            predCmds[t] = predSeqList[t][0];
                            coordsStage1Data[t * 6 + 0] = predSeqList[t][1];
                            coordsStage1Data[t * 6 + 1] = predSeqList[t][2];
                            coordsStage1Data[t * 6 + 2] = predSeqList[t][3];
                            coordsStage1Data[t * 6 + 3] = predSeqList[t][4];
                            coordsStage1Data[t * 6 + 4] = predSeqList[t][5];
                            coordsStage1Data[t * 6 + 5] = predSeqList[t][6];
                            contourEnds[t] = predSeqList[t][7];
                        }

                        // --- STAGE 2: Self-Refinement Module (SRM) ---
                        // Helper embeddings for commands + coordinates
                        const tgtCmdData = new BigInt64Array(128); // ALWAYS 128
                        for (let t = 0; t < seqLen; t++) {
                            tgtCmdData[t] = BigInt(predCmds[t]);
                        }
                        const tgtCmdTensor = new ort.Tensor('int64', tgtCmdData, [1, 128]);

                        const tgtCoordsData = new Float32Array(1 * 128 * 7); // ALWAYS 128
                        for (let t = 0; t < seqLen; t++) {
                            const dstOffset = t * 7;
                            const srcOffset = t * 6;
                            for (let k = 0; k < 6; k++) {
                                tgtCoordsData[dstOffset + k] = coordsStage1Data[srcOffset + k];
                            }
                            tgtCoordsData[dstOffset + 6] = contourEnds[t];
                        }
                        const tgtCoordsTensor = new ort.Tensor('float32', tgtCoordsData, [1, 128, 7]);

                        console.log(`[Worker] Running EmbeddingHelper for U+${hex}...`);
                        const embFeeds = {
                            tgt_cmd: tgtCmdTensor,
                            tgt_coords: tgtCoordsTensor
                        };
                        const embResults = await sessionEmbeddingHelper.run(embFeeds);
                        const initEmbTensor = embResults.tgt_emb; // shape: [1, 128, 512]

                        // Encoder sequence encoding for SRM
                        const seqDataForEncoder = new Float32Array(1 * 128 * 8); // ALWAYS 128
                        for (let t = 0; t < seqLen; t++) {
                            const dstOffset = t * 8;
                            seqDataForEncoder[dstOffset + 0] = predCmds[t];
                            seqDataForEncoder[dstOffset + 1] = coordsStage1Data[t * 6 + 0];
                            seqDataForEncoder[dstOffset + 2] = coordsStage1Data[t * 6 + 1];
                            seqDataForEncoder[dstOffset + 3] = coordsStage1Data[t * 6 + 2];
                            seqDataForEncoder[dstOffset + 4] = coordsStage1Data[t * 6 + 3];
                            seqDataForEncoder[dstOffset + 5] = coordsStage1Data[t * 6 + 4];
                            seqDataForEncoder[dstOffset + 6] = coordsStage1Data[t * 6 + 5];
                            seqDataForEncoder[dstOffset + 7] = contourEnds[t];
                        }
                        const srmSeqTensor = new ort.Tensor('float32', seqDataForEncoder, [1, 128, 8]);
                        const srmEncFeeds = { seq: srmSeqTensor };
                        console.log(`[Worker] Running Sequence Encoder for U+${hex}...`);
                        const srmEncResults = await sessionSeqEncoder.run(srmEncFeeds);
                        const srmSeqEncTensor = srmEncResults.seq_enc; // shape: [1, 128, 512]

                        // Modality Fusion for SRM (sequence_enc + z_img)
                        const srmMemoryData = new Float32Array(1 * 128 * 512); // ALWAYS 128
                        const srmSeqEncData = srmSeqEncTensor.data;
                        const zImgData = zImgTensor.data;
                        for (let t = 0; t < 128; t++) {
                            const offset = t * 512;
                            for (let k = 0; k < 512; k++) {
                                srmMemoryData[offset + k] = templateWeight * srmSeqEncData[offset + k] + imageWeight * zImgData[k];
                            }
                        }
                        const srmMemoryTensor = new ort.Tensor('float32', srmMemoryData, [1, 128, 512]);

                        // SRM execution
                        const srmFeeds = {
                            init_seq_emb: initEmbTensor,
                            memory: srmMemoryTensor
                        };
                        console.log(`[Worker] Running SRM for U+${hex}...`);
                        const srmResults = await sessionSRM.run(srmFeeds);
                        const deltaCoordsTensor = srmResults.delta_coords; // shape: [1, 128, 6]

                        // Apply SRM coordinate adjustments
                        const coordsStage2Data = new Float32Array(seqLen * 6);
                        const deltaCoordsData = deltaCoordsTensor.data;
                        for (let i = 0; i < seqLen * 6; i++) {
                            coordsStage2Data[i] = coordsStage1Data[i] + deltaCoordsData[i];
                        }

                        // Convert back to SVG
                        const svgString = sequenceToSvg(predCmds, coordsStage2Data);

                        // Package output coordinates
                        const coordsForCompiler = [];
                        for (let t = 0; t < seqLen; t++) {
                            const offset = t * 6;
                            coordsForCompiler.push([
                                coordsStage2Data[offset + 0],
                                coordsStage2Data[offset + 1],
                                coordsStage2Data[offset + 2],
                                coordsStage2Data[offset + 3],
                                coordsStage2Data[offset + 4],
                                coordsStage2Data[offset + 5]
                            ]);
                        }

                        // Notify main thread of Stage 1 & 2 Vectorization completion
                        self.postMessage({
                            type: "stage1_2_done",
                            hex: hex,
                            svg: svgString,
                            vectorData: {
                                commands: Array.from(predCmds),
                                coords: coordsForCompiler
                            },
                            progress: (idx + 1) / glyphs.length
                        });
                    }

                } catch (glyphErr) {
                    console.warn(`[Pipeline Worker] Error processing U+${hex}:`, glyphErr);
                    if (glyphErr instanceof Error) {
                        console.error(glyphErr.message, glyphErr.stack);
                    } else {
                        console.error("Non-Error exception:", glyphErr);
                    }
                    self.postMessage({
                        type: "stage_error",
                        hex: hex,
                        message: glyphErr instanceof Error ? glyphErr.message : String(glyphErr)
                    });
                }
            }

            console.log("[Pipeline Worker] Entire inference pipeline execution completed.");
            self.postMessage({ type: "done" });
        } catch (err) {
            console.error("[Pipeline Worker] Execution error: ", err);
            self.postMessage({ type: "error", message: err.message });
        }
    }
};
