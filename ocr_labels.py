"""Read label fields without confusing PACK, PCS, dates and shipping text."""

from collections import Counter
import re
import unicodedata


FIELDS = ('cell', 'qtyPack', 'prefix', 'zone')


def empty_label():
    return dict.fromkeys(FIELDS)


def normalize(text):
    return unicodedata.normalize('NFKC', text).upper().replace('−', '-').replace('–', '-')


def consensus(values):
    """A disagreement with equal support is unknown, rather than the first match."""
    counts = Counter(value for value in values if value is not None)
    ranked = counts.most_common()
    if not ranked or (len(ranked) > 1 and ranked[0][1] == ranked[1][1]):
        return None
    return ranked[0][0]


def parse_label_text(text):
    text = normalize(text)
    data = empty_label()
    # Prefer the printed cell near PACK over years on another shipping label.
    cells = re.findall(r'(?<![\w.-])(\d{4})\s+(?:\d{1,3}\s+)?PACK\b', text)
    if not cells:
        without_dates = re.sub(r'\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b', '', text)
        cells = re.findall(r'(?<![\w.-])(\d{4})(?![\w.-])', without_dates)
    data['cell'] = consensus(cells)

    # Boundaries prevent 4162 PACK becoming 162 PACK. PCS is a separate field.
    quantities = re.findall(r'(?<![\w.])(\d{1,3})\s+PACK\b', text)
    quantities += re.findall(r'\bPACK\s*[:=]\s*(\d{1,3})(?![\w.])', text)
    data['qtyPack'] = consensus([int(q) for q in quantities if int(q) > 0])

    prefixes = re.findall(r'\b([A-Z1]{2})\s*-', text)
    data['prefix'] = consensus([p.replace('1', 'I') for p in prefixes])
    # A complete one-letter token is required: PCS and MYSELF are not zones.
    locations = re.findall(r'\b([A-Z1]{2})\s*-\s*([A-Z])(?=\s|$|\d)', text)
    zones = [z for p, z in locations if p.replace('1', 'I') == data['prefix']]
    data['zone'] = consensus(zones)
    return data


def parse_mix_text(text):
    data = empty_label()
    # MIX has no prescribed prefix, length or character pattern. Keep OCR
    # regions separate rather than picking a code from ambiguous label text.
    text = re.sub(r'\s+MADE\s+IN\s+CHINA\b.*', '', normalize(text))
    codes = [line.strip() for line in text.splitlines() if line.strip()]
    data['cell'] = consensus(codes)
    return data


def extract_from_variants(raw_results, carton_type):
    parser = parse_mix_text if carton_type == 'mix' else parse_label_text
    parsed = [parser(text) for name, text in raw_results.items()
              if not name.startswith('panel_')]
    return {field: consensus([data[field] for data in parsed]) for field in FIELDS}


def find_label_panels(image_rgb):
    """Find the dark left half of a two-row label, including inside dark frames."""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    scale = min(gray.shape) / 1080
    opening = max(3, int(11 * scale) | 1)
    closing = max(5, int(19 * scale) | 1)
    candidates = []
    for threshold in (80, 100, 120):
        mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)[1]
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((opening, opening), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((closing, closing), np.uint8))
        # RETR_LIST also sees a label enclosed by a black marker or box border.
        for contour in cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]:
            x, y, w, h = cv2.boundingRect(contour)
            if not (.008 < w * h / gray.size < .18 and 1 < w / h < 2.3):
                continue
            if x + 1.95 * w >= gray.shape[1] or cv2.contourArea(contour) / (w * h) < .7:
                continue
            left = gray[y+int(.1*h):y+int(.9*h), x+int(.1*w):x+int(.9*w)]
            right = gray[y+int(.1*h):y+int(.9*h), x+int(1.1*w):x+int(1.9*w)]
            if right.mean() - left.mean() < 40 or (left < threshold).mean() < .5:
                continue
            box = (x, y, w, h)
            if any(abs(x-a) < .2*w and abs(y-b) < .2*h for a, b, _, _ in candidates):
                continue
            candidates.append(box)
    return gray, candidates


def read_label_panel(image_rgb, engine):
    """Read four fixed cells separately so single letters/digits aren't dropped."""
    import cv2

    def tight_crop(crop):
        mask = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        _, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        height, width = crop.shape
        components = [(x, y, w, h) for x, y, w, h, area in stats[1:]
                      if h > height * .35 and w < width * .9 and area > 15
                      and x > 0 and y > 0 and x + w < width and y + h < height]
        if components:
            left = min(c[0] for c in components)
            top = min(c[1] for c in components)
            right = max(c[0] + c[2] for c in components)
            bottom = max(c[1] + c[3] for c in components)
            crop = crop[top:bottom, left:right]
            crop = cv2.copyMakeBorder(crop, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
        return crop

    gray, panels = find_label_panels(image_rgb)
    raw = {}
    proposals = []
    regions = {
        'cell': (.04, .02, .96, .40, True),
        'qtyPack': (1.10, .02, 1.75, .40, False),
        'prefix': (.03, .53, .43, .94, True),
        'zone': (.44, .48, .96, .96, True)
    }
    for index, (x, y, w, h) in enumerate(panels):
        crops = []
        crop_fields = []
        for field, (a, b, c, d, invert) in regions.items():
            crop = gray[y+int(b*h):y+int(d*h), x+int(a*w):x+int(c*w)]
            if invert:
                crop = 255 - crop
            crops.append(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR))
            crop_fields.append((field, ''))
            if field in ('qtyPack', 'zone'):
                coords = ((1.25, .07, 1.68, .38) if field == 'qtyPack'
                          else (.46, .52, .93, .94))
                a, b, c, d = coords
                narrow = gray[y+int(b*h):y+int(d*h), x+int(a*w):x+int(c*w)]
                if invert:
                    narrow = 255 - narrow
                crops.append(cv2.cvtColor(narrow, cv2.COLOR_GRAY2BGR))
                crop_fields.append((field, '_narrow'))
                # Tight glyph bounds remove table rules and the word PACK.
                if field == 'qtyPack':
                    crop = gray[y+int(.04*h):y+int(.40*h),
                                x+int(1.20*w):x+int(1.70*w)]
                crops.append(cv2.cvtColor(tight_crop(crop), cv2.COLOR_GRAY2BGR))
                crop_fields.append((field, '_tight'))
        # Recognition directly on known fields bypasses the detector, which
        # routinely omits the large isolated zone letter and PACK number.
        results, _ = engine.text_recognizer(crops)
        values = {field: [] for field in FIELDS}
        for (field, suffix), (text, score) in zip(crop_fields, results):
            raw[f'panel_{index}_{field}{suffix}'] = text
            text = normalize(text).strip()
            # Single-character CTC scores are lower than scores for full words.
            if float(score) < (.3 if field in ('qtyPack', 'zone') else .5):
                continue
            if field == 'cell' and re.fullmatch(r'\d{4}', text):
                values[field].append(text)
            elif field == 'qtyPack' and re.fullmatch(r'\d{1,3}', text) and int(text) > 0:
                values[field].append(int(text))
            elif field == 'prefix' and re.fullmatch(r'[A-Z1]{2}\s*-?', text):
                values[field].append(text[:2].replace('1', 'I'))
            elif field == 'zone':
                # A small dot from the printed separator can precede the letter.
                text = text.strip(' .,:;')
                if re.fullmatch(r'[A-Z]', text):
                    values[field].append(text)
        data = {field: consensus(candidates) for field, candidates in values.items()}
        # An isolated dark patch elsewhere on a box is not a label panel.
        if data['cell'] and data['prefix']:
            proposals.append(data)
    return {field: consensus([p[field] for p in proposals]) for field in FIELDS}, raw


def find_mix_code_crops(rgb):
    """Find the code row on a large white label, without assuming code format."""
    import cv2
    import numpy as np
    h,w=rgb.shape[:2]
    scale=min(1,1000/max(h,w))
    small=cv2.resize(rgb,None,fx=scale,fy=scale)
    hsv=cv2.cvtColor(small,cv2.COLOR_RGB2HSV)
    mask=cv2.inRange(hsv,np.array([0,0,165]),np.array([179,75,255]))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
    found=[]
    contours = cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:4]:
        x,y,cw,ch=cv2.boundingRect(contour)
        if cw*ch<small.shape[0]*small.shape[1]*.025 or not .55<cw/ch<2.2:continue
        if cv2.contourArea(contour)/(cw*ch)<.65:continue
        x,y,cw,ch=[int(v/scale) for v in (x,y,cw,ch)]
        region=rgb[y+int(ch*.025):y+int(ch*.40),x+int(cw*.07):x+int(cw*.93)]
        gray=cv2.cvtColor(region,cv2.COLOR_RGB2GRAY)
        binary=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)[1]
        rows=(binary>0).sum(axis=1)>max(2,gray.shape[1]*.025)
        runs=[];start=None
        for i,on in enumerate(np.r_[rows,False]):
            if on and start is None:start=i
            if not on and start is not None:
                if i-start>=max(8,ch*.02):runs.append((start,i))
                start=None
        if not runs:continue
        top,bottom=max(runs,key=lambda band:binary[band[0]:band[1]].sum())
        ys,xs=np.where(binary[top:bottom]>0)
        if not len(xs):continue
        left,right=int(xs.min()),int(xs.max())+1
        pad=max(4,int((bottom-top)*.18))
        roi=gray[max(0,top-pad):min(len(gray),bottom+pad),max(0,left-pad):min(gray.shape[1],right+pad)]
        found.append(roi)
    return found

def read_mix_code_fast(rgb, engine):
    """Confirm a cropped code in multiple views; keep full-image OCR as fallback."""
    import cv2
    if not callable(getattr(engine, 'text_recognizer', None)):
        return None, {}
    proposals, raw = [], {}
    for index, roi in enumerate(find_mix_code_crops(rgb)):
        # More processing variants for better recognition
        views = [
            cv2.cvtColor(roi, cv2.COLOR_GRAY2BGR),
            cv2.cvtColor(cv2.createCLAHE(2, (8, 8)).apply(roi), cv2.COLOR_GRAY2BGR),
            cv2.cvtColor(cv2.createCLAHE(3, (8, 8)).apply(roi), cv2.COLOR_GRAY2BGR),
        ]
        # Add binarized variant
        binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        views.append(cv2.cvtColor(255 - binary, cv2.COLOR_GRAY2BGR))
        
        if getattr(engine, 'use_angle_cls', False):
            views, _, _ = engine.text_cls(views)
        results, _ = engine.text_recognizer(views)
        high_conf = []  # >= 0.75
        medium_conf = []  # >= 0.70
        for variant, (text, confidence) in enumerate(results):
            raw[f'panel_mix_{index}_{variant}'] = text
            text_norm = normalize(text).strip()
            conf = float(confidence)
            if conf >= .75 and text_norm:
                high_conf.append(text_norm)
            elif conf >= .70 and text_norm:
                medium_conf.append(text_norm)
        
        # First look for agreement among high confidence (>=0.75)
        if len(high_conf) >= 2 and len(set(high_conf)) == 1:
            proposals.append(high_conf[0])
        # If no high agreement, look for medium (>=0.70) but require majority
        elif len(medium_conf) >= 3:
            code_counts = Counter(medium_conf)
            most_common = code_counts.most_common(1)
            # Need clear majority (at least 3 of 4 match)
            if most_common and most_common[0][1] >= 3:
                proposals.append(most_common[0][0])
    
    unique = set(proposals)
    return (next(iter(unique)) if len(unique) == 1 else None), raw


def recognize_label_image(image_rgb, carton_type, engine):
    """Read known label fields first; run full-image OCR only when needed."""
    import io

    import cv2
    import numpy as np
    from PIL import Image

    raw = {}
    if carton_type == 'mix':
        code, fast_raw = read_mix_code_fast(image_rgb, engine)
        raw.update(fast_raw)
        if code:
            data = empty_label()
            data['cell'] = code
            return data, raw
    panel = empty_label()
    if carton_type != 'mix':
        panel, panel_raw = read_label_panel(image_rgb, engine)
        raw.update(panel_raw)
        if all(panel.values()):
            return panel, raw

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

    def recognize_variant(name, image):
        # Preserve the previous JPEG pixels but avoid temporary disk files.
        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, format='JPEG')
        result, _ = engine(buffer.getvalue())
        if result:
            raw[name] = ('\n' if carton_type == 'mix' else ' ').join(line[1] for line in result)

    if carton_type == 'mix':
        # Оптимізований fallback: спочатку найшвидші варіанти
        recognize_variant('gray', gray)
        gray_code = parse_mix_text(raw.get('gray', ''))['cell']
        if gray_code:
            # Перевіряємо одним додатковим швидким варіантом
            joined = cv2.morphologyEx(gray, cv2.MORPH_OPEN,
                                     cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)))
            recognize_variant('joined', joined)
            joined_code = parse_mix_text(raw.get('joined', ''))['cell']
            if gray_code == joined_code:
                return parse_mix_text(gray_code), raw
        # Якщо швидкі не допомогли, пробуємо решту
        recognize_variant('original', image_rgb)
        if not gray_code:
            contrast = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
            recognize_variant('contrast', contrast)
    else:
        recognize_variant('original', image_rgb)
        dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)[1]
        inverted = np.where(dark_mask > 0, cv2.bitwise_not(gray), gray)
        recognize_variant('inverted', inverted)
        contrast = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
        recognize_variant('contrast', contrast)
        binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        recognize_variant('binary', binary)

    data = extract_from_variants(raw, carton_type)
    for field, value in panel.items():
        if value is not None:
            data[field] = value
    return data, raw
