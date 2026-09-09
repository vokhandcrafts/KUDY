const required = ['style.json', 'sprite.svg', 'glyphs/0-255.json', 'map.svg', 'markers.json'];
const loaded = await Promise.all(required.map(async path => {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`missing local asset: ${path}`);
  return response;
}));
const markers = await loaded[4].json();
const layer = document.querySelector('#markers');
for (const marker of markers) {
  const element = document.createElement('div');
  element.className = `marker ${marker.kind}`;
  element.style.left = `${marker.x}%`;
  element.style.top = `${marker.y}%`;
  element.title = marker.label;
  element.innerHTML = marker.kind === 'locked' ? '🔒' : marker.kind === 'poi' ? '<span>i</span>' : '▶';
  layer.append(element);
}
let zoom = 15, x = 0, y = 0;
const map = document.querySelector('#map');
const output = document.querySelector('#zoom');
const bounds = document.querySelector('#bounds');
function render() {
  const scale = 1 + (zoom - 14) * .35;
  map.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  output.value = zoom;
  bounds.hidden = Math.abs(x) < 280 && Math.abs(y) < 200;
}
document.querySelector('#plus').onclick = () => { zoom = Math.min(16, zoom + 1); render(); };
document.querySelector('#minus').onclick = () => { zoom = Math.max(14, zoom - 1); render(); };
let drag;
const viewport = document.querySelector('#viewport');
viewport.onpointerdown = event => { drag = [event.clientX - x, event.clientY - y]; viewport.setPointerCapture(event.pointerId); };
viewport.onpointermove = event => { if (drag) { x = event.clientX - drag[0]; y = event.clientY - drag[1]; render(); } };
viewport.onpointerup = () => { drag = undefined; };
document.querySelector('#status').textContent = 'ready · local assets verified';
render();
