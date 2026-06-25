// Pyodide Background Web Worker for Client-Side Font Assembly

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js");

let pyodide = null;

// Handle messages from main thread
self.onmessage = async function (e) {
    const data = e.data;
    
    if (data.type === "init") {
        try {
            console.log("[Worker] Initializing Pyodide runtime...");
            
            // Load Pyodide WASM core
            pyodide = await loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
            });
            
            // Write fonttools wheel file to Pyodide Emscripten Virtual FS
            console.log("[Worker] Mounting fonttools wheel to virtual filesystem...");
            pyodide.FS.writeFile("/fonttools-4.63.0-py3-none-any.whl", new Uint8Array(data.wheelBuffer));
            
            // Extract the wheel using python zipfile module directly
            console.log("[Worker] Unpacking fonttools package offline...");
            await pyodide.runPythonAsync(`
import zipfile
import sys
import os

wheel_path = "/fonttools-4.63.0-py3-none-any.whl"
dest_dir = None
for p in sys.path:
    if p.endswith("site-packages"):
        dest_dir = p
        break
if not dest_dir:
    dest_dir = f"/lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages"

os.makedirs(dest_dir, exist_ok=True)
with zipfile.ZipFile(wheel_path, "r") as zip_ref:
    zip_ref.extractall(dest_dir)
print("fonttools unpacked successfully to:", dest_dir)
`);
            
            // Write donor template font to virtual filesystem
            console.log("[Worker] Mounting donor font template...");
            pyodide.FS.writeFile("/donor_font.ttf", new Uint8Array(data.donorFontBuffer));
            
            // Write compiler script code to virtual filesystem
            console.log("[Worker] Mounting Python font compiler...");
            pyodide.FS.writeFile("/font_compiler.py", data.pythonCompilerCode);
            
            console.log("[Worker] Pyodide environment ready.");
            self.postMessage({ type: "ready" });
        } catch (err) {
            console.error("[Worker] Initialization error: ", err);
            self.postMessage({ type: "error", message: err.message });
        }
    } 
    
    else if (data.type === "compile") {
        if (!pyodide) {
            self.postMessage({ type: "error", message: "Pyodide worker is not initialized yet." });
            return;
        }
        
        try {
            console.log("[Worker] Starting font compilation...");
            
            // Write input vector coordinates to JSON
            const vectorKeys = Object.keys(data.vectors);
            console.log(`[Worker] Received ${vectorKeys.length} glyph vectors for compilation.`);
            const jsonStr = JSON.stringify(data.vectors);
            console.log(`[Worker] Serialized vectors JSON size: ${jsonStr.length} bytes.`);
            pyodide.FS.writeFile("/input_vectors.json", jsonStr);
            
            // Run compilation
            const familyNameEscaped = data.familyName.replace(/"/g, '\\"');
            const styleNameEscaped = data.styleName.replace(/"/g, '\\"');
            
            pyodide.runPython(`
import sys
if '/' not in sys.path:
    sys.path.append('/')
from font_compiler import compile_font
replaced = compile_font(
    "/donor_font.ttf",
    "/input_vectors.json",
    "/output_font.ttf",
    family_name="${familyNameEscaped}",
    style_name="${styleNameEscaped}",
    side_bearing=50
)
print(f"[Worker Python] Compiled successfully. Replaced {replaced} glyphs.")
            `);
            
            // Read output binary bytes from virtual file system
            const compiledBytes = pyodide.FS.readFile("/output_font.ttf");
            
            // Clean up temporary compilation artifacts
            pyodide.FS.unlink("/input_vectors.json");
            pyodide.FS.unlink("/output_font.ttf");
            
            console.log("[Worker] Font compilation finished.");
            
            // Transfer ArrayBuffer back to main thread
            self.postMessage(
                { type: "compiled", fontBuffer: compiledBytes.buffer },
                [compiledBytes.buffer]
            );
        } catch (err) {
            console.error("[Worker] Compilation error: ", err);
            self.postMessage({ type: "error", message: err.message });
        }
    }
};
