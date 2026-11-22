import os from 'node:os';
import { isIPv4 } from 'node:net';
import { pathToFileURL } from 'node:url';
import { preview } from 'vite';
import { createMobilePreviewPlugin, MOBILE_PREVIEW_PORT } from './mobile-preview-server.mjs';

const isPrivateIpv4 = (address) => {
  if (!isIPv4(address)) return false;
  const octets = address.split('.').map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
};

export function listPrivateIpv4Addresses(networkInterfaces = os.networkInterfaces()) {
  return [
    ...new Set(
      Object.values(networkInterfaces)
        .flatMap((entries) => entries ?? [])
        .filter(
          (entry) => entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address),
        )
        .map((entry) => entry.address),
    ),
  ];
}

export function selectPreviewHost(args = process.argv.slice(2), networkInterfaces) {
  const explicitHosts = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') {
      const value = args[index + 1];
      if (!value) throw new Error('用法：npm run preview:lan -- [--host <本机私有 IPv4>]');
      explicitHosts.push(value);
      index += 1;
    } else if (argument.startsWith('--host=')) {
      explicitHosts.push(argument.slice('--host='.length));
    } else {
      throw new Error(`不支持的参数：${argument}`);
    }
  }
  if (explicitHosts.length > 1) throw new Error('--host 只能指定一次');

  const addresses = listPrivateIpv4Addresses(networkInterfaces);
  if (explicitHosts.length === 1) {
    const host = explicitHosts[0];
    if (host === '127.0.0.1') return host;
    if (!isPrivateIpv4(host) || !addresses.includes(host)) {
      throw new Error(
        `--host 必须是本机已分配的 RFC1918 IPv4 地址：${addresses.join(', ') || '无'}`,
      );
    }
    return host;
  }

  if (addresses.length === 0) {
    throw new Error('未找到本机 RFC1918 IPv4 地址；请连接局域网或显式使用 --host 127.0.0.1 测试');
  }
  if (addresses.length > 1) {
    throw new Error(`检测到多个局域网 IPv4 地址，请用 --host 明确选择：${addresses.join(', ')}`);
  }
  return addresses[0];
}

export async function startLanPreview(host) {
  return preview({
    plugins: [createMobilePreviewPlugin(host)],
    preview: { host, port: MOBILE_PREVIEW_PORT, strictPort: true },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const host = selectPreviewHost();
    const server = await startLanPreview(host);
    console.log(`Dimlu 局域网预览已启动：http://${host}:${MOBILE_PREVIEW_PORT}`);
    server.printUrls();
  } catch (error) {
    console.error(`无法启动局域网预览：${error.message}`);
    process.exitCode = 1;
  }
}
