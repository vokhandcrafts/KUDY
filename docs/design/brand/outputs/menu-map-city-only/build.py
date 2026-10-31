"""Extract source-locked city and scene layers, and verify exact reconstruction."""
import base64
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'source.png'
EXPECTED = '72c208a8a14a687f215137511a2b722cc75e2f619bbc0805d4fc3e7c746f80f0'
source_bytes = SOURCE.read_bytes()
assert hashlib.sha256(source_bytes).hexdigest() == EXPECTED, 'Source changed; re-author the masks'
source = cv2.imdecode(np.frombuffer(source_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
height, width = source.shape[:2]
b, g, r, alpha = cv2.split(source)
ground = ((r > 120) & (g > 95) & (b > 50) & (alpha > 0)
          & (r.astype(float) > b.astype(float) * 1.15)).astype(np.uint8)
_, labels, stats, centers = cv2.connectedComponentsWithStats(ground, 8)


def component_near(x, y):
    window = labels[max(0, y-18):y+19, max(0, x-18):x+19]
    candidates, counts = np.unique(window[window > 0], return_counts=True)
    assert len(candidates), f'No ground at {(x, y)}'
    eligible = [(int(count), int(cid)) for cid, count in zip(candidates, counts) if stats[cid, 4] > 3000]
    assert eligible, f'No large ground region at {(x, y)}'
    return max(eligible)[1]


definitions = [
    ('nearby', 'Побач', 'native.chrome.nearby', '/map', [(350, 430)], [330, 485]),
    ('guides', 'Гіды', 'native.chrome.guidesLink', '/city/gdansk/guides', [(600, 500)], [650, 520]),
    ('discovery', 'Чым заняцца', 'native.chrome.whatToDo', '/discovery', [(850, 420), (870, 600)], [850, 420]),
    ('reserve-1', 'Хутка', None, None, [(360, 800)], [360, 800]),
    ('kudy', 'KUDY', 'native.chrome.kudyLink', '/my', [(650, 880)], [650, 880]),
]
water_core = ((g > 85) & (b > 75) & (r < 135)
              & (g.astype(float) > r.astype(float) * 1.25)
              & (b.astype(float) > r.astype(float) * 1.3)).astype(np.uint8)
bridge_polygons = [
    [(309, 643), (338, 653), (318, 682), (299, 668)],
    [(442, 633), (474, 642), (460, 670), (438, 659)],
    [(537, 752), (566, 758), (561, 796), (534, 790)],
    [(696, 688), (726, 695), (731, 769), (700, 770)],
    [(777, 395), (798, 390), (815, 417), (790, 434)],
    [(908, 491), (939, 499), (928, 535), (901, 525)],
]
infrastructure = np.zeros((height, width), np.uint8)
cv2.fillPoly(infrastructure, [np.array(p, np.int32) for p in bridge_polygons], 1)
fortification_keepout = np.zeros_like(infrastructure)
cv2.fillPoly(fortification_keepout, [np.array([(252,810),(281,813),(281,860),(253,852)], np.int32)], 1)
owner = np.full((height, width), 6, np.uint8)
city_masks = []
for index, (pid, title, key, route, seeds, anchor) in enumerate(definitions):
    chosen = {component_near(*seed) for seed in seeds}
    mask = np.isin(labels, list(chosen)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 1, cv2.FILLED)
    if index == 2:
        # The owner's third outline encloses both yellow banks and their internal canal.
        outline = [(670,357),(677,330),(695,313),(742,351),(820,348),(888,329),
                   (925,354),(972,372),(1011,354),(1028,354),(1023,390),(998,406),
                   (1020,475),(1043,535),(1090,538),(1099,551),(1065,589),
                   (1044,607),(1054,660),(1076,680),(1055,707),(1040,748),
                   (1000,778),(970,799),(945,805),(925,819),(915,807),
                   (898,768),(879,725),(872,689),(853,643),(841,602),
                   (819,557),(792,514),(767,475),(735,443),(703,426),
                   (681,409),(674,390)]
        filled[:] = 0
        cv2.fillPoly(filled, [np.array(outline, np.int32)], 1)
    filled = cv2.morphologyEx(filled, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled[:] = 0
    for contour in contours:
        if cv2.contourArea(contour) > 1500:
            smooth = cv2.approxPolyDP(contour, 2, True)
            cv2.drawContours(filled, [smooth], -1, 1, cv2.FILLED)
    if index != 2:
        filled &= (water_core == 0).astype(np.uint8)
    boundary = cv2.distanceTransform(filled, cv2.DIST_L2, 3) < 12
    wall_ink = (r > 70) & (b < 90) & (r.astype(float) > g.astype(float)*1.3)
    filled[boundary & wall_ink] = 0
    filled[fortification_keepout > 0] = 0
    if index != 2:
        filled[infrastructure > 0] = 0
    filled &= (alpha > 0).astype(np.uint8)
    if index == 2:
        filled[owner < 5] = 0
    assert not np.any((filled > 0) & (owner < 5)), 'City masks overlap'
    owner[filled > 0] = index
    city_masks.append(filled)

water = cv2.dilate(water_core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
owner[(owner == 6) & (water > 0)] = 5
owner[(owner == 6) & (infrastructure > 0)] = 5
original_source = source.copy()
ink_corridor = np.zeros((height, width), np.uint8)
cv2.polylines(ink_corridor, [np.array([(668,355),(685,410),(733,440),(780,500),(821,571),(850,630),(872,689)], np.int32)], False, 1, 22)
cv2.polylines(ink_corridor, [np.array([(672,367),(745,393),(794,435),(851,474),(917,500),(976,533),(1002,581),(1004,646),(983,704),(959,761),(935,804)], np.int32)], False, 1, 65)
dark_brown = (r < 150) & (g < 115) & (r.astype(float) > g*1.1) & (g.astype(float) > b*1.15)
dark_bank = ((ink_corridor > 0) & (np.maximum.reduce([r,g,b]) < 120)
             & (b.astype(float) > g*.7) & (g.astype(float) > r*1.3))
recolor = (alpha > 0) & (owner < 5) & (dark_brown | dark_bank)
lum = (r.astype(float)*.3 + g*.59 + b*.11)
source[recolor,0] = np.rint(75+lum[recolor]*.38).clip(0,255)
source[recolor,1] = np.rint(119+lum[recolor]*.46).clip(0,255)
source[recolor,2] = np.rint(148+lum[recolor]*.5).clip(0,255)
assert cv2.imwrite(str(HERE / 'styled-source.png'), source)
assert cv2.imwrite(str(HERE / 'recolor-mask.png'), recolor.astype(np.uint8)*255)
HERE.joinpath('pieces').mkdir(exist_ok=True)
HERE.joinpath('layers').mkdir(exist_ok=True)
HERE.joinpath('source.png').write_bytes(source_bytes)
manifest = {'version': 2, 'source': {'sha256': EXPECTED, 'width': width, 'height': height},
            'pieces': [], 'layers': [], 'gesture': {'holdMs': 300, 'tapSlopDp': 8, 'snapDistanceDp': 22},
            'reveal': {'chargeMs': 650, 'crestMs': 350, 'revealMs': 850, 'settleMs': 450}}
manifest['sceneOnlyPolygons'] = bridge_polygons[:4] + [[(252,810),(281,813),(281,860),(253,852)]]
manifest['renderedSource'] = {'png': 'styled-source.png', 'sha256': hashlib.sha256((HERE / 'styled-source.png').read_bytes()).hexdigest(), 'recoloredPixels': int(recolor.sum())}
restored = np.zeros_like(source)
coverage = np.zeros((height, width), np.uint8)
for index in range(7):
    selected = (owner == index) & (alpha > 0)
    ys, xs = np.nonzero(selected)
    assert len(xs), f'Empty layer {index}'
    x, y, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    pixels = np.zeros_like(source)
    pixels[selected] = source[selected]
    restored[selected] = pixels[selected]
    coverage[selected] += 1
    cropped = pixels[y:bottom, x:right]
    name = definitions[index][0] if index < 5 else ['water', 'fortifications'][index - 5]
    folder = 'pieces' if index < 5 else 'layers'
    file = f'{folder}/{name}.png'
    assert cv2.imwrite(str(HERE / file), cropped)
    if index < 5:
        silhouette = np.full_like(cropped, 255)
        silhouette[:, :, 3] = cropped[:, :, 3]
        assert cv2.imwrite(str(HERE / f'pieces/{name}--light.png'), silhouette)
    mask = selected[y:bottom, x:right].astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    paths = []
    for contour in contours:
        points = cv2.approxPolyDP(contour, .5, True).reshape(-1, 2)
        if len(points) >= 3:
            paths.append('M' + ' L'.join(f'{px},{py}' for px, py in points) + ' Z')
    item = {'id': name, 'x': x, 'y': y, 'width': right-x, 'height': bottom-y,
            'png': file, 'path': ' '.join(paths), 'pixelCount': len(xs)}
    if index < 5:
        _, title, key, route, seeds, anchor = definitions[index]
        item.update(ownerNumber=index+1, label=title, labelKey=key, route=route, anchor=anchor, padding=72, light=f'pieces/{name}--light.png',
                    ui=f'pieces/{name}--ui.png')
        padded_alpha = np.pad(cropped[:, :, 3].astype(float) / 255, 72)
        edge = cv2.dilate(padded_alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        shadow = cv2.GaussianBlur(padded_alpha, (0, 0), 12)
        shadow = np.roll(shadow, 18, axis=0) * .16
        edge = np.maximum(0, edge - padded_alpha) * .95
        foreground = np.pad(cropped[:, :, :3], ((72, 72), (72, 72), (0, 0)))
        under_alpha = edge + shadow * (1-edge)
        out_alpha = padded_alpha + under_alpha * (1-padded_alpha)
        background = np.stack([210*edge+72*shadow*(1-edge), 231*edge+111*shadow*(1-edge),
                               243*edge+145*shadow*(1-edge)], axis=-1)
        numer = foreground * padded_alpha[:, :, None] + background * (1-padded_alpha[:, :, None])
        rgb = np.divide(numer, out_alpha[:, :, None], out=np.zeros_like(numer), where=out_alpha[:, :, None] > 0)
        ui = np.dstack([np.rint(rgb).clip(0, 255).astype(np.uint8), np.rint(out_alpha*255).astype(np.uint8)])
        assert cv2.imwrite(str(HERE / item['ui']), ui)
        manifest['pieces'].append(item)
    else:
        item['interaction'] = 'feedback-only'
        manifest['layers'].append(item)

assert np.all(coverage[alpha > 0] == 1)
assert np.array_equal(restored[:, :, 3], alpha)
assert np.array_equal(restored[alpha > 0], source[alpha > 0]), 'Source pixels changed'
assert cv2.imwrite(str(HERE / 'assembled.png'), restored)
city_only = np.zeros_like(source)
city_only[owner < 5] = source[owner < 5]
assert cv2.imwrite(str(HERE / 'city-only.png'), city_only)
manifest['joints'] = []
boundaries = []
for mask in city_masks:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    points = np.concatenate([cv2.approxPolyDP(c, 4, True).reshape(-1, 2) for c in contours])
    boundaries.append(points.astype(float))
for a in range(5):
    for b in range(a+1, 5):
        distances = ((boundaries[a][:, None, :] - boundaries[b][None, :, :])**2).sum(axis=-1)
        ai, bi = np.unravel_index(distances.argmin(), distances.shape)
        gap = float(np.sqrt(distances[ai, bi]))
        if gap <= 125:
            port = ((boundaries[a][ai]+boundaries[b][bi])/2).round(1).tolist()
            manifest['joints'].append({'a': definitions[a][0], 'b': definitions[b][0], 'port': port, 'gap': round(gap, 1)})
for item in manifest['pieces']:
    item['neighbors'] = [j['b'] if j['a'] == item['id'] else j['a'] for j in manifest['joints'] if item['id'] in (j['a'], j['b'])]
repo = HERE.parents[4]
catalog = json.loads((repo / 'contracts/ui-messages/source.json').read_text(encoding='utf-8'))
base_words = {row['id']: row['source'] for row in catalog['records']}
translations = {'be': base_words}
for locale in ['en', 'uk', 'de', 'es', 'fr', 'cs', 'sv', 'zh']:
    rows = json.loads((repo / f'contracts/ui-messages/translations/{locale}.json').read_text(encoding='utf-8'))
    translations[locale] = {row['id']: row['value'] for row in rows['records']}
manifest['labels'] = {locale: {p['id']: (words.get(p['labelKey'], base_words.get(p['labelKey'], p['label']))
                         if p['labelKey'] else words.get('web.ui.storeComingSoon', p['label'])).removesuffix(' →') for p in manifest['pieces']}
                      for locale, words in translations.items()}
native = 'export const cityMenuAssets = {\n'
for p in manifest['pieces']:
    native += f"  '{p['id']}': {{ city: require('./{p['png']}'), ui: require('./{p['ui']}'), light: require('./{p['light']}') }},\n"
native += '} as const;\nexport const citySceneAssets = {\n'
for layer in manifest['layers']:
    native += f"  {layer['id']}: require('./{layer['png']}'),\n"
native += '} as const;\n'
(HERE / 'native-assets.ts').write_text(native, encoding='utf-8')
native_layout = {'pieces': [], 'layers': [], 'joints': manifest['joints'], 'gesture': manifest['gesture'], 'reveal': manifest['reveal']}
for item in manifest['pieces'] + manifest['layers']:
    image = cv2.imread(str(HERE / item['png']), cv2.IMREAD_UNCHANGED)
    rows = []
    for row in image[:, :, 3] > 32:
        edges = np.flatnonzero(np.diff(np.pad(row.astype(np.int8), (1, 1))))
        rows.append(','.join(str(int(n)) for n in edges))
    entry = {k: item[k] for k in ['id','x','y','width','height']}
    entry['hitRows'] = ';'.join(rows)
    if item in manifest['pieces']:
        entry.update(padding=item['padding'], ownerNumber=item['ownerNumber'])
    native_layout['pieces' if item in manifest['pieces'] else 'layers'].append(entry)
(HERE / 'native-layout.ts').write_text('// Generated by build.py; source-pixel coordinates.\nexport const nativeLayout = '+json.dumps(native_layout, ensure_ascii=False, separators=(',', ':'))+' as const;\n', encoding='utf-8')
(HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
font = base64.b64encode((HERE / 'fonts/GolosText.ttf').read_bytes()).decode('ascii')
def drawing(file, x, y, w, h):
    encoded = base64.b64encode((HERE / file).read_bytes()).decode('ascii')
    return f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="data:image/png;base64,{encoded}"/>'
def caption(value, x, y, size=16):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="#22262B">{value}</text>'
poster = f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650" viewBox="0 0 1200 650"><style>@font-face{{font-family:Golos;src:url(data:font/ttf;base64,{font})}}text{{font-family:Golos,Arial,sans-serif}}</style><rect width="1200" height="650" fill="#FAF7F2"/>'
poster += caption('KUDY · ГОРАД АДКРЫВАЕ КАРТУ', 25, 34, 19)
poster += caption('1. Твае пяць абласцей', 25, 82, 18)+caption('2. Правільнае злучэнне', 425, 82, 18)+caption('3. Святло адкрывае карту', 825, 82, 18)
slots = [(40,170),(200,175),(265,320),(40,370),(165,455)]
scale = .235
for i, item in enumerate(manifest['pieces']):
    sx, sy = slots[i]
    pad = item['padding']
    poster += drawing(item['ui'], sx-pad*scale, sy-pad*scale, (item['width']+2*pad)*scale, (item['height']+2*pad)*scale)
    poster += caption(str(item['ownerNumber']), sx+item['width']*scale/2, sy-12, 16)
    poster += drawing(item['png'], 425+item['x']*scale, 210+item['y']*scale, item['width']*scale, item['height']*scale)
poster += drawing('assembled.png', 825, 210, width*scale, height*scale)
poster += caption('Пяць абласцей з тваёй абводкі',25,595,13)+caption('Тыя ж часткі ў сваіх каардынатах',425,595,13)+caption('Пяць флоў і водгук астатняй карты',825,595,13)
poster += caption('5 гарадскіх PNG + 2 слаі сцэны. Цёмная абводка замененая цёплым пясочным тонам.',25,633,13)+'</svg>'
(HERE / 'proof.svg').write_text(poster, encoding='utf-8')
(HERE / 'proof.html').write_text('<!doctype html><html lang="be"><meta charset="utf-8"><title>KUDY — тры станы зборкі</title><body style="margin:0;background:#faf7f2"><img src="proof.svg" alt="Пяць гарадскіх пунктаў, іх зборка і поўная карта" style="display:block;width:100%"><p style="padding:0 25px;font:14px Arial"><a href="index.html">Інтэрактыўны прыклад</a></p></body></html>', encoding='utf-8')
print(f'PASS: 5 city layers + water + fortifications; {int((alpha > 0).sum())} visible RGBA pixels identical; no missing or overlapping pixels.')
for item in manifest['pieces']:
    print(f"{item['id']}: {item['width']}x{item['height']}; {item['pixelCount']} source pixels")
