// 门房（CORS proxy）
//
// 站在心潮前面：只给 /v1/state 的回答加上跨域头，好让浏览器里的卡片读得到；
// 其它请求一律原样透传。
//
// 原来的服务一行没动 —— 真出问题，把启动命令改回
// "node src/server.js" 就退回去了。
//
// 位置说明：必须放在 src/ 里。Railway 构建镜像时只带 src/ 这一层，放仓库根目录会找不到。

import http from 'node:http';
import { spawn } from 'node:child_process';

// 门房占 Railway 给的那个端口（PORT）
const PORT = Number(process.env.PORT || 8080);
// 原来的服务被挪到旁边这个端口，免得跟门房抢
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 18110);
// 放行的来源；默认 * 也行 —— /v1/state 本身仍然要 Authorization 才给数据
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
// 要走跨域头的路径
const CORS_PATHS = String(process.env.CORS_PATHS || '/v1/state')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 1) 先把原来的服务起起来，只改它看到的 PORT
const child = spawn(process.execPath, ['src/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(UPSTREAM_PORT) }
});
child.on('exit', (code, signal) => {
  console.log('[cors-proxy] upstream exited', code, signal);
  process.exit(code === null ? 1 : code);
});

function needsCors(pathname) {
  return CORS_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

function corsHeaders() {
  return {
    'access-control-allow-origin': ALLOW_ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '600',
    'vary': 'Origin'
  };
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // 预检：浏览器问能不能带着 Authorization 来读，直接答
  if (req.method === 'OPTIONS' && needsCors(pathname)) {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: UPSTREAM_PORT,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:' + UPSTREAM_PORT }
    },
    (up) => {
      const headers = { ...up.headers };
      if (needsCors(pathname)) Object.assign(headers, corsHeaders());
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    }
  );

  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'cors-proxy upstream failed',
        message: String((e && e.message) || e)
      })
    );
  });

  req.pipe(upstream);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    '[cors-proxy] listening on ' +
      PORT +
      ' -> 127.0.0.1:' +
      UPSTREAM_PORT +
      ' | cors paths: ' +
      CORS_PATHS.join(', ')
  );
});
