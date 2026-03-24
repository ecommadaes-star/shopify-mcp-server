const http = require('http');
const https = require('https');

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const PORT = process.env.PORT || 8080;

if (!SHOPIFY_SHOP || !SHOPIFY_TOKEN) {
  console.error('Fehler: SHOPIFY_SHOP und SHOPIFY_TOKEN müssen als Umgebungsvariablen gesetzt sein.');
  process.exit(1);
}

async function shopifyREST(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SHOPIFY_SHOP,
      path: `/admin/api/2026-01${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function shopifyGraphQL(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: SHOPIFY_SHOP,
      path: '/admin/api/2026-01/graphql.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function handleTool(toolName, args) {
  switch (toolName) {
    case 'get_shop_info': return (await shopifyREST('/shop.json')).data;
    case 'get_products': return (await shopifyREST(`/products.json?limit=${args.limit || 10}`)).data;
    case 'get_product': return (await shopifyREST(`/products/${args.product_id}.json`)).data;
    case 'create_product': return (await shopifyREST('/products.json', 'POST', { product: args })).data;
    case 'update_product': {
      const { product_id, ...updates } = args;
      return (await shopifyREST(`/products/${product_id}.json`, 'PUT', { product: updates })).data;
    }
    case 'get_orders': return (await shopifyREST(`/orders.json?limit=${args.limit || 10}&status=${args.status || 'any'}`)).data;
    case 'get_customers': return (await shopifyREST(`/customers.json?limit=${args.limit || 10}`)).data;
    case 'get_themes': return (await shopifyREST('/themes.json')).data;
    case 'get_pages': return (await shopifyREST('/pages.json')).data;
    case 'create_page': return (await shopifyREST('/pages.json', 'POST', { page: args })).data;
    case 'update_page': {
      const { page_id, ...updates } = args;
      return (await shopifyREST(`/pages/${page_id}.json`, 'PUT', { page: updates })).data;
    }
    case 'get_collections': return (await shopifyREST('/custom_collections.json')).data;
    case 'get_inventory': return (await shopifyREST('/inventory_levels.json')).data;
    case 'graphql_query': return await shopifyGraphQL(args.query, args.variables || {});
    default: return { error: `Unbekanntes Tool: ${toolName}` };
  }
}

const TOOLS = [
  { name: 'get_shop_info', description: 'Shopify Shop-Informationen abrufen', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_products', description: 'Produkte abrufen', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_product', description: 'Einzelnes Produkt abrufen', inputSchema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] } },
  { name: 'create_product', description: 'Neues Produkt erstellen', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body_html: { type: 'string' }, vendor: { type: 'string' } }, required: ['title'] } },
  { name: 'update_product', description: 'Produkt aktualisieren', inputSchema: { type: 'object', properties: { product_id: { type: 'string' }, title: { type: 'string' }, body_html: { type: 'string' } }, required: ['product_id'] } },
  { name: 'get_orders', description: 'Bestellungen abrufen', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, status: { type: 'string' } } } },
  { name: 'get_customers', description: 'Kunden abrufen', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_themes', description: 'Themes abrufen', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_pages', description: 'Seiten abrufen', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_page', description: 'Neue Seite erstellen', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body_html: { type: 'string' }, published: { type: 'boolean' } }, required: ['title', 'body_html'] } },
  { name: 'update_page', description: 'Seite aktualisieren', inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, title: { type: 'string' }, body_html: { type: 'string' } }, required: ['page_id'] } },
  { name: 'get_collections', description: 'Kollektionen abrufen', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_inventory', description: 'Inventar abrufen', inputSchema: { type: 'object', properties: {} } },
  { name: 'graphql_query', description: 'GraphQL-Abfrage an Shopify senden', inputSchema: { type: 'object', properties: { query: { type: 'string' }, variables: { type: 'object' } }, required: ['query'] } },
];

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Shopify MCP Server', shop: SHOPIFY_SHOP, tools: TOOLS.length }));
    return;
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        let response;

        if (request.method === 'initialize') {
          response = { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'shopify-mcp', version: '1.0.0' } } };
        } else if (request.method === 'tools/list') {
          response = { jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } };
        } else if (request.method === 'tools/call') {
          try {
            const result = await handleTool(request.params.name, request.params.arguments || {});
            response = { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
          } catch (err) {
            response = { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: err.message } };
          }
        } else {
          response = { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Shopify MCP Server läuft auf Port ${PORT}`);
  console.log(`Shop: ${SHOPIFY_SHOP}`);
});
