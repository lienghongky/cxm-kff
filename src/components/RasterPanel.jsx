import React, { useState, useEffect } from 'react';
import KHMER_GLYPHS from '../assets/glyphs.json';

// Stage 0 raster image rendering with template fallback
function RasterCellImage({ src, fallbackChar, isGenerated }) {
    const [error, setError] = useState(false);
    
    // Reset error when src changes
    useEffect(() => { setError(false); }, [src]);

    if (error || !src) {
        return (
            <div className="text-[24px] text-muted opacity-30 select-none flex items-center justify-center w-full h-full">
                {fallbackChar}
            </div>
        );
    }

    return (
        <img 
            src={src} 
            onError={() => setError(true)}
            className="max-w-full max-h-full object-contain opacity-85 select-none"
            style={{ imageRendering: 'pixelated', filter: 'invert(1)', mixBlendMode: 'multiply' }}
            alt={fallbackChar}
        />
    );
}

export default function RasterPanel({ generatedRasterCache, glyphs = KHMER_GLYPHS }) {
    return (
        <div className="bg-white/15 border border-borderTactile flex-grow p-4 overflow-y-auto min-h-[380px] flex flex-col justify-start items-stretch">
            <div className="grid grid-cols-6 gap-3 w-full">
                {glyphs.map(glyph => {
                    const hasGenerated = generatedRasterCache[glyph.hex];
                    const imgSrc = hasGenerated || null;
                    return (
                        <div 
                            key={glyph.hex} 
                            className="w-full aspect-square relative border border-borderTactile bg-white/40 flex flex-col items-center justify-center p-2"
                        >
                            <span className="absolute top-1 left-1 text-[9px] text-muted font-light">U+{glyph.hex}</span>
                            
                            {/* Image with fallback template rendering */}
                            <div className="absolute inset-3 flex items-center justify-center">
                                <RasterCellImage 
                                    src={imgSrc} 
                                    fallbackChar={glyph.char} 
                                    isGenerated={!!hasGenerated}
                                />
                            </div>

                            <span className="absolute bottom-1 right-1 text-[13px] font-light text-primary">{glyph.char}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
