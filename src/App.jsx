import React, { useState, useEffect, useRef } from 'react';
import wheelUrl from './assets/fonttools-4.63.0-py3-none-any.whl';
import donorFontUrl from './assets/NotoSansKhmer.ttf';
import generatedFontUrl from './assets/KhmerCustomFont-Regular.ttf';
import pythonCompilerCode from './python/font_compiler.py?raw';
import KHMER_GLYPHS from './assets/glyphs.json';
import { saveFont, getAllFonts, deleteFont } from './utils/storage.js';
import RasterPanel from './components/RasterPanel.jsx';
import VectorPanel from './components/VectorPanel.jsx';
import FontGalleryPanel from './components/FontGalleryPanel.jsx';

// Helper to resolve glyph category matching Khmer and English specifics
function getGlyphCategory(glyph) {
    if (!glyph || !glyph.hex || typeof glyph.hex !== 'string') return 'others';
    const hex = glyph.hex;
    const char = glyph.char || "";

    // 1. Khmer Numbers: U+17E0 - U+17E9
    if (char.length === 1) {
        const cp = char.charCodeAt(0);
        if (cp >= 0x17E0 && cp <= 0x17E9) {
            return 'kh_number';
        }
    }

    // 2. Khmer Consonants: U+1780 - U+17A2
    if (char.length === 1) {
        const cp = char.charCodeAt(0);
        if (cp >= 0x1780 && cp <= 0x17A2) {
            return 'kh_consonants';
        }
    }

    // 3. Khmer Vowels (Dependent/Independent) & Subscripts: U+17A3 - U+17D1, U+17D3
    const isVowelCode = char.length === 1 && ((char.charCodeAt(0) >= 0x17A3 && char.charCodeAt(0) <= 0x17D1) || char.charCodeAt(0) === 0x17D3);
    const isSubscript = hex.includes('17D2') || hex.includes('sub') || hex.includes('pref');
    if (isVowelCode || isSubscript) {
        return 'kh_vowels';
    }

    // 4. English Characters: A-Z, a-z
    if (char.length === 1) {
        const cp = char.charCodeAt(0);
        if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
            return 'eng_char';
        }
    }

    // 5. English Numbers: 0-9
    const numWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    if (numWords.includes(hex.toLowerCase()) || /^\d+$/.test(hex)) {
        return 'eng_number';
    }
    if (char.length === 1) {
        const cp = char.charCodeAt(0);
        if (cp >= 48 && cp <= 57) {
            return 'eng_number';
        }
    }

    // 6. Common Signs (Khmer & English punctuation)
    const commonSignHex = [
        "comma", "period", "colon", "semicolon", "exclam", "question",
        "slash", "backslash", "hyphen", "equal", "plus", "minus",
        "asterisk", "percent", "dollar", "ampersand", "quote", "quotedbl",
        "parenleft", "parenright", "bracketleft", "bracketright",
        "braceleft", "braceright", "at", "underscore", "numbersign", "space", "nbsp"
    ];
    if (commonSignHex.includes(hex.toLowerCase())) {
        return 'common_sign';
    }
    if (char.length === 1) {
        const cp = char.charCodeAt(0);
        // Khmer signs: U+17D4-U+17DC, U+17DD-U+17DF
        if ((cp >= 0x17D4 && cp <= 0x17DC) || (cp >= 0x17DD && cp <= 0x17DF)) {
            return 'common_sign';
        }
        // Basic Latin punctuation/symbols
        if ((cp >= 32 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
            return 'common_sign';
        }
    }

    return 'others';
}

// Partition and order the full glyphs array based on selected mode
function getOrderedAndFilteredGlyphs(allGlyphs, mode) {
    const groups = {
        kh_number: [],
        kh_consonants: [],
        kh_vowels: [],
        eng_char: [],
        eng_number: [],
        common_sign: [],
        others: []
    };

    for (const g of allGlyphs) {
        const cat = getGlyphCategory(g);
        if (groups[cat]) {
            groups[cat].push(g);
        } else {
            groups['others'].push(g);
        }
    }

    // Requested Order: kh number > Kh consonants > kh Vowels > Eng char > eng Number > common sign > others
    const ordered = [];
    ordered.push(...groups.kh_number);
    ordered.push(...groups.kh_consonants);
    ordered.push(...groups.kh_vowels);
    ordered.push(...groups.eng_char);
    ordered.push(...groups.eng_number);
    ordered.push(...groups.common_sign);

    if (mode === 'Full') {
        ordered.push(...groups.others);
    }

    return ordered;
}

export default function App() {
    // ----------------------------------------------------
    // STATE
    // ----------------------------------------------------
    const [styleRefs, setStyleRefs] = useState([
        { id: 1, charHex: '1780', file: null, dataUrl: null },
        { id: 2, charHex: '1781', file: null, dataUrl: null },
        { id: 3, charHex: '1782', file: null, dataUrl: null },
        { id: 4, charHex: '1783', file: null, dataUrl: null },
        { id: 5, charHex: '1784', file: null, dataUrl: null },
        { id: 6, charHex: '1785', file: null, dataUrl: null },
    ]);

    const [familyName, setFamilyName] = useState('Khmer Custom');
    const [styleName, setStyleName] = useState('Regular');
    const [vectorEngine, setVectorEngine] = useState('vtracer'); // 'stage2' or 'vtracer'
    const [generationMode, setGenerationMode] = useState('Template'); // 'Template' or 'Autoregressive'
    const [templateInfluenceWeight, setTemplateInfluenceWeight] = useState(0.2);
    const [imageInfluenceWeight, setImageInfluenceWeight] = useState(1.8);
    const [glyphSetMode, setGlyphSetMode] = useState('Essential'); // 'Essential' or 'Full'
    const targetGlyphsLengthRef = useRef(KHMER_GLYPHS.length);

    // VTracer parameters state
    const [vtracerFilterSpeckle, setVtracerFilterSpeckle] = useState(4);
    const [vtracerCornerThreshold, setVtracerCornerThreshold] = useState(60);
    const [vtracerLengthThreshold, setVtracerLengthThreshold] = useState(4.0);
    const [vtracerMaxIterations, setVtracerMaxIterations] = useState(10);
    const [vtracerSpliceThreshold, setVtracerSpliceThreshold] = useState(45);

    const [btnDisabled, setBtnDisabled] = useState(true);
    const [buttonText, setButtonText] = useState('Loading Web Workers...');
    const [compileStatus, setCompileStatus] = useState('idle'); // 'idle' | 'loading' | 'stage0' | 'vector' | 'compile' | 'done' | 'error'
    const [progressPercent, setProgressPercent] = useState(0);
    const [stage0Progress, setStage0Progress] = useState(0);
    const [stage12Progress, setStage12Progress] = useState(0);

    const [activeTab, setActiveTab] = useState('stage0'); // 'stage0' | 'stage1_2' | 'stage3'
    const [globalPreviewText, setGlobalPreviewText] = useState('តេស្តពុម្ពអក្សរខ្មែរ ក ខ គ ឃ ០១២៣');
    const [compiledFonts, setCompiledFonts] = useState([]);
    const [selectedGlyph, setSelectedGlyph] = useState(null); // Modal view

    // Popup picker state
    const [activeSlotId, setActiveSlotId] = useState(null);
    const [pickerPosition, setPickerPosition] = useState(null); // { top, left }
    const [pickerCategory, setPickerCategory] = useState('all');
    const [pickerSearch, setPickerSearch] = useState('');

    // Intermediate generation assets cache
    const [generatedRasterCache, setGeneratedRasterCache] = useState({});
    const [generatedVectorCache, setGeneratedVectorCache] = useState({});
    const [generatedVectorData, setGeneratedVectorData] = useState({});

    // ----------------------------------------------------
    // REFS
    // ----------------------------------------------------
    const pyodideWorkerRef = useRef(null);
    const pipelineWorkerRef = useRef(null);
    const wheelBufferRef = useRef(null);
    const donorFontBufferRef = useRef(null);
    const fileInputRefs = useRef({});

    // Maintain refs to avoid stale states in worker closures
    const familyNameRef = useRef(familyName);
    const styleNameRef = useRef(styleName);
    const generatedVectorDataAccumulatorRef = useRef({});

    useEffect(() => { familyNameRef.current = familyName; }, [familyName]);
    useEffect(() => { styleNameRef.current = styleName; }, [styleName]);

    // ----------------------------------------------------
    // INITIALIZATION & LIFECYCLE
    // ----------------------------------------------------
    const spawnAndInitWorkers = () => {
        if (pyodideWorkerRef.current) pyodideWorkerRef.current.terminate();
        if (pipelineWorkerRef.current) pipelineWorkerRef.current.terminate();

        console.log("[App] Spawning Web Workers...");
        const pyWorker = new Worker(new URL('./workers/pyodide.worker.js', import.meta.url));
        const pipeWorker = new Worker(new URL('./workers/pipeline.worker.js', import.meta.url));

        pyodideWorkerRef.current = pyWorker;
        pipelineWorkerRef.current = pipeWorker;

        let pyodideReady = false;
        let pipelineReady = false;

        const checkReady = () => {
            if (pyodideReady && pipelineReady) {
                setBtnDisabled(false);
                setButtonText("Generate Font");
            }
        };

        pyWorker.onmessage = async (e) => {
            const data = e.data;
            if (data.type === "ready") {
                console.log("[App] Pyodide Worker ready.");
                pyodideReady = true;
                checkReady();
            } else if (data.type === "compiled") {
                setCompileStatus('done');
                setProgressPercent(100);
                setStage0Progress(100);
                setStage12Progress(100);
                setButtonText("Generate Font");
                setBtnDisabled(false);

                await saveFont(familyNameRef.current, data.fontBuffer, {
                    styleName: styleNameRef.current,
                    timestamp: Date.now()
                });

                loadCompiledFonts();
                alert(`Compilation finished! Font family '${familyNameRef.current}' generated successfully.`);
                setActiveTab('stage3');
            } else if (data.type === "error") {
                console.error("[App] Pyodide error:", data.message);
                setCompileStatus('error');
                setProgressPercent(0);
                setStage0Progress(0);
                setStage12Progress(0);
                setButtonText("Generate Font");
                setBtnDisabled(false);
                alert(`Compilation failed: ${data.message}`);
            }
        };

        pipeWorker.onmessage = async (e) => {
            const data = e.data;
            if (data.type === "ready") {
                console.log("[App] ONNX Pipeline Worker ready.");
                pipelineReady = true;
                checkReady();
            } else if (data.type === "stage0_done") {
                const { hex, dataUrl, progress } = data;
                setGeneratedRasterCache(prev => ({ ...prev, [hex]: dataUrl }));
                const prog = Math.round((progress - 0.5 / targetGlyphsLengthRef.current) * 95);
                setProgressPercent(prog);
                setStage0Progress(Math.round(progress * 100));
                setButtonText(`Raster Tracing: ${prog}%`);
            } else if (data.type === "stage1_2_done") {
                const { hex, svg, vectorData, progress } = data;
                setGeneratedVectorCache(prev => ({ ...prev, [hex]: svg }));
                setGeneratedVectorData(prev => ({ ...prev, [hex]: vectorData }));
                generatedVectorDataAccumulatorRef.current[hex] = vectorData;
                const prog = Math.round(progress * 95);
                setProgressPercent(prog);
                setStage12Progress(Math.round(progress * 100));
                setButtonText(`Vector Tracing: ${prog}%`);
            } else if (data.type === "stage_error") {
                console.warn(`[App] Glyph U+${data.hex} failed during pipeline:`, data.message);
            } else if (data.type === "done") {
                const accumulatedCount = Object.keys(generatedVectorDataAccumulatorRef.current).length;
                console.log(`[App] ONNX Pipeline execution completed. Accumulated ${accumulatedCount} glyph vectors.`);
                setCompileStatus('compile');
                setProgressPercent(95);
                setStage0Progress(100);
                setStage12Progress(100);
                setButtonText("Stage 3: Compiling TTF...");

                pyWorker.postMessage({
                    type: "compile",
                    vectors: generatedVectorDataAccumulatorRef.current,
                    familyName: familyNameRef.current,
                    styleName: styleNameRef.current
                });
            } else if (data.type === "error") {
                console.error("[App] ONNX error:", data.message);
                setCompileStatus('error');
                setProgressPercent(0);
                setStage0Progress(0);
                setStage12Progress(0);
                setButtonText("Generate Font");
                setBtnDisabled(false);
                alert(`ONNX Pipeline failed: ${data.message}`);
            }
        };

        // Init workers immediately if buffers are cached
        if (wheelBufferRef.current && donorFontBufferRef.current) {
            pyWorker.postMessage({
                type: "init",
                wheelBuffer: wheelBufferRef.current,
                donorFontBuffer: donorFontBufferRef.current,
                pythonCompilerCode
            });

            pipeWorker.postMessage({ type: "init" });
        }
    };

    useEffect(() => {
        // Embossed background mouse reveal overlay tracking
        const handleMouseMove = (e) => {
            document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
            document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
        };
        const handleMouseLeave = () => {
            document.documentElement.style.setProperty('--mouse-x', `-999px`);
            document.documentElement.style.setProperty('--mouse-y', `-999px`);
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        // Initial workers spawn
        spawnAndInitWorkers();

        const initAssets = async () => {
            try {
                const fetchAssetBuffer = async (url) => {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Asset load failure: ${url}`);
                    return await res.arrayBuffer();
                };

                const wheelBuffer = await fetchAssetBuffer(wheelUrl);
                const donorFontBuffer = await fetchAssetBuffer(donorFontUrl);

                wheelBufferRef.current = wheelBuffer;
                donorFontBufferRef.current = donorFontBuffer;

                const current = await getAllFonts();
                if (current.length === 0) {
                    try {
                        const exampleBuffer = await fetchAssetBuffer(generatedFontUrl);
                        await saveFont("Khmer Custom", exampleBuffer, {
                            styleName: "Generated Regular",
                            timestamp: Date.now()
                        });
                    } catch (e) {
                        console.warn("[App] Example font preload failed:", e);
                    }
                }

                loadCompiledFonts();

                // Initialize the already spawned workers
                if (pyodideWorkerRef.current && pipelineWorkerRef.current) {
                    pyodideWorkerRef.current.postMessage({
                        type: "init",
                        wheelBuffer,
                        donorFontBuffer,
                        pythonCompilerCode
                    });

                    pipelineWorkerRef.current.postMessage({ type: "init" });
                }
            } catch (err) {
                console.error("[App] Assets load error: ", err);
                setButtonText("Load Failure");
            }
        };

        initAssets();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
            if (pyodideWorkerRef.current) pyodideWorkerRef.current.terminate();
            if (pipelineWorkerRef.current) pipelineWorkerRef.current.terminate();
        };
    }, []);

    const handleCancel = () => {
        if (!window.confirm("Are you sure you want to cancel the current font generation?")) {
            return;
        }
        setBtnDisabled(true);
        setCompileStatus('idle');
        setProgressPercent(0);
        setStage0Progress(0);
        setStage12Progress(0);
        generatedVectorDataAccumulatorRef.current = {};
        setButtonText("Cancelling...");

        spawnAndInitWorkers();
    };

    // ----------------------------------------------------
    // HANDLERS
    // ----------------------------------------------------
    const loadCompiledFonts = async () => {
        try {
            const fonts = await getAllFonts();
            setCompiledFonts(fonts);
        } catch (e) {
            console.error("[App] Get stored fonts error:", e);
        }
    };

    const handleCardClick = (id) => {
        if (fileInputRefs.current[id]) {
            fileInputRefs.current[id].click();
        }
    };

    const handleFileChange = (id, event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setStyleRefs(prev => prev.map(slot => {
                    if (slot.id === id) {
                        return { ...slot, file, dataUrl: e.target.result };
                    }
                    return slot;
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSelectBtnClick = (id, event) => {
        event.stopPropagation();
        if (activeSlotId === id && pickerPosition) {
            // Toggle close if click same button
            setPickerPosition(null);
            setActiveSlotId(null);
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        let top = rect.bottom + window.scrollY;
        let left = rect.left + window.scrollX;

        // Popup sizing alignments
        const popupWidth = 450;
        const popupHeight = 380;
        if (left + popupWidth > window.innerWidth) {
            left = window.innerWidth - popupWidth - 12;
        }
        if (top + popupHeight > window.innerHeight + window.scrollY) {
            top = rect.top + window.scrollY - popupHeight - 4;
        }

        setPickerPosition({ top, left });
        setActiveSlotId(id);
    };

    const handleSelectGlyphFromPicker = (hex) => {
        setStyleRefs(prev => prev.map(slot => {
            if (slot.id === activeSlotId) {
                return { ...slot, charHex: hex };
            }
            return slot;
        }));
        setPickerPosition(null);
        setActiveSlotId(null);
    };

    const handleGenerateFont = async () => {
        const uploadedSlots = styleRefs.filter(slot => slot.dataUrl !== null);
        if (uploadedSlots.length < 1) {
            alert("Please upload at least 1 style reference drawing before generating.");
            return;
        }

        setBtnDisabled(true);
        setCompileStatus('loading');
        setProgressPercent(0);
        setStage0Progress(0);
        setStage12Progress(0);
        setButtonText("Pre-processing styles...");

        // Reset cached models
        setGeneratedRasterCache({});
        setGeneratedVectorCache({});
        setGeneratedVectorData({});
        generatedVectorDataAccumulatorRef.current = {};
        setActiveTab('stage0');

        try {
            const getPixelData = (dataUrl) => {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = 256;
                        canvas.height = 256;
                        const ctx = canvas.getContext('2d');
                        // Fill canvas with white by default to handle transparent PNG backgrounds
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, 256, 256);
                        ctx.drawImage(img, 0, 0, 256, 256);

                        const imgData = ctx.getImageData(0, 0, 256, 256);
                        const floatArr = new Float32Array(256 * 256);
                        const data = imgData.data;

                        // Detect average color to auto-invert black-on-white drawings to white-on-black
                        let sum = 0;
                        for (let i = 0; i < 256 * 256; i++) {
                            sum += data[i * 4];
                        }
                        const avg = sum / (256 * 256);
                        const shouldInvert = avg > 128;

                        for (let i = 0; i < 256 * 256; i++) {
                            const val = data[i * 4] / 255.0;
                            floatArr[i] = shouldInvert ? (1.0 - val) : val;
                        }
                        resolve(floatArr);
                    };
                    img.onerror = (err) => reject(err);
                    img.src = dataUrl;
                });
            };

            const styleRefsPromises = uploadedSlots.map(slot => getPixelData(slot.dataUrl));
            const styleRefsArrays = await Promise.all(styleRefsPromises);

            const targetGlyphs = getOrderedAndFilteredGlyphs(KHMER_GLYPHS, glyphSetMode);
            targetGlyphsLengthRef.current = targetGlyphs.length;

            setCompileStatus('stage0');
            pipelineWorkerRef.current.postMessage({
                type: "run",
                styleRefs: styleRefsArrays,
                glyphs: targetGlyphs,
                autoregressive: generationMode === "Autoregressive",
                templateInfluenceWeight: templateInfluenceWeight,
                imageInfluenceWeight: imageInfluenceWeight,
                vectorEngine: vectorEngine,
                vtracerParams: {
                    filterSpeckle: vtracerFilterSpeckle,
                    cornerThreshold: vtracerCornerThreshold,
                    lengthThreshold: vtracerLengthThreshold,
                    maxIterations: vtracerMaxIterations,
                    spliceThreshold: vtracerSpliceThreshold
                }
            });
        } catch (e) {
            console.error("[App] Preprocess style images fail: ", e);
            alert("Error preparing style drawings: " + e.message);
            setBtnDisabled(false);
            setButtonText("Generate Font");
        }
    };

    const handleDownloadFont = (name, arrayBuffer) => {
        const blob = new Blob([arrayBuffer], { type: 'font/ttf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/\s+/g, '-')}.ttf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDeleteFont = async (id, name) => {
        if (window.confirm(`Are you sure you want to delete '${name}'?`)) {
            await deleteFont(id);
            loadCompiledFonts();
        }
    };

    const handleVectorEngineToggle = (engine) => {
        setVectorEngine(engine);
        if (engine === 'vtracer') {
            setGenerationMode('Template');
        }
    };

    // Filter characters in selector grid
    const filteredGlyphs = KHMER_GLYPHS.filter(glyph => {
        if (!glyph || !glyph.hex) return false;
        if (pickerCategory !== 'all') {
            if (getGlyphCategory(glyph) !== pickerCategory) return false;
        }
        if (pickerSearch) {
            const query = pickerSearch.toLowerCase().trim();
            const hexMatch = glyph.hex.toLowerCase().includes(query);
            const charMatch = glyph.char && typeof glyph.char === 'string' && glyph.char.toLowerCase().includes(query);
            return hexMatch || charMatch;
        }
        return true;
    });

    return (
        <>
            {/* Ambient tactile reveal background */}
            <div className="reveal-bg-overlay"></div>

            <div className="app-container relative z-10 flex flex-col min-h-screen p-6 gap-6">
                <header className="border-b border-borderTactile pb-4 flex justify-between items-baseline">
                    <h1 className="font-thin  text-xl tracking-widest uppercase"> Khmer Font Factory</h1>
                    <div className="text-[11px]  font-light tracking-wider text-muted uppercase">Client-Side Generation platform</div>
                </header>

                <div className="workspace-grid grid grid-cols-[320px_1fr] gap-6 flex-grow">

                    {/* LEFT PANEL: INPUTS AND STABILITY CONTROLS */}
                    <div className="panel bg-white/45 backdrop-blur-md border border-borderTactile flex flex-col p-5 gap-5 hover:border-muted transition-colors duration-500">
                        <div className="panel-header border-b border-borderTactile pb-2">
                            <span className="font-light text-[12px] tracking-wider uppercase">Style Reference (3-6 Drawings)</span>
                        </div>

                        {/* 6 Upload Cards */}
                        <div className="slots-grid grid grid-cols-3 gap-3">
                            {styleRefs.map(slot => {
                                const matchedGlyph = KHMER_GLYPHS.find(g => g.hex === slot.charHex);
                                return (
                                    <div
                                        key={slot.id}
                                        onClick={() => handleCardClick(slot.id)}
                                        className="slot-card relative aspect-square border border-borderTactile flex flex-col items-center justify-center bg-white/40 cursor-pointer hover:bg-white/60 transition-all duration-300"
                                    >
                                        <input
                                            type="file"
                                            ref={el => fileInputRefs.current[slot.id] = el}
                                            onChange={(e) => handleFileChange(slot.id, e)}
                                            className="hidden"
                                            accept="image/*"
                                        />

                                        {slot.dataUrl ? (
                                            <img src={slot.dataUrl} className="w-[80%] h-[80%] object-contain" alt={`Reference ${slot.id}`} />
                                        ) : (
                                            <span className="text-[10px] tracking-wider text-muted font-light">Slot {slot.id}</span>
                                        )}

                                        <button
                                            type="button"
                                            onClick={(e) => handleSelectBtnClick(slot.id, e)}
                                            className="absolute bottom-1 right-1 text-[10px] bg-primary text-base font-light px-1.5 py-0.5 z-10 hover:bg-muted select-none"
                                        >
                                            {matchedGlyph ? matchedGlyph.char : slot.charHex}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Text input: Font family & Style */}
                        <div className="control-group flex flex-col gap-2">
                            <div className="control-label text-[10px] text-muted tracking-wider uppercase">Font Family Name</div>
                            <input
                                type="text"
                                value={familyName}
                                onChange={(e) => setFamilyName(e.target.value)}
                                className="w-full border border-borderTactile bg-white/45 text-primary text-xs p-2.5 font-light outline-none"
                            />
                        </div>

                        <div className="control-group flex flex-col gap-2">
                            <div className="control-label text-[10px] text-muted tracking-wider uppercase">Font Style Name</div>
                            <input
                                type="text"
                                value={styleName}
                                onChange={(e) => setStyleName(e.target.value)}
                                className="w-full border border-borderTactile bg-white/45 text-primary text-xs p-2.5 font-light outline-none"
                            />
                        </div>

                        {/* Glyph Set Mode Selector */}
                        <div className="control-group flex flex-col gap-2">
                            <div className="control-label text-[10px] text-muted tracking-wider uppercase">Glyph Set Mode</div>
                            <div className="toggle-container flex border border-borderTactile bg-white/45">
                                <button
                                    type="button"
                                    onClick={() => setGlyphSetMode('Essential')}
                                    className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${glyphSetMode === 'Essential' ? 'active' : ''}`}
                                >
                                    Essential
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setGlyphSetMode('Full')}
                                    className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${glyphSetMode === 'Full' ? 'active' : ''}`}
                                >
                                    Full
                                </button>
                            </div>
                        </div>

                        {/* Vector Engine Selector */}
                        <div className="control-group flex flex-col gap-2">
                            <div className="control-label text-[10px] text-muted tracking-wider uppercase">Vector Engine Source</div>
                            <div className="toggle-container flex border border-borderTactile bg-white/45">
                                <button
                                    type="button"
                                    onClick={() => handleVectorEngineToggle('stage2')}
                                    className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${vectorEngine === 'stage2' ? 'active' : ''}`}
                                >
                                    deepVector
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleVectorEngineToggle('vtracer')}
                                    className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${vectorEngine === 'vtracer' ? 'active' : ''}`}
                                >
                                    VTracer
                                </button>
                            </div>
                        </div>

                        {/* Generation Mode Selector */}
                        {vectorEngine !== 'vtracer' && (
                            <div className="control-group flex flex-col gap-2">
                                <div className="control-label text-[10px] text-muted tracking-wider uppercase">Generation Mode</div>
                                <div className="toggle-container flex border border-borderTactile bg-white/45">
                                    <button
                                        type="button"
                                        onClick={() => setGenerationMode('Template')}
                                        className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${generationMode === 'Template' ? 'active' : ''}`}
                                    >
                                        Template
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setGenerationMode('Autoregressive')}
                                        disabled={vectorEngine === 'vtracer'}
                                        className={`toggle-btn flex-1 py-2 text-center text-[11px] font-light tracking-wider uppercase transition-all duration-300 ${generationMode === 'Autoregressive' ? 'active' : ''}`}
                                    >
                                        Autoregressive
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Modality Influence Weight Sliders */}
                        {vectorEngine === 'stage2' && (
                            <div className="control-group flex flex-col gap-3 mt-2">
                                {/* Template Influence Weight */}
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <div className="control-label text-[10px] text-muted tracking-wider uppercase">Template Influence Weight</div>
                                        <div className="text-[10px] font-mono font-medium text-primary">{templateInfluenceWeight.toFixed(2)}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="0.0"
                                            max="2.0"
                                            step="0.05"
                                            value={templateInfluenceWeight}
                                            onChange={(e) => setTemplateInfluenceWeight(parseFloat(e.target.value))}
                                            className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>
                                </div>

                                {/* Raster Influence Weight */}
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <div className="control-label text-[10px] text-muted tracking-wider uppercase">Raster Influence Weight</div>
                                        <div className="text-[10px] font-mono font-medium text-primary">{imageInfluenceWeight.toFixed(2)}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="0.0"
                                            max="2.0"
                                            step="0.05"
                                            value={imageInfluenceWeight}
                                            onChange={(e) => setImageInfluenceWeight(parseFloat(e.target.value))}
                                            className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* VTracer Parameter Controller */}
                        {vectorEngine === 'vtracer' && (
                            <div className="control-group flex flex-col gap-3 mt-2 border-t border-borderTactile pt-3">
                                <div className="control-label text-[10px] text-muted tracking-wider uppercase mb-1">VTracer Tuning</div>

                                {/* Speckle Filter */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[9px] text-muted">
                                        <span>Speckle Filter (Noise)</span>
                                        <span className="font-mono text-primary font-medium">{vtracerFilterSpeckle} px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1"
                                        max="30"
                                        step="1"
                                        value={vtracerFilterSpeckle}
                                        onChange={(e) => setVtracerFilterSpeckle(parseInt(e.target.value))}
                                        className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>

                                {/* Corner Threshold */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[9px] text-muted">
                                        <span>Corner Threshold</span>
                                        <span className="font-mono text-primary font-medium">{vtracerCornerThreshold}°</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="30"
                                        max="120"
                                        step="5"
                                        value={vtracerCornerThreshold}
                                        onChange={(e) => setVtracerCornerThreshold(parseInt(e.target.value))}
                                        className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>

                                {/* Length Threshold */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[9px] text-muted">
                                        <span>Length Threshold (Spline)</span>
                                        <span className="font-mono text-primary font-medium">{vtracerLengthThreshold.toFixed(1)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1.0"
                                        max="20.0"
                                        step="0.5"
                                        value={vtracerLengthThreshold}
                                        onChange={(e) => setVtracerLengthThreshold(parseFloat(e.target.value))}
                                        className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>

                                {/* Max Iterations */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[9px] text-muted">
                                        <span>Smoothing Iterations</span>
                                        <span className="font-mono text-primary font-medium">{vtracerMaxIterations}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1"
                                        max="50"
                                        step="1"
                                        value={vtracerMaxIterations}
                                        onChange={(e) => setVtracerMaxIterations(parseInt(e.target.value))}
                                        className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>

                                {/* Splice Threshold */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[9px] text-muted">
                                        <span>Splice Threshold</span>
                                        <span className="font-mono text-primary font-medium">{vtracerSpliceThreshold}°</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="30"
                                        max="120"
                                        step="5"
                                        value={vtracerSpliceThreshold}
                                        onChange={(e) => setVtracerSpliceThreshold(parseInt(e.target.value))}
                                        className="w-full accent-primary h-1 bg-borderTactile rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleGenerateFont}
                            disabled={btnDisabled}
                            className="btn-action w-full py-3 bg-primary text-base border border-primary text-[11px] font-light tracking-widest uppercase hover:bg-muted hover:border-muted transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                            style={{
                                background: !['idle', 'done', 'error'].includes(compileStatus)
                                    ? `linear-gradient(to right, #E95420 ${progressPercent}%, #44403c ${progressPercent}%)`
                                    : undefined,
                                borderColor: !['idle', 'done', 'error'].includes(compileStatus) ? '#E95420' : undefined,
                                color: '#ffffff'
                            }}
                        >
                            {buttonText}
                        </button>
                        {!['idle', 'done', 'error'].includes(compileStatus) && (
                            <button
                                onClick={handleCancel}
                                className="w-full py-2 bg-transparent text-primary border border-borderTactile text-[10px] font-light tracking-widest uppercase hover:bg-red-50 hover:text-red-600 hover:border-red-600 transition-all duration-300 cursor-pointer mt-2"
                            >
                                Cancel Generation
                            </button>
                        )}

                        {/* Stepper Status tracker */}
                        <div className="stepper-container flex flex-col gap-3 mt-2 border-t border-borderTactile pt-4 items-start w-full">
                            {/* Stage 0 */}
                            <div className="step-row flex flex-col gap-1.5 text-xs w-full text-left">
                                <div className="flex items-center gap-3 w-full justify-start">
                                    <div className={`step-dot w-2 h-2 border border-borderTactile ${compileStatus === 'stage0' ? 'bg-green-500 scale-125' : (['compile', 'done'].includes(compileStatus) ? 'bg-primary' : 'bg-transparent')} transition-all duration-300`}></div>
                                    <span className={compileStatus === 'stage0' ? 'font-normal text-primary' : 'font-light text-muted'}>Stage 0: Raster Synthesis</span>
                                    {stage0Progress > 0 && (
                                        <span className="font-mono text-[10px] text-muted ml-auto font-medium">{stage0Progress}%</span>
                                    )}
                                </div>
                                {['stage0', 'compile', 'done'].includes(compileStatus) && (
                                    <div className="w-full bg-borderTactile h-1 rounded-full overflow-hidden ml-5 max-w-[calc(100%-20px)]">
                                        <div
                                            className="bg-primary h-full transition-all duration-300"
                                            style={{ width: `${stage0Progress}%` }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Stage 1-2 */}
                            <div className="step-row flex flex-col gap-1.5 text-xs w-full text-left">
                                <div className="flex items-center gap-3 w-full justify-start">
                                    <div className={`step-dot w-2 h-2 border border-borderTactile ${compileStatus === 'stage0' ? 'bg-green-500 scale-125' : (['compile', 'done'].includes(compileStatus) ? 'bg-primary' : 'bg-transparent')} transition-all duration-300`}></div>
                                    <span className={compileStatus === 'stage0' ? 'font-normal text-primary' : 'font-light text-muted'}>
                                        {vectorEngine === 'vtracer' ? 'Stage 1-2: Client-side VTracing' : 'Stage 1-2: Model Vectorize'}
                                    </span>
                                    {stage12Progress > 0 && (
                                        <span className="font-mono text-[10px] text-muted ml-auto font-medium">{stage12Progress}%</span>
                                    )}
                                </div>
                                {['stage0', 'compile', 'done'].includes(compileStatus) && (
                                    <div className="w-full bg-borderTactile h-1 rounded-full overflow-hidden ml-5 max-w-[calc(100%-20px)]">
                                        <div
                                            className="bg-primary h-full transition-all duration-300"
                                            style={{ width: `${stage12Progress}%` }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Stage 3 */}
                            <div className="step-row flex items-center gap-3 text-xs w-full justify-start text-left">
                                <div className={`step-dot w-2 h-2 border border-borderTactile ${compileStatus === 'compile' ? 'bg-green-500 scale-125' : (compileStatus === 'done' ? 'bg-primary' : 'bg-transparent')} transition-all duration-300`}></div>
                                <span className={compileStatus === 'compile' ? 'font-normal text-primary font-medium' : 'font-light text-muted'}>Stage 3: Font Assembly</span>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT PANEL: INSPECTOR WORKSPACE */}
                    <div className="panel bg-white/45 backdrop-blur-md border border-borderTactile flex flex-col p-5 gap-5 hover:border-muted transition-colors duration-500 flex-grow">
                        <div className="inspector-layout flex flex-col h-full">
                            <div className="view-modes flex border border-borderTactile bg-white/45 mb-4">
                                <button
                                    onClick={() => setActiveTab('stage0')}
                                    className={`view-mode-btn flex-1 border-none py-2 text-center text-xs tracking-wider uppercase font-light transition-all duration-300 ${activeTab === 'stage0' ? 'active' : 'hover:bg-white/20'}`}
                                >
                                    Stage 0 (Raster)
                                </button>
                                <button
                                    onClick={() => setActiveTab('stage1_2')}
                                    className={`view-mode-btn flex-1 border-none py-2 text-center text-xs tracking-wider uppercase font-light transition-all duration-300 ${activeTab === 'stage1_2' ? 'active' : 'hover:bg-white/20'}`}
                                >
                                    Stage 1-2 (Vectorize)
                                </button>
                                <button
                                    onClick={() => setActiveTab('stage3')}
                                    className={`view-mode-btn flex-1 border-none py-2 text-center text-xs tracking-wider uppercase font-light transition-all duration-300 ${activeTab === 'stage3' ? 'active' : 'hover:bg-white/20'}`}
                                >
                                    Stage 3 (Font Output)
                                </button>
                            </div>

                            {/* TAB 1: STAGE 0 RASTER GRID */}
                            {activeTab === 'stage0' && (
                                <RasterPanel
                                    generatedRasterCache={generatedRasterCache}
                                    glyphs={getOrderedAndFilteredGlyphs(KHMER_GLYPHS, glyphSetMode)}
                                />
                            )}

                            {/* TAB 2: STAGE 1-2 VECTOR GRID */}
                            {activeTab === 'stage1_2' && (
                                <VectorPanel
                                    generatedVectorCache={generatedVectorCache}
                                    setSelectedGlyph={setSelectedGlyph}
                                    glyphs={getOrderedAndFilteredGlyphs(KHMER_GLYPHS, glyphSetMode)}
                                />
                            )}

                            {/* TAB 3: STAGE 3 FONTS GALLERY & PREVIEW */}
                            {activeTab === 'stage3' && (
                                <FontGalleryPanel
                                    compiledFonts={compiledFonts}
                                    globalPreviewText={globalPreviewText}
                                    setGlobalPreviewText={setGlobalPreviewText}
                                    handleDownloadFont={handleDownloadFont}
                                    handleDeleteFont={handleDeleteFont}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* FLOATING CHARACTER GRID PICKER POPUP */}
            {pickerPosition && activeSlotId && (
                <>
                    {/* Background click catcher overlay as sibling */}
                    <div
                        className="fixed inset-0 z-[190] bg-transparent"
                        onClick={() => { setPickerPosition(null); setActiveSlotId(null); }}
                    />

                    <div
                        className="char-picker-popup active absolute bg-white border border-borderTactile shadow-2xl z-[200] w-[450px] h-[380px] flex flex-col p-3"
                        style={{ top: `${pickerPosition.top}px`, left: `${pickerPosition.left}px` }}
                    >
                        <div className="char-picker-search-container mb-2 border border-borderTactile">
                            <input
                                type="text"
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                placeholder="Search Khmer glyph..."
                                autoComplete="off"
                                className="w-full text-xs p-2 font-light outline-none"
                            />
                        </div>
                        <div className="char-picker-tabs flex gap-1 mb-2">
                            {[
                                { key: 'all', label: 'All' },
                                { key: 'kh_consonants', label: 'Cons' },
                                { key: 'kh_vowels', label: 'Vow' },
                                { key: 'kh_number', label: 'Kh Num' },
                                { key: 'eng_char', label: 'Eng' },
                                { key: 'eng_number', label: 'Eng Num' },
                                { key: 'common_sign', label: 'Sign' },
                                { key: 'others', label: 'Others' }
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setPickerCategory(tab.key)}
                                    className={`flex-1 py-1 text-[8px] border border-borderTactile uppercase tracking-widest transition-all duration-200 ${pickerCategory === tab.key ? 'bg-primary text-base' : 'bg-transparent text-primary hover:bg-white/50'}`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <div className="char-picker-grid grid grid-cols-10 gap-1.5 overflow-y-auto flex-grow p-1">
                            {filteredGlyphs.map(glyph => {
                                const currentMapped = styleRefs.find(r => r.id === activeSlotId)?.charHex === glyph.hex;
                                return (
                                    <div
                                        key={glyph.hex}
                                        onClick={() => handleSelectGlyphFromPicker(glyph.hex)}
                                        className={`flex items-center justify-center aspect-square border text-xs cursor-pointer select-none hover:bg-primary hover:text-base transition-colors ${currentMapped ? 'bg-primary text-base font-normal border-primary' : 'bg-white/30 text-primary border-borderTactile'}`}
                                        title={`${glyph.char} (U+${glyph.hex})`}
                                    >
                                        {glyph.char || glyph.hex}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {/* TECHNICAL INSPECTOR MODAL */}
            {selectedGlyph && (
                <VectorModal
                    glyph={selectedGlyph}
                    currentEngine={vectorEngine}
                    generatedVectorCache={generatedVectorCache}
                    onClose={() => setSelectedGlyph(null)}
                />
            )}
        </>
    );
}

// ----------------------------------------------------
// SUBCOMPONENTS
// ----------------------------------------------------

// Modal SVG Inspector canvas drawer
function VectorModal({ glyph, currentEngine, generatedVectorCache, onClose }) {
    const canvasRef = useRef(null);
    const [svgContent, setSvgContent] = useState('');
    const [infoText, setInfoText] = useState(`U+${glyph.hex} | Loading SVG...`);

    // Zoom and pan states
    const [zoom, setZoom] = useState(1.2);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);

    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const panStartRef = useRef({ x: 0, y: 0 });

    // Fetch SVG content
    useEffect(() => {
        if (generatedVectorCache[glyph.hex]) {
            setSvgContent(generatedVectorCache[glyph.hex]);
            const label = currentEngine === 'vtracer' ? 'VTracer Generated SVG' : 'Model Generated SVG';
            setInfoText(`U+${glyph.hex} | ${label}`);
        } else {
            const fetchEngine = currentEngine === 'vtracer' ? 'stage2' : currentEngine;
            fetch(`./output/${fetchEngine}/${glyph.hex}.svg`)
                .then(res => {
                    if (res.ok) return res.text();
                    throw new Error("404");
                })
                .then(text => {
                    setSvgContent(text);
                    const label = fetchEngine === 'stage2' ? 'Model Refined SVG' : 'Traced SVG';
                    setInfoText(`U+${glyph.hex} | ${label}`);
                })
                .catch(() => {
                    setSvgContent('');
                    setInfoText(`U+${glyph.hex} | SVG file not found (Run Pipeline First)`);
                });
        }
    }, [glyph.hex, currentEngine, generatedVectorCache]);

    // Canvas drawing effect
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Clear and redraw
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!svgContent) {
            ctx.fillStyle = '#a8a29e';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("No SVG vector data available for U+" + glyph.hex, canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            return;
        }

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        // Minor gridlines every 16 units
        ctx.strokeStyle = 'rgba(68, 64, 60, 0.05)';
        ctx.lineWidth = 0.5;
        for (let val = 16; val < 256; val += 16) {
            if (val % 64 === 0) continue;
            ctx.beginPath();
            ctx.moveTo(val, 0); ctx.lineTo(val, 256);
            ctx.moveTo(0, val); ctx.lineTo(256, val);
            ctx.stroke();
        }

        // Major gridlines every 64 units
        ctx.strokeStyle = 'rgba(68, 64, 60, 0.12)';
        for (let val = 64; val < 256; val += 64) {
            ctx.beginPath();
            ctx.moveTo(val, 0); ctx.lineTo(val, 256);
            ctx.moveTo(0, val); ctx.lineTo(256, val);
            ctx.stroke();
        }

        // Workspace bounding box
        ctx.strokeStyle = 'rgba(68, 64, 60, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, 256, 256);

        // Baseline: Red horizontal line at y = 187
        const baselineY = 187;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
        ctx.beginPath();
        ctx.moveTo(-20, baselineY);
        ctx.lineTo(276, baselineY);
        ctx.stroke();

        // Origin vertical line at x = 48
        const originX = 48;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
        ctx.beginPath();
        ctx.moveTo(originX, -20);
        ctx.lineTo(originX, 276);
        ctx.stroke();

        // Baseline ticks
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
        for (let x = 0; x <= 256; x += 16) {
            ctx.beginPath();
            ctx.moveTo(x, baselineY - 3);
            ctx.lineTo(x, baselineY + 3);
            ctx.stroke();
        }
        // Origin ticks
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)';
        for (let y = 0; y <= 256; y += 16) {
            ctx.beginPath();
            ctx.moveTo(originX - 3, y);
            ctx.lineTo(originX + 3, y);
            ctx.stroke();
        }

        // Parse and draw SVG curves
        const pathRegex = /<path\s+([^>]+)>/g;
        const transformRegex = /transform=["']([^"']+)["']/;
        const dRegex = /d=["']([^"']+)["']/;
        let match;
        let pathCommands = [];

        while ((match = pathRegex.exec(svgContent)) !== null) {
            const attrsStr = match[1];
            const dMatch = attrsStr.match(dRegex);
            if (!dMatch) continue;

            const d = dMatch[1];
            const transformMatch = attrsStr.match(transformRegex);
            const transformStr = transformMatch ? transformMatch[1] : "";

            let tx = 0.0, ty = 0.0;
            if (transformStr) {
                let transMatch = transformStr.match(/translate\(\s*([+-]?\d*\.\d+|[+-]?\d+)\s*,\s*([+-]?\d*\.\d+|[+-]?\d+)\s*\)/)
                    || transformStr.match(/translate\(\s*([+-]?\d*\.\d+|[+-]?\d+)\s+([+-]?\d*\.\d+|[+-]?\d+)\s*\)/);
                if (transMatch) {
                    tx = parseFloat(transMatch[1]);
                    ty = parseFloat(transMatch[2]);
                }
            }

            const tokens = d.match(/[MmLlCcZz]|[+-]?(?:\d*\.\d+|\d+)/g) || [];
            let i = 0;
            let currX = 0, currY = 0;
            let startX = 0, startY = 0;
            let activeCmd = '';

            while (i < tokens.length) {
                const token = tokens[i];
                if (['M', 'm', 'L', 'l', 'C', 'c', 'Z', 'z'].includes(token)) {
                    activeCmd = token;
                    i++;
                    if (token === 'Z' || token === 'z') {
                        pathCommands.push({ cmd: 'Z', coords: [] });
                        currX = startX; currY = startY;
                    }
                } else {
                    if (activeCmd === 'M' || activeCmd === 'm') {
                        let x = parseFloat(tokens[i]);
                        let y = parseFloat(tokens[i + 1]);
                        i += 2;
                        if (activeCmd === 'm') { x += currX; y += currY; }
                        currX = x; currY = y;
                        startX = x; startY = y;
                        pathCommands.push({ cmd: 'M', coords: [x + tx, y + ty] });
                        activeCmd = activeCmd === 'M' ? 'L' : 'l';
                    } else if (activeCmd === 'L' || activeCmd === 'l') {
                        let x = parseFloat(tokens[i]);
                        let y = parseFloat(tokens[i + 1]);
                        i += 2;
                        if (activeCmd === 'l') { x += currX; y += currY; }
                        currX = x; currY = y;
                        pathCommands.push({ cmd: 'L', coords: [x + tx, y + ty] });
                    } else if (activeCmd === 'C' || activeCmd === 'c') {
                        let x1 = parseFloat(tokens[i]);
                        let y1 = parseFloat(tokens[i + 1]);
                        let x2 = parseFloat(tokens[i + 2]);
                        let y2 = parseFloat(tokens[i + 3]);
                        let x3 = parseFloat(tokens[i + 4]);
                        let y3 = parseFloat(tokens[i + 5]);
                        i += 6;
                        if (activeCmd === 'c') {
                            x1 += currX; y1 += currY;
                            x2 += currX; y2 += currY;
                            x3 += currX; y3 += currY;
                        }
                        currX = x3; currY = y3;
                        pathCommands.push({ cmd: 'C', coords: [x1 + tx, y1 + ty, x2 + tx, y2 + ty, x3 + tx, y3 + ty] });
                    } else {
                        i++;
                    }
                }
            }
        }

        if (pathCommands.length > 0) {
            // Draw orange filled curves
            ctx.beginPath();
            pathCommands.forEach(op => {
                if (op.cmd === 'M') {
                    ctx.moveTo(op.coords[0], op.coords[1]);
                } else if (op.cmd === 'L') {
                    ctx.lineTo(op.coords[0], op.coords[1]);
                } else if (op.cmd === 'C') {
                    ctx.bezierCurveTo(op.coords[0], op.coords[1], op.coords[2], op.coords[3], op.coords[4], op.coords[5]);
                } else if (op.cmd === 'Z') {
                    ctx.closePath();
                }
            });

            ctx.fillStyle = 'rgba(233, 84, 32, 0.85)'; // Ubuntu orange with opacity
            ctx.fill('evenodd');
            ctx.strokeStyle = '#E95420'; // Solid orange borders
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        ctx.restore();
    }, [svgContent, zoom, panX, panY, glyph.hex]);

    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;

            // Re-center on first render
            setPanX((rect.width - 256 * zoom) / 2);
            setPanY((rect.height - 256 * zoom) / 2);
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Drag events
    const handleMouseDown = (e) => {
        isDraggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        panStartRef.current = { x: panX, y: panY };
    };

    const handleMouseMove = (e) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        setPanX(panStartRef.current.x + dx);
        setPanY(panStartRef.current.y + dy);
    };

    const handleMouseUp = () => {
        isDraggingRef.current = false;
    };

    const handleWheel = (e) => {
        e.preventDefault();
        const scaleFactor = 1.1;
        const mouseX = e.nativeEvent.offsetX;
        const mouseY = e.nativeEvent.offsetY;

        const xs = (mouseX - panX) / zoom;
        const ys = (mouseY - panY) / zoom;

        let nextZoom;
        if (e.deltaY < 0) {
            nextZoom = zoom * scaleFactor;
        } else {
            nextZoom = zoom / scaleFactor;
        }

        nextZoom = Math.max(0.2, Math.min(nextZoom, 10));
        setZoom(nextZoom);
        setPanX(mouseX - xs * nextZoom);
        setPanY(mouseY - ys * nextZoom);
    };

    return (
        <div
            onClick={(e) => e.target === e.currentTarget && onClose()}
            className="modal-overlay active fixed inset-0 bg-primary/45 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300"
        >
            <div className="modal-container bg-white border border-borderTactile w-full max-w-[600px] aspect-square flex flex-col p-5 gap-4 relative animate-in fade-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="modal-close absolute top-3 right-3 text-lg font-light hover:text-muted cursor-pointer transition-colors duration-200"
                >
                    ✕
                </button>
                <div className="panel-header border-b border-borderTactile pb-2">
                    <span className="panel-title font-light text-xs tracking-wider uppercase text-primary">
                        Vector Node Inspector (U+{glyph.hex} - {glyph.char})
                    </span>
                </div>

                {/* Large Canvas Viewport */}
                <div className="canvas-viewport bg-white border border-borderTactile flex-grow relative overflow-hidden flex flex-col">
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onWheel={handleWheel}
                        className="w-full h-full cursor-move"
                    />
                    <div className="viewport-info absolute bottom-3 left-3 bg-white/80 border border-borderTactile px-2.5 py-1 text-[10px] text-primary font-light uppercase tracking-wider">
                        {infoText} | Zoom: {Math.round(zoom * 100)}%
                    </div>
                </div>
            </div>
        </div>
    );
}
