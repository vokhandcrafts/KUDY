"""Verify the exported files independently of the extraction process."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert len(manifest['pieces']) == 5 and len(manifest['layers']) == 2
expected_regions = [(1, 'nearby', 330, 485), (2, 'guides', 650, 520),
                    (3, 'discovery', 850, 420), (4, 'reserve-1', 360, 800),
                    (5, 'kudy', 650, 880)]
for number, pid, sx, sy in expected_regions:
    part = next(p for p in manifest['pieces'] if p['id'] == pid)
    assert part.get('ownerNumber') == number, f'Owner-selected region {number} is not assigned'
    px = cv2.imread(str(root / part['png']), cv2.IMREAD_UNCHANGED)
    assert 0 <= sx-part['x'] < part['width'] and 0 <= sy-part['y'] < part['height']
    assert px[sy-part['y'], sx-part['x'], 3] > 0, f'Region {number} misses its selected land'
assert hashlib.sha256((root / 'source.png').read_bytes()).hexdigest() == manifest['source']['sha256']
raw = cv2.imread(str(root / 'source.png'), cv2.IMREAD_UNCHANGED)
original = cv2.imread(str(root / manifest['renderedSource']['png']), cv2.IMREAD_UNCHANGED)
assert hashlib.sha256((root / manifest['renderedSource']['png']).read_bytes()).hexdigest() == manifest['renderedSource']['sha256']
recolor = cv2.imread(str(root / 'recolor-mask.png'), cv2.IMREAD_GRAYSCALE) > 0
assert np.array_equal(original[:, :, 3], raw[:, :, 3])
assert np.array_equal(original[~recolor], raw[~recolor]), 'Changes outside the approved ink mask'
assert int(recolor.sum()) == manifest['renderedSource']['recoloredPixels'] > 0
assert np.all(original[recolor, 2] >= 148) and np.all(original[recolor, 1] >= 119)
reconstructed = np.zeros_like(original)
coverage = np.zeros(original.shape[:2], np.uint8)
excluded = np.zeros(original.shape[:2], np.uint8)
cv2.fillPoly(excluded, [np.array(p, np.int32) for p in manifest['sceneOnlyPolygons']], 1)
for layer in manifest['pieces'] + manifest['layers']:
    pixels = cv2.imread(str(root / layer['png']), cv2.IMREAD_UNCHANGED)
    assert pixels is not None and pixels.shape == (layer['height'], layer['width'], 4)
    mask = pixels[:, :, 3] > 0
    y, x = layer['y'], layer['x']
    area = reconstructed[y:y+layer['height'], x:x+layer['width']]
    area[mask] = pixels[mask]
    coverage[y:y+layer['height'], x:x+layer['width']][mask] += 1
    if layer in manifest['layers']:
        assert not np.any(recolor[y:y+layer['height'], x:x+layer['width']] & mask), 'Scene artwork recolored outside the menu pieces'
    assert int(mask.sum()) == layer['pixelCount']
    if layer in manifest['pieces']:
        assert not np.any(mask & (excluded[y:y+layer['height'], x:x+layer['width']] > 0)), f"Scene infrastructure leaked into {layer['id']}"
        b, g, r, a = cv2.split(pixels)
        blue = (g > 85) & (b > 75) & (r < 135) & (g.astype(float) > r.astype(float)*1.25) & (b.astype(float) > r.astype(float)*1.3)
        if layer['id'] != 'discovery':
            assert not np.any(blue & mask), f"River pixels leaked into {layer['id']}"
        px, py = layer['anchor'][0]-x, layer['anchor'][1]-y
        assert mask[py, px], f"Anchor outside {layer['id']}"
        ui = cv2.imread(str(root / layer['ui']), cv2.IMREAD_UNCHANGED)
        pad = layer['padding']
        assert ui.shape == (layer['height']+pad*2, layer['width']+pad*2, 4)
        center = ui[pad:pad+layer['height'], pad:pad+layer['width']]
        assert np.array_equal(center[pixels[:, :, 3] == 255], pixels[pixels[:, :, 3] == 255])
assert np.all(coverage[original[:, :, 3] > 0] == 1), 'Missing or overlapping source pixels'
assert np.array_equal(reconstructed[original[:, :, 3] > 0], original[original[:, :, 3] > 0])
assert np.array_equal(reconstructed[:, :, 3], original[:, :, 3])
for sx, sy in [(650, 210), (410, 670)]:
    for part in manifest['pieces']:
        if part['x'] <= sx < part['x']+part['width'] and part['y'] <= sy < part['y']+part['height']:
            px = cv2.imread(str(root / part['png']), cv2.IMREAD_UNCHANGED)
            assert px[sy-part['y'], sx-part['x'], 3] == 0, 'Unselected land is a menu control'
ids = {p['id'] for p in manifest['pieces']}
reached = {next(iter(ids))}
while True:
    old = reached.copy()
    for joint in manifest['joints']:
        assert joint['a'] in ids and joint['b'] in ids and joint['gap'] <= 125
        if reached.intersection([joint['a'], joint['b']]):
            reached.update([joint['a'], joint['b']])
    if old == reached:
        break
assert reached == ids, 'Disconnected snap graph'
assert all(layer.get('interaction') == 'feedback-only' for layer in manifest['layers'])
layout_text = (root / 'native-layout.ts').read_text(encoding='utf-8')
layout = json.loads(layout_text[layout_text.index('= ')+2:layout_text.rindex(' as const;')])
for native in layout['pieces'] + layout['layers']:
    asset = next(p for p in manifest['pieces'] + manifest['layers'] if p['id'] == native['id'])
    pixels = cv2.imread(str(root / asset['png']), cv2.IMREAD_UNCHANGED)
    decoded = np.zeros((asset['height'], asset['width']), bool)
    rows = native['hitRows'].split(';')
    assert len(rows) == asset['height']
    for y, row in enumerate(rows):
        edges = list(map(int, row.split(','))) if row else []
        assert len(edges) % 2 == 0
        for start, end in zip(edges[::2], edges[1::2]):
            assert 0 <= start < end <= asset['width']
            decoded[y, start:end] = True
    assert np.array_equal(decoded, pixels[:, :, 3] > 32), f"Native hit map differs from {asset['id']}"
    if asset in manifest['pieces']:
        silhouette = cv2.imread(str(root / asset['light']), cv2.IMREAD_UNCHANGED)
        assert np.array_equal(silhouette[:, :, 3], pixels[:, :, 3])
        assert np.all(silhouette[:, :, :3][pixels[:, :, 3] > 0] == 255)
print(f"PASS: owner regions 1-5; {int(recolor.sum()):,} ink pixels warmed; original geometry unchanged; all {int((original[:, :, 3] > 0).sum()):,} styled pixels restored exactly.")
