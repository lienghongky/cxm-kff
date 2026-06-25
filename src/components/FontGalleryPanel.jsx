import React, { useEffect } from 'react';

// Font Gallery card
function FontGalleryCard({ fontItem, previewText, onDownload, onDelete }) {
    const fontName = fontItem.name;
    const styleName = fontItem.metadata.styleName || 'Regular';
    const fontFaceName = `GalleryFont_${fontItem.id}_${fontItem.timestamp}`;
    const timeStr = new Date(fontItem.timestamp).toLocaleDateString([], { hour: '2-digit', minute: '2-digit' });

    useEffect(() => {
        // Register font dynamically in CSS FontFace
        const fontFace = new FontFace(fontFaceName, fontItem.fontBuffer);
        fontFace.load().then(() => {
            document.fonts.add(fontFace);
        }).catch(err => {
            console.error(`[FontCard] Font load failed: ${fontFaceName}`, err);
        });
    }, [fontFaceName, fontItem.fontBuffer]);

    return (
        <div className="gallery-item border border-borderTactile bg-white/40 p-4 flex flex-col gap-3 hover:border-primary transition-all duration-300">
            <div className="gallery-meta flex justify-between text-[11px] text-muted tracking-wider uppercase border-b border-borderTactile/50 pb-1">
                <span className="font-normal text-primary">{fontName} ({styleName})</span>
                <span>{timeStr}</span>
            </div>
            
            {/* Live rendered preview */}
            <div 
                className="gallery-preview text-lg py-2 break-all text-primary font-normal font-sans"
                style={{ fontFamily: `'${fontFaceName}', sans-serif` }}
            >
                {previewText}
            </div>
            
            <div className="gallery-actions flex gap-2 border-t border-borderTactile/50 pt-2">
                <button 
                    onClick={() => onDownload(fontName, fontItem.fontBuffer)}
                    className="flex-1 py-1.5 border border-borderTactile text-[9px] font-light uppercase tracking-wider bg-transparent hover:bg-primary hover:text-base hover:border-primary transition-all duration-300 cursor-pointer"
                >
                    Download TTF
                </button>
                <button 
                    onClick={() => onDelete(fontItem.id, fontName)}
                    className="py-1.5 px-3 border border-red-200 text-red-700 text-[9px] font-light uppercase tracking-wider bg-transparent hover:bg-red-600 hover:text-white hover:border-red-600 transition-all duration-300 cursor-pointer"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

export default function FontGalleryPanel({
    compiledFonts,
    globalPreviewText,
    setGlobalPreviewText,
    handleDownloadFont,
    handleDeleteFont
}) {
    return (
        <div className="bg-white/15 border border-borderTactile flex-grow p-4 overflow-y-auto min-h-[380px] flex flex-col justify-start gap-5">
            <div className="control-group flex flex-col gap-2">
                <div className="control-label text-[10px] text-muted tracking-wider uppercase">Global Preview Text</div>
                <input 
                    type="text" 
                    value={globalPreviewText}
                    onChange={(e) => setGlobalPreviewText(e.target.value)}
                    className="w-full border border-borderTactile bg-white/45 text-primary text-sm p-3 font-light outline-none"
                />
            </div>

            <div className="panel-header border-b border-borderTactile pb-1">
                <span className="panel-title font-light text-[11px] tracking-wider uppercase text-muted">Compiled Output Files</span>
            </div>

            <div className="gallery-list flex flex-col gap-3">
                {compiledFonts.length === 0 ? (
                    <div className="text-[11px] text-muted text-center py-6 tracking-widest uppercase border border-dashed border-borderTactile bg-white/20">
                        No compiled fonts saved yet.<br/>Upload reference drawings and click 'Generate Font' to compile.
                    </div>
                ) : (
                    compiledFonts.map(fontItem => (
                        <FontGalleryCard 
                            key={fontItem.id} 
                            fontItem={fontItem} 
                            previewText={globalPreviewText}
                            onDownload={handleDownloadFont}
                            onDelete={handleDeleteFont}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
