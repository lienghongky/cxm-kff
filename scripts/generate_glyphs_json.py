import os
import json
from fontTools.agl import AGL2UV

def get_sort_key(name):
    # Strip suffixes like .sub, .r, .pref, _a, _sub, _low, etc.
    base = name.split('_')[0].split('.')[0]
    try:
        # Parse the first 4 hex chars as an integer
        val = int(base[:4], 16)
        # Sort by Unicode value, then by suffix length, then name alphabetically
        return (val, len(name), name)
    except ValueError:
        # Fallback for non-hex names like A, B, space, etc.
        return (999999, len(name), name)

GLYPH_NAME_MAP = {
    # Digits
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
    
    # Symbols & Punctuation
    'ampersand': '&', 'colon': ':', 'comma': ',', 'period': '.', 'semicolon': ';',
    'backslash': '\\', 'slash': '/', 'plus': '+', 'minus': '-', 'equal': '=',
    'hyphen': '-', 'asterisk': '*', 'exclam': '!', 'question': '?', 'quotedbl': '"',
    'quotesingle': "'", 'parenleft': '(', 'parenright': ')', 'bracketleft': '[',
    'bracketright': ']', 'braceleft': '{', 'braceright': '}', 'percent': '%',
    'dollar': '$', 'at': '@', 'numbersign': '#', 'underscore': '_', 'bar': '|',
    'greater': '>', 'less': '<', 'exclamdown': '¡', 'questiondown': '¿',
    'degree': '°', 'divide': '÷', 'multiply': '×', 'ellipsis': '…',
    'emdash': '—', 'endash': '–', 'bullet': '•', 'paragraph': '¶', 'section': '§',
    'copyright': '©', 'registered': '®', 'trademark': '™', 'Euro': '€',
    'sterling': '£', 'yen': '¥', 'cent': '¢',
    
    # Accents & Components
    'acute': '´', 'grave': '`', 'circumflex': '^', 'tilde': '~', 'macron': '¯',
    'breve': '˘', 'dotaccent': '˙', 'dieresis': '¨', 'ring': '˚', 'cedilla': '¸',
    'hungarumlaut': '˝', 'ogonek': '?', 'caron': 'ˇ', 'dotlessi': 'ı',
    
    # Ligatures & Special Letters
    'ae': 'æ', 'oe': 'œ', 'AE': 'Æ', 'OE': 'Œ',
    'eth': 'ð', 'thorn': 'þ', 'Eth': 'Ð', 'Thorn': 'Þ', 'germandbls': 'ß',
    
    # Unresolved / custom symbols
    'caroncommaaccent': ',',
    'commaaccentrotate': '’',
    'macronmod': '¯',
    'overscore': '‾',
}

def parse_accent_name(name):
    accents = {
        'acute': {'a': 'á', 'e': 'é', 'i': 'í', 'o': 'ó', 'u': 'ú', 'y': 'ý', 'A': 'Á', 'E': 'É', 'I': 'Í', 'O': 'Ó', 'U': 'Ú', 'Y': 'Ý', 'C': 'Ć', 'c': 'ć', 'N': 'Ń', 'n': 'ń', 'R': 'Ŕ', 'r': 'ŕ', 'S': 'Ś', 's': 'ś', 'Z': 'Ź', 'z': 'ź', 'W': 'Ẃ', 'w': 'ẃ', 'L': 'Ĺ', 'l': 'ĺ'},
        'grave': {'a': 'à', 'e': 'è', 'i': 'ì', 'o': 'ò', 'u': 'ù', 'A': 'À', 'E': 'È', 'I': 'Ì', 'O': 'Ò', 'U': 'Ù', 'W': 'Ẁ', 'w': 'ẁ', 'Y': 'Ỳ', 'y': 'ỳ'},
        'circumflex': {'a': 'â', 'e': 'ê', 'i': 'î', 'o': 'ô', 'u': 'û', 'A': 'Â', 'E': 'Ê', 'I': 'Î', 'O': 'Ô', 'U': 'Û', 'W': 'Ŵ', 'w': 'ŵ', 'Y': 'Ŷ', 'y': 'ŷ'},
        'dieresis': {'a': 'ä', 'e': 'ë', 'i': 'ï', 'o': 'ö', 'u': 'ü', 'y': 'ÿ', 'A': 'Ä', 'E': 'Ë', 'I': 'Ï', 'O': 'Ö', 'U': 'Ü', 'Y': 'Ÿ', 'W': 'Ẅ', 'w': 'ẅ'},
        'tilde': {'a': 'ã', 'o': 'õ', 'n': 'ñ', 'A': 'Ã', 'O': 'Õ', 'N': 'Ñ'},
        'macron': {'a': 'ā', 'e': 'ē', 'i': 'ī', 'o': 'ō', 'u': 'ū', 'A': 'Ā', 'E': 'Ē', 'I': 'Ī', 'O': 'Ō', 'U': 'Ū'},
        'breve': {'a': 'ă', 'g': 'ğ', 'u': 'ŭ', 'A': 'Ă', 'G': 'Ğ', 'U': 'Ŭ'},
        'ring': {'a': 'å', 'u': 'ů', 'A': 'Å', 'U': 'Ů'},
        'caron': {'c': 'č', 'd': 'ď', 'e': 'ě', 'l': 'ľ', 'n': 'ň', 'r': 'ř', 's': 'š', 't': 'ť', 'z': 'ž', 'C': 'Č', 'D': 'Ď', 'E': 'Ě', 'L': 'Ľ', 'N': 'Ň', 'R': 'Ř', 'S': 'Š', 'T': 'Ť', 'Z': 'Ž'},
        'cedilla': {'c': 'ç', 'g': 'ģ', 'k': 'ķ', 'l': 'ļ', 'n': 'ņ', 'r': 'ŗ', 's': 'ş', 't': 'ţ', 'C': 'Ç', 'G': 'Ģ', 'K': 'Ķ', 'L': 'Ļ', 'N': 'Ņ', 'R': 'Ŗ', 'S': 'Ş', 'T': 'Ţ'},
        'hungarumlaut': {'o': 'ő', 'u': 'ű', 'A': 'Ő', 'U': 'Ű', 'O': 'Ő'},
        'ogonek': {'a': 'ą', 'e': 'ę', 'i': 'į', 'u': 'ų', 'A': 'Ą', 'E': 'Ę', 'I': 'Į', 'U': 'Ų'},
        'dotaccent': {'e': 'ė', 'g': 'ġ', 'z': 'ż', 'E': 'Ė', 'G': 'Ġ', 'Z': 'Ż', 'I': 'İ', 'c': 'ċ', 'C': 'Ċ'}
    }
    
    for suffix, base_map in accents.items():
        if name.endswith(suffix):
            base_char = name[:-len(suffix)]
            if base_char in base_map:
                return base_map[base_char]
    return None

def hex_to_char(name):
    if name in ('null', 'notdef', 'NULL', '.notdef', 'CR'):
        return ''
    if name == 'space':
        return ' '
    if name == 'nbsp':
        return '\u00a0'
        
    # Check if name is in the hardcoded mapping
    if name in GLYPH_NAME_MAP:
        return GLYPH_NAME_MAP[name]
        
    # Check if name is in AGL
    if name in AGL2UV:
        return chr(AGL2UV[name])
        
    base = name.split('_')[0].split('.')[0]
    if base in AGL2UV:
        return chr(AGL2UV[base])
        
    # Check if name is an accented character word
    accented_char = parse_accent_name(name)
    if accented_char:
        return accented_char

    # Check if base is hexadecimal and is a valid Unicode code point format
    # Standard Unicode hex points are typically 4 hex digits (or multiples of 4)
    # E.g. '1780', '178017B6'. Let's ensure length is at least 4 and multiple of 4,
    # and all characters are hex.
    is_hex = (len(base) >= 4 and 
              len(base) % 4 == 0 and 
              all(c in '0123456789abcdefABCDEF' for c in base))
              
    if not is_hex:
        return name
        
    try:
        chars = []
        for i in range(0, len(base), 4):
            chunk = base[i:i+4]
            if len(chunk) == 4:
                chars.append(chr(int(chunk, 16)))
        return "".join(chars)
    except Exception:
        return name

def main():
    stage0_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "output", "stage0"))
    output_json = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "assets", "glyphs.json"))
    
    print(f"Scanning {stage0_dir}...")
    if not os.path.exists(stage0_dir):
        print(f"Error: Directory {stage0_dir} does not exist.")
        return
        
    files = os.listdir(stage0_dir)
    glyph_names = []
    
    for f in files:
        if f.endswith(".png") and not f.endswith("_preview.png"):
            name = os.path.splitext(f)[0]
            # Skip empty/dummy placeholder names if any
            if name:
                glyph_names.append(name)
                
    # Sort glyphs logically using custom key
    glyph_names.sort(key=get_sort_key)
    
    # Build list of glyph dictionary mapping
    glyphs = []
    for name in glyph_names:
        glyphs.append({
            "hex": name,
            "char": hex_to_char(name)
        })
        
    print(f"Found {len(glyphs)} glyphs. Writing to {output_json}...")
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(glyphs, f, indent=2, ensure_ascii=False)
    print("Done!")

if __name__ == "__main__":
    main()
