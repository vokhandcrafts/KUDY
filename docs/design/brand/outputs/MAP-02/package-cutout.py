"""Package the existing transparent PNG as a self-contained hybrid SVG."""

import base64
import argparse
from pathlib import Path
from xml.etree import ElementTree as ET

import cv2


HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', nargs='?', default='map-cutout-v2.png')
name = parser.parse_args().source
if Path(name).name != name or Path(name).suffix.lower() != '.png':
    parser.error('source must be a PNG filename in this script directory')
PNG = HERE / name
pixels = cv2.imread(str(PNG), cv2.IMREAD_UNCHANGED)
assert pixels is not None and pixels.ndim == 3 and pixels.shape[2] == 4
height, width = pixels.shape[:2]
alpha = pixels[:, :, 3]
assert alpha.min() == 0 and alpha.max() == 255
contours, _ = cv2.findContours((alpha >= 128).astype('uint8'), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
paths = []
for contour in contours:
    if abs(cv2.contourArea(contour)) < 2:
        continue
    points = cv2.approxPolyDP(contour, 0.6, True).reshape(-1, 2)
    if len(points) >= 3:
        paths.append('M' + ' L'.join(f'{x},{y}' for x, y in points) + ' Z')
assert paths
outline = ' '.join(paths)
encoded = base64.b64encode(PNG.read_bytes()).decode('ascii')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg"
 xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
 width="{width}" height="{height}" viewBox="0 0 {width} {height}">
 <title>KUDY — карта без вонкавага фону</title>
 <desc>Raster artwork with alpha transparency and an editable vector outer outline. Internal districts are not vectorized.</desc>
 <metadata>Coordinate unit: source PNG pixel. The outline follows the alpha=128 contour with 0.6 px simplification. The PNG is embedded unchanged. This is a hybrid SVG, not a fully vector illustration.</metadata>
 <defs>
  <path id="outer-outline" d="{outline}" fill-rule="evenodd" clip-rule="evenodd"/>
  <clipPath id="outer-cut"><use href="#outer-outline" clip-rule="evenodd"/></clipPath>
 </defs>
 <g id="map-artwork" inkscape:groupmode="layer" inkscape:label="Карта — растр з празрыстасцю">
  <image id="map-image" x="0" y="0" width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/>
 </g>
 <g id="cut-outline-layer" inkscape:groupmode="layer" inkscape:label="Вонкавы контур — уключыць для рэдагавання" style="display:none">
  <use href="#outer-outline" fill="none" stroke="#1d6b4f" stroke-width="2"/>
 </g>
</svg>
'''
root = ET.fromstring(svg)
image = root.find('.//{http://www.w3.org/2000/svg}image')
assert base64.b64decode(image.attrib['href'].split(',', 1)[1]) == PNG.read_bytes()
assert root.attrib['viewBox'] == f'0 0 {width} {height}'
PNG.with_suffix('.svg').write_text(svg, encoding='utf-8')
print(f'Packaged SVG: {width} x {height}; {len(paths)} outer contour subpaths; embedded PNG byte-identical.')
