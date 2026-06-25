import os
import json
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen

# Khmer script categories for position tracking
KHMER_DEP_VOWELS_ABOVE = {0x17B7, 0x17B8, 0x17B9, 0x17BA, 0x17BE}
KHMER_DEP_VOWELS_BELOW = {0x17BB, 0x17BC, 0x17BD}
KHMER_SIGNS_ABOVE = {0x17C6, 0x17C9, 0x17CA, 0x17CB, 0x17CC, 0x17CD, 0x17CE, 0x17CF, 0x17D0, 0x17D1, 0x17D3, 0x17DD}

def get_area(contour):
    """Calculate the signed area of a polygon contour to determine winding direction."""
    area = 0.0
    pts = [p[2] for p in contour]
    n = len(pts)
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        area += (p1[0] * p2[1] - p2[0] * p1[1])
    return area

def compile_font(donor_path, json_vectors_path, output_path, family_name="Khmer Custom", style_name="Regular", side_bearing=50):
    if not os.path.exists(donor_path):
        raise FileNotFoundError(f"Donor template font not found: {donor_path}")
        
    if not os.path.exists(json_vectors_path):
        raise FileNotFoundError(f"Vector JSON input not found: {json_vectors_path}")

    # Load NotoSansKhmer donor template font
    donor = TTFont(donor_path)
    
    # Strip variable tables to ensure static compilation compatibility
    for tag in ['gvar', 'avar', 'fvar', 'HVAR', 'STAT']:
        if tag in donor:
            del donor[tag]
            
    ascender = donor['hhea'].ascender
    descender = donor['hhea'].descender
    units_per_em = donor['head'].unitsPerEm

    # Load JS-generated vectors from JSON file
    with open(json_vectors_path, 'r', encoding='utf-8') as f:
        generated_glyphs = json.load(f)

    print(f"[font_compiler] Input glyphs received: {len(generated_glyphs)}")

    # Conversion matrix parameters matching standard pipeline configurations
    norm_factor = 0.90 / (ascender - descender)
    y_shift_norm = 0.5 - ((descender + ascender) / 2.0) * (0.90 / (ascender - descender))

    substituted_glyphs = {}
    skipped_glyphs = []
    for char_hex, data in generated_glyphs.items():
        c_cmds = data.get("commands", [])
        c_coords = data.get("coords", [])
        
        # Parse char hex to code point
        char_code = None
        if len(char_hex) == 4 and all(c in '0123456789abcdefABCDEF' for c in char_hex):
            char_code = int(char_hex, 16)
        elif "_" in char_hex:
            parts = char_hex.split("_")
            if len(parts[0]) == 4:
                char_code = int(parts[0], 16)

        if char_hex == "space": char_code = 0x0020
        elif char_hex == "nbsp": char_code = 0x00A0
        elif char_hex == "25CC": char_code = 0x25CC

        # Establish mapping for unicode sub and alt variants
        glyph_name = char_hex
        if "_" in char_hex:
            parts = char_hex.split("_")
            glyph_name = f"uni{parts[0]}.{parts[1]}"
        elif len(char_hex) >= 4 and len(char_hex) % 4 == 0 and all(c in '0123456789abcdefABCDEF' for c in char_hex):
            glyph_name = f"uni{char_hex}"

        donor_glyph_name = glyph_name
        if char_hex == 'notdef': donor_glyph_name = '.notdef'
        elif char_hex == 'null': donor_glyph_name = 'NULL'
        elif glyph_name.endswith('.sub'):
            base = glyph_name[:-4]
            if base.startswith('uni'):
                donor_glyph_name = f"uni17D2{base[3:]}"
        elif glyph_name == 'uni179A.pref': donor_glyph_name = 'uni17D2179A'
        elif glyph_name == 'nbsp': donor_glyph_name = 'uni00A0'
        elif glyph_name == 'uni17CC.alt': donor_glyph_name = 'uni17CC.r'

        # Scale coordinates to FUnits (EM grid size) using pure Python floats/ints
        sx_scaled = []
        sy_scaled = []
        for coord in c_coords:
            # Map normalized model coordinates to raw font design units
            # x values: indices 0, 2, 4
            # y values: indices 1, 3, 5
            x_vals = [
                int(round(coord[0] / norm_factor)),
                int(round(coord[2] / norm_factor)),
                int(round(coord[4] / norm_factor))
            ]
            y_vals = [
                int(round(((1.0 - coord[1]) - y_shift_norm) / norm_factor)),
                int(round(((1.0 - coord[3]) - y_shift_norm) / norm_factor)),
                int(round(((1.0 - coord[5]) - y_shift_norm) / norm_factor))
            ]
            sx_scaled.append(x_vals)
            sy_scaled.append(y_vals)

        # Collect points bounds to calculate bounding box and side bearings
        valid_pts = []
        for cmd, x_row, y_row in zip(c_cmds, sx_scaled, sy_scaled):
            if cmd == 3: # EOS
                break
            if cmd == 0 or cmd == 1:
                valid_pts.append((x_row[2], y_row[2]))
            elif cmd == 2:
                valid_pts.append((x_row[0], y_row[0]))
                valid_pts.append((x_row[1], y_row[1]))
                valid_pts.append((x_row[2], y_row[2]))

        if not valid_pts:
            skipped_glyphs.append((char_hex, donor_glyph_name, 'no valid points'))
            continue

        x_min = min(p[0] for p in valid_pts)
        x_max = max(p[0] for p in valid_pts)
        y_min = min(p[1] for p in valid_pts)
        y_max = max(p[1] for p in valid_pts)

        substituted_glyphs[donor_glyph_name] = {
            "commands": c_cmds,
            "sx": sx_scaled,
            "sy": sy_scaled,
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
            "is_mark_abv": char_code in KHMER_SIGNS_ABOVE or char_code in KHMER_DEP_VOWELS_ABOVE,
            "is_mark_blw": char_code in KHMER_DEP_VOWELS_BELOW
        }

    print(f"[font_compiler] Substituted map entries: {len(substituted_glyphs)}")
    print(f"[font_compiler] Skipped glyphs: {len(skipped_glyphs)}")
    for hex_val, donor_name, reason in skipped_glyphs:
        print(f"  SKIP: {hex_val} -> {donor_name}: {reason}")

    # Re-apply glyph replacements inside donor outline table
    replaced_count = 0
    donor_order = donor.getGlyphOrder()
    
    # Helper to check base mapping matches substituted keys
    def find_base_glyph(name, sub_map):
        if name in sub_map:
            return name
        base_part = name.split('.')[0]
        if base_part in sub_map:
            return base_part
        if name.startswith('uni'):
            hex_str = base_part[3:]
            chunks = [hex_str[i:i+4] for i in range(0, len(hex_str), 4)]
            if hex_str.startswith('17D2') and len(chunks) == 2:
                candidate = f"uni17D2{chunks[1]}"
                if candidate in sub_map:
                    return candidate
            elif len(chunks) == 1:
                candidate = f"uni{chunks[0]}"
                if candidate in sub_map:
                    return candidate
        return None

    for name in donor_order:
        base_name = find_base_glyph(name, substituted_glyphs)
        if not base_name:
            continue
        
        try:
            g_d = donor['glyf'][name]
            g_d.recalcBounds(donor['glyf'])
            if not (hasattr(g_d, 'xMin') and g_d.xMin is not None):
                continue

            orig_xMin, orig_yMin, orig_xMax, orig_yMax = g_d.xMin, g_d.yMin, g_d.xMax, g_d.yMax
            base_data = substituted_glyphs[base_name]
            c_cmds = base_data["commands"]
            sx = base_data["sx"]
            sy = base_data["sy"]
            x_min, x_max, y_min, y_max = base_data["x_min"], base_data["x_max"], base_data["y_min"], base_data["y_max"]
            is_mark_abv = base_data["is_mark_abv"]
            is_mark_blw = base_data["is_mark_blw"]

            w_gen = x_max - x_min
            h_gen = y_max - y_min
            w_orig = orig_xMax - orig_xMin
            h_orig = orig_yMax - orig_yMin

            if w_gen > 0 and h_gen > 0 and w_orig > 0 and h_orig > 0:
                is_below = is_mark_blw or name.startswith('uni17D2') or '.sub' in name or '.pref' in name
                is_above = is_mark_abv
                is_mark_or_sub = is_above or is_below

                # Scale and translate generated glyph bounds to match template metrics
                scale = float(max(w_orig, h_orig)) / float(max(w_gen, h_gen))
                shift_y = float(orig_yMin) - float(y_min) * scale
                
                if is_mark_or_sub:
                    shift_x = orig_xMin + (w_orig - w_gen * scale) / 2.0
                else:
                    shift_x = side_bearing
                    adv = int(w_gen * scale + 2 * side_bearing)
                    lsb = int(side_bearing)
                    donor['hmtx'][name] = (adv, lsb)

                # Apply layout matrix scaling
                sx_final = []
                sy_final = []
                for rx, ry in zip(sx, sy):
                    sx_final.append([
                        int(round(shift_x + (rx[0] - x_min) * scale)),
                        int(round(shift_x + (rx[1] - x_min) * scale)),
                        int(round(shift_x + (rx[2] - x_min) * scale))
                    ])
                    sy_final.append([
                        int(round(shift_y + ry[0] * scale)),
                        int(round(shift_y + ry[1] * scale)),
                        int(round(shift_y + ry[2] * scale))
                    ])
            else:
                sx_final = sx
                sy_final = sy

            # Build Glyph Pen
            pen = TTGlyphPen(donor.getGlyphSet())
            cu2qu_pen = Cu2QuPen(pen, max_err=1.0, reverse_direction=False)
            
            # Segregate commands into sub-contours
            contours, current = [], []
            for cmd, rx, ry in zip(c_cmds, sx_final, sy_final):
                if cmd == 3: # EOS
                    break
                if cmd == 0: # moveTo
                    if current:
                        contours.append(current)
                    current = [(cmd, rx, ry)]
                else:
                    current.append((cmd, rx, ry))
            if current:
                contours.append(current)

            if contours:
                # Reconstruct winding direction contours to prevent overlaps
                areas = [get_area(c) for c in contours]
                max_idx = 0
                max_val = -1.0
                for k, val in enumerate(areas):
                    if abs(val) > max_val:
                        max_val = abs(val)
                        max_idx = k

                for k, contour in enumerate(contours):
                    is_outer = (k == max_idx)
                    # Outer contour should be clockwise (area > 0), inner contours counter-clockwise
                    should_reverse = (areas[k] < 0) if is_outer else (areas[k] > 0)
                    
                    if should_reverse:
                        rec = RecordingPen()
                        for p in contour:
                            if p[0] == 0: rec.moveTo((p[1][2], p[2][2]))
                            elif p[0] == 1: rec.lineTo((p[1][2], p[2][2]))
                            else: rec.curveTo((p[1][0], p[2][0]), (p[1][1], p[2][1]), (p[1][2], p[2][2]))
                        rec.closePath()
                        rec.replay(ReverseContourPen(cu2qu_pen))
                    else:
                        for p in contour:
                            if p[0] == 0: cu2qu_pen.moveTo((p[1][2], p[2][2]))
                            elif p[0] == 1: cu2qu_pen.lineTo((p[1][2], p[2][2]))
                            else: cu2qu_pen.curveTo((p[1][0], p[2][0]), (p[1][1], p[2][1]), (p[1][2], p[2][2]))
                        cu2qu_pen.closePath()

            # Update glyph outlines
            tt_glyph = pen.glyph()
            tt_glyph.recalcBounds(donor['glyf'])
            donor['glyf'][name] = tt_glyph
            replaced_count += 1
        except Exception as e:
            print(f"[font_compiler] ERROR compiling glyph '{name}' (base: '{base_name}'): {e}")

    # Update metadata names in name table
    ps_name = f"{family_name.replace(' ', '')}-{style_name}"
    for record in donor['name'].names:
        if record.nameID == 1: # Font Family
            record.string = family_name.encode(record.getEncoding())
        elif record.nameID == 2: # Font Subfamily
            record.string = style_name.encode(record.getEncoding())
        elif record.nameID == 4: # Full Name
            record.string = f"{family_name} {style_name}".encode(record.getEncoding())
        elif record.nameID == 6: # PostScript Name
            record.string = ps_name.encode(record.getEncoding())

    donor.save(output_path)
    return replaced_count

if __name__ == "__main__":
    # Test script locally if needed
    print("Font compiler module loaded successfully.")
