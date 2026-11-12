// Run inside the production image with --network none; no real credentials are used.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

const tunnelId = 'tunnel_0123456789abcdef0123456789abcdef';
const testEnvironment = {
  ...process.env,
  PICNIC_USERNAME: 'docker-smoke@example.invalid',
  PICNIC_PASSWORD: 'dummy-password',
  PICNIC_COUNTRY_CODE: 'DE',
  CONTROL_PLANE_TUNNEL_ID: tunnelId,
  CONTROL_PLANE_API_KEY: 'dummy-runtime-key',
  LOG_LEVEL: 'warn',
};

async function main() {
  assert.notEqual(process.getuid(), 0, 'The container must run without root privileges');
  assert.equal(existsSync('/app/.env'), false, 'The image must not contain .env');
  assert.equal(existsSync('/app/test'), false, 'The runtime must not contain tests');

  for (const name of ['PICNIC_USERNAME', 'PICNIC_PASSWORD', 'CONTROL_PLANE_TUNNEL_ID', 'CONTROL_PLANE_API_KEY']) {
    const environment = { ...testEnvironment };
    delete environment[name];
    const result = spawnSync('picnic-tunnel', ['run'], { env: environment, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0, `Missing ${name} must stop startup`);
    assert.match(result.stderr, new RegExp(`${name} fehlt`));
  }

  const invalidCountry = spawnSync('picnic-tunnel', ['run'], {
    env: { ...testEnvironment, PICNIC_COUNTRY_CODE: 'XX' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(invalidCountry.status, 0);
  assert.match(invalidCountry.stderr, /PICNIC_COUNTRY_CODE muss DE, NL oder FR sein/);

  // Only Picnic's external HTTP calls are stubbed. The bundled MCP server,
  // STDIO transport and tunnel-client all run unchanged with no network access.
  const mockPath = '/tmp/picnic-smoke-fetch.cjs';
  writeFileSync(mockPath, `
    const assert = require('node:assert/strict');
    globalThis.fetch = async (rawUrl, options = {}) => {
      const url = new URL(rawUrl);
      assert.equal(url.origin, 'https://storefront-prod.de.picnicinternational.com');
      if (url.pathname === '/api/15/user/login') {
        assert.notEqual(process.env.SMOKE_REUSE_SESSION, 'true', 'Saved session must prevent another login');
        assert.equal(JSON.parse(options.body).key, 'docker-smoke@example.invalid');
        return Response.json({ second_factor_authentication_required: true }, {
          headers: { 'x-picnic-auth': 'dummy-pending-auth' },
        });
      }
      const headers = new Headers(options.headers);
      assert.match(headers.get('x-picnic-did'), /^[A-F0-9]{16}$/);
      if (process.env.SMOKE_EXPECTED_DEVICE_ID) {
        assert.equal(headers.get('x-picnic-did'), process.env.SMOKE_EXPECTED_DEVICE_ID);
      }
      if (url.pathname === '/api/15/user/2fa/generate') {
        assert.equal(JSON.parse(options.body).channel, 'SMS');
        assert.equal(headers.get('x-picnic-auth'), 'dummy-pending-auth');
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/api/15/user/2fa/verify') {
        assert.equal(JSON.parse(options.body).otp, '123456');
        return new Response(null, { status: 204, headers: { 'x-picnic-auth': 'dummy-verified-auth' } });
      }
      assert.equal(url.pathname, '/api/15/cart');
      assert.equal(headers.get('x-picnic-auth'), 'dummy-verified-auth');
      return Response.json({ id: 'smoke-cart', items: [], total_price: 0 });
    };
  `, { mode: 0o600 });

  const queued = [];
  const awaitingResponse = new Map();
  let sequence = 0;
  let serverFailure;
  const controlPlane = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer dummy-runtime-key');
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === `/v1/tunnels/${tunnelId}`) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: tunnelId, name: 'Docker smoke test' }));
        return;
      }
      if (request.method === 'GET' && url.pathname === `/v1/tunnels/${tunnelId}/poll`) {
        const command = queued.shift();
        if (command) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ commands: [command] }));
        } else {
          await delay(50);
          response.writeHead(204).end();
        }
        return;
      }
      assert.equal(request.method, 'POST', `Unexpected control-plane request: ${request.method} ${url.pathname}`);
      assert.equal(url.pathname, `/v1/tunnels/${tunnelId}/response`);
      assert.equal(request.headers['x-tunnel-shard-token'], 'dummy-shard-token');
      let body = '';
      for await (const chunk of request) body += chunk;
      const envelope = JSON.parse(body);
      assert.equal(envelope.channel, 'main');
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      if (envelope.resp_type !== 'jsonrpc_notify') {
        const waiter = awaitingResponse.get(envelope.request_id);
        assert.ok(waiter, `Unexpected response ${envelope.request_id}`);
        awaitingResponse.delete(envelope.request_id);
        waiter(envelope);
      }
    } catch (error) {
      serverFailure = error;
      response.writeHead(500).end();
    }
  });
  controlPlane.listen(0, '127.0.0.1');
  await once(controlPlane, 'listening');

  const client = spawn('picnic-tunnel', ['run', '--control-plane.api-key=env:CONTROL_PLANE_API_KEY'], {
    env: {
      ...testEnvironment,
      CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${controlPlane.address().port}`,
      MCP_COMMAND: `node --require ${mockPath} /app/bin/mcp-server.js`,
      ENABLE_HTTP_SERVER: 'true', // The entrypoint must enforce STDIO even if overridden.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(client, 'exit');
  let logs = '';
  for (const stream of [client.stdout, client.stderr]) {
    stream.on('data', (chunk) => {
      logs = (logs + chunk).slice(-12000);
    });
  }

  async function send(jsonrpc) {
    const requestId = `smoke-${++sequence}`;
    let timeout;
    try {
      const response = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(serverFailure ?? new Error(`Timed out: ${jsonrpc.method}\n${logs}`)), 10000);
        awaitingResponse.set(requestId, resolve);
        queued.push({
          request_id: requestId,
          shard_token: 'dummy-shard-token',
          command_type: 'jsonrpc',
          channel: 'main',
          created_at: new Date().toISOString(),
          response_timeout: '10s',
          jsonrpc: { jsonrpc: '2.0', ...jsonrpc },
        });
      });
      assert.equal(response.resp_code, 200);
      assert.equal(response.resp_json?.error, undefined);
      if (jsonrpc.id !== undefined) assert.equal(response.resp_json.id, jsonrpc.id);
      return response;
    } finally {
      clearTimeout(timeout);
      awaitingResponse.delete(requestId);
    }
  }

  try {
    const initialized = await send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'docker-smoke', version: '1.0.0' },
      },
    });
    assert.equal(initialized.resp_json.result.serverInfo.name, 'mcp-picnic');
    assert.equal(initialized.resp_json.result.protocolVersion, '2025-11-25');
    const notification = await send({ method: 'notifications/initialized' });
    assert.equal(notification.resp_type, 'notify_ack');
    const discovery = await send({ id: 2, method: 'tools/list', params: {} });
    const tools = discovery.resp_json.result.tools;
    assert.equal(tools.length, 38);
    for (const name of ['picnic_search', 'picnic_get_cart', 'picnic_add_to_cart', 'picnic_generate_2fa_code', 'picnic_verify_2fa_code']) {
      assert.ok(
        tools.some((tool) => tool.name === name),
        `Missing Picnic tool ${name}`,
      );
    }
    await send({ id: 3, method: 'ping' });

    assert.equal(existsSync(process.env.PICNIC_SESSION_FILE), false, 'Pending 2FA must not be saved as a full session');
    for (const [id, name, arguments_] of [
      [4, 'picnic_generate_2fa_code', { channel: 'SMS' }],
      [5, 'picnic_verify_2fa_code', { code: '123456' }],
      [6, 'picnic_get_cart', {}],
    ]) {
      const result = await send({ id, method: 'tools/call', params: { name, arguments: arguments_ } });
      assert.notEqual(result.resp_json.result.isError, true, JSON.stringify(result.resp_json.result));
    }
    const session = JSON.parse(readFileSync(process.env.PICNIC_SESSION_FILE, 'utf8'));
    assert.equal(session.authKey, 'dummy-verified-auth');
    const { deviceId } = JSON.parse(readFileSync(process.env.PICNIC_DEVICE_FILE, 'utf8'));
    assert.match(deviceId, /^[A-F0-9]{16}$/);
    for (const path of [process.env.PICNIC_SESSION_FILE, process.env.PICNIC_DEVICE_FILE]) {
      assert.equal(statSync(path).mode & 0o777, 0o600, 'Persisted credentials must be private');
    }

    // A second real MCP process must reuse both persisted files without logging in.
    const reused = spawn('node', ['--require', mockPath, '/app/bin/mcp-server.js'], {
      env: {
        ...testEnvironment,
        ENABLE_HTTP_SERVER: 'false',
        SMOKE_REUSE_SESSION: 'true',
        SMOKE_EXPECTED_DEVICE_ID: deviceId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let reusedOutput = '';
    let reusedErrors = '';
    reused.stdout.on('data', (chunk) => { reusedOutput += chunk; });
    reused.stderr.on('data', (chunk) => { reusedErrors += chunk; });
    const reusedExit = once(reused, 'exit');
    reused.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'reuse-smoke', version: '1.0.0' } },
    }) + '\n');
    try {
      const deadline = Date.now() + 10000;
      while (!reusedOutput.includes('"id":7') && Date.now() < deadline) await delay(50);
      assert.match(reusedOutput, /"id":7/, reusedErrors);
      assert.match(reusedErrors, /Successfully reused saved session/);
    } finally {
      reused.kill('SIGTERM');
      await reusedExit;
    }

    for (const endpoint of ['healthz', 'readyz', 'ui']) {
      const response = await fetch(`http://127.0.0.1:8080/${endpoint}`, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200, `${endpoint} must be available`);
      await response.arrayBuffer();
    }
    const healthcheck = spawnSync('node', ['/app/docker/healthcheck.cjs'], { timeout: 5000 });
    assert.equal(healthcheck.status, 0, 'The image healthcheck must report readiness');
    assert.equal(serverFailure, undefined);
    console.log(
      'PASS: configuration validation, 38 MCP tools, tunnel forwarding, 2FA, private session/device persistence and reuse, and health endpoints',
    );
  } finally {
    client.kill('SIGTERM');
    let shutdownTimeout;
    try {
      const [code, signal] = await Promise.race([
        exited,
        new Promise((_, reject) => {
          shutdownTimeout = setTimeout(() => {
            client.kill('SIGKILL');
            reject(new Error(`Tunnel did not stop cleanly\n${logs}`));
          }, 5000);
        }),
      ]);
      assert.equal(code, 0, `Tunnel exit code: ${code}, signal: ${signal}\n${logs}`);
      console.log('PASS: graceful SIGTERM shutdown');
    } finally {
      clearTimeout(shutdownTimeout);
      controlPlane.closeAllConnections();
      await new Promise((resolve) => controlPlane.close(resolve));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
