// Live Typing Sandbox and Font Loader Component

import { getAllFonts } from '../utils/storage.js';

export function initFontTypingSandbox() {
    const fileZone = document.getElementById('font-dropzone');
    const fileInput = document.getElementById('font-file-input');
    const textarea = document.querySelector('.sandbox-textarea');
    const uploadText = document.querySelector('.font-upload-text');
    
    const sizeSlider = document.getElementById('sb-font-size');
    const spacingSlider = document.getElementById('sb-letter-spacing');
    const heightSlider = document.getElementById('sb-line-height');
    
    const fontNameLabel = document.getElementById('lbl-font-name');
    const fontSizeLabel = document.getElementById('sb-font-size-val');
    const fontSpacingLabel = document.getElementById('sb-letter-spacing-val');
    const fontHeightLabel = document.getElementById('sb-line-height-val');
    const historySelect = document.getElementById('sb-history-select');

    if (!fileZone || !fileInput || !textarea) {
        console.warn("[Sandbox] Missing DOM elements for font typing sandbox.");
        return;
    }

    // Handle Upload zone click
    fileZone.addEventListener('click', () => fileInput.click());

    // File selection
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            loadCustomFont(fileInput.files[0]);
        }
    });

    // Drag-and-drop
    fileZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileZone.style.borderColor = '#44403c';
    });

    fileZone.addEventListener('dragleave', () => {
        fileZone.style.borderColor = '#a8a29e';
    });

    fileZone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileZone.style.borderColor = '#a8a29e';
        if (e.dataTransfer.files.length > 0) {
            loadCustomFont(e.dataTransfer.files[0]);
        }
    });

    // Refresh history select list
    async function refreshHistoryList() {
        if (!historySelect) return;
        try {
            const fonts = await getAllFonts();
            
            // Save current value
            const currentVal = historySelect.value;
            
            historySelect.innerHTML = '<option value="">-- No stored font selected --</option>';
            
            fonts.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                opt.textContent = `${item.name} (${timeStr})`;
                historySelect.appendChild(opt);
            });
            
            // Restore selection if still present
            historySelect.value = currentVal;
            
            // Store globally to load by ID
            window.storedCompiledFonts = fonts;
        } catch (err) {
            console.error("Failed to load font compilation history: ", err);
        }
    }

    // Load stored font from IndexedDB selection
    if (historySelect) {
        historySelect.addEventListener('change', () => {
            const val = historySelect.value;
            if (!val || !window.storedCompiledFonts) {
                // Restore default font
                textarea.style.fontFamily = "'Outfit', sans-serif";
                fontNameLabel.textContent = "Font: Default (Outfit)";
                return;
            }
            
            const fontItem = window.storedCompiledFonts.find(item => item.id == val);
            if (fontItem) {
                registerFontFaceBytes(fontItem.name, fontItem.fontBuffer);
            }
        });
    }

    async function loadCustomFont(file) {
        const fontName = file.name.replace(/\.[^/.]+$/, ""); // Strip extension
        uploadText.textContent = `Font loaded: ${file.name}`;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            registerFontFaceBytes(fontName, e.target.result);
        };
        reader.readAsArrayBuffer(file);
    }

    async function registerFontFaceBytes(name, arrayBuffer) {
        try {
            const fontFaceName = `CustomTestFont_${Date.now()}`;
            const fontFace = new FontFace(fontFaceName, arrayBuffer);
            await fontFace.load();
            document.fonts.add(fontFace);
            
            textarea.style.fontFamily = fontFaceName;
            fontNameLabel.textContent = `Font: ${name}`;
            console.log(`[SYSTEM] Registered fontFace: ${name} dynamically`);
        } catch (err) {
            console.error("Font loading error: ", err);
            uploadText.textContent = "Failed to load Font face";
        }
    }

    // Sliders event listeners
    if (sizeSlider) {
        sizeSlider.addEventListener('input', () => {
            const val = sizeSlider.value;
            textarea.style.fontSize = `${val}px`;
            if (fontSizeLabel) fontSizeLabel.textContent = `${val}px`;
        });
    }

    if (spacingSlider) {
        spacingSlider.addEventListener('input', () => {
            const val = spacingSlider.value;
            const emVal = (val / 100).toFixed(2);
            textarea.style.letterSpacing = `${emVal}em`;
            if (fontSpacingLabel) fontSpacingLabel.textContent = `${emVal}em`;
        });
    }

    if (heightSlider) {
        heightSlider.addEventListener('input', () => {
            const val = parseFloat(heightSlider.value).toFixed(1);
            textarea.style.lineHeight = val;
            if (fontHeightLabel) fontHeightLabel.textContent = val;
        });
    }

    // Initialize list and listen to external compile updates
    refreshHistoryList();
    window.addEventListener('font-compiled-update', refreshHistoryList);
}
