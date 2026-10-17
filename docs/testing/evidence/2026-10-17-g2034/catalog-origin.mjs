// Local UI probe for #796. The route-only catalog is deliberately synthetic:
// preview navigation can be checked without publishing guide documents.
import { createServer } from 'node:http';

const catalog = JSON.stringify({
  catalog_schema_version: 1,
  routes: Array.from({ length: 100 }, (_, index) => ({
    route_id: `guide-${String(index + 1).padStart(3, '0')}`,
    version: '1',
    locales: ['be'],
    layers: ['base'],
  })),
});

createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/catalog.json') {
    response.end(catalog);
    return;
  }
  response.statusCode = 404;
  response.end('{}');
}).listen(8796, '127.0.0.1', () => console.log('Synthetic catalog: http://127.0.0.1:8796/catalog.json'));
