import React, { useState, useEffect } from 'react';
import KHMER_GLYPHS from '../assets/glyphs.json';

const svgToBase64 = (svg) => {
    try {
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    } catch (e) {
        console.error("Failed to convert SVG to base64", e);
        return "";
    }
};



// Stage 1-2 vector SVG rendering with fallback
function VectorCellImage({ src, fallbackChar }) {
    const [error, setError] = useState(false);

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
            alt={fallbackChar}
        />
    );
}

export default function VectorPanel({ generatedVectorCache, setSelectedGlyph, glyphs = KHMER_GLYPHS }) {
    return (
        <div className="bg-white/15 border border-borderTactile flex-grow p-4 overflow-y-auto min-h-[380px] flex flex-col justify-start items-stretch">
            <div className="grid grid-cols-6 gap-3 w-full">
                {glyphs.map(glyph => {
                    let src = null;
                    let isModelGenerated = false;

                    if (generatedVectorCache[glyph.hex]) {
                        src = svgToBase64(generatedVectorCache[glyph.hex]);
                        isModelGenerated = true;
                    }

                    return (
                        <div
                            key={glyph.hex}
                            onClick={() => setSelectedGlyph(glyph)}
                            className="w-full aspect-square relative border border-borderTactile bg-white/40 flex flex-col items-center justify-center p-2 cursor-pointer hover:border-primary hover:bg-white/60 transition-all duration-300"
                        >
                            <span className="absolute top-1 left-1 text-[9px] text-muted font-light">U+{glyph.hex}</span>

                            <div className="absolute inset-3 flex items-center justify-center">
                                <VectorCellImage
                                    src={src}
                                    fallbackChar={glyph.char}
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
