# VideoFlow 安全说明

本文件记录已实施的安全加固与已知限制，供部署/分发时参考。

## 威胁模型

- **本地/桌面版**：单用户在自己机器上运行，API Key 存本机用户目录，天然隔离。
- **暴露面**：桌面版会起 cloudflared 隧道把 `/media/*` 暴露到公网（供火山方舟拉取参考图）。因此后端一旦对外可达，`/v1` 必须鉴权。

## 已实施加固

| 项 | 措施 | 位置 |
|---|---|---|
| **API 鉴权** | `/v1/*` 需 `Authorization: Bearer <VF_TOKEN>`；`/media/*` 与静态前端免鉴权（在鉴权检查之前）。桌面版每次启动生成随机 token，注入后端子进程与前端窗口。 | `server/server.js`、`electron/main.js`、`electron/preload.cjs` |
| **监听地址** | 默认绑 `127.0.0.1`，不暴露到局域网；需对外显式设 `VF_HOST=0.0.0.0`。 | `server/server.js` |
| **路径穿越** | 上传接口的 `ext` 参数经 `safeExt()` 净化（剥离路径分隔符与点，白名单字母数字后缀），杜绝 `?ext=/../../evil.js` 写出。 | `server/server.js` |
| **webhook SSRF** | 任务 webhook 目标经 `isSafeWebhookUrl()` 校验：仅 http(s)，拒绝回环/私网（10/172.16-31/192.168）/链路本地(169.254，含云元数据)/IPv6 本地/file 协议。 | `server/queue.js` |
| **请求体上限** | `readBody` 加 2MB 上限、`readBinary` 50MB 上限，防内存 DoS。 | `server/server.js` |
| **CORS 收敛** | 仅对回环 Origin（localhost/127.0.0.1/[::1]，任意端口）回显 `Access-Control-Allow-Origin`；恶意公网页面无法跨源读取响应。 | `server/server.js` |

## 已知限制

- **横向越权（多租户场景）**：`project` 表有 `owner_id` 列但当前不做归属校验——知道 `projectId` 即可访问该项目。**单用户桌面/本地使用不受影响**；若未来做多用户 SaaS，需在所有项目相关查询加 owner 过滤 + 登录态。
- **临时隧道**：桌面版用 Cloudflare 免费临时隧道（trycloudflare），无 uptime 保证、URL 每次启动变（程序自动重填）。生产级稳定需 named tunnel（Cloudflare 账号）。
- **反编译**：Electron 打包的 JS 默认可解包（asar 可解压）。**密钥不在代码里**（存运行时用户目录），反编译只暴露业务逻辑源码，影响低。如需防护可上 asar 加密/混淆。
- **代码签名**：当前为原型阶段未做 Apple 签名，用户首次打开需右键→打开绕过 Gatekeeper。正式分发需 Apple Developer 账号。

## 非桌面版部署注意

直接 `node server/server.js` 对外部署时：
1. **必须**设 `VF_TOKEN` 为强随机值（否则 `/v1` 无鉴权放行）。
2. 建议置于 HTTPS 反向代理（nginx/caddy）之后，不要裸奔公网。
3. `data/settings.json`（含密钥）、`data/*.db`、`media/` 已被 `.gitignore` 排除，勿提交。
