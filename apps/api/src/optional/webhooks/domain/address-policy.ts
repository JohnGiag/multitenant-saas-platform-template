import { BlockList, isIP } from 'node:net';

// Where a webhook may not go: the API's own network, its cloud's metadata service, and any range that is not the
// public internet. A tenant chooses the URL, so without this a webhook could probe or call internal services (SSRF).
// Two lists: BlockList also checks an IPv4 address against IPv4-mapped IPv6 rules, so one list blocking ::ffff:0:0/96
// would block every IPv4 address.
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // IPv4 written as IPv6, or translated to it: could reach any of the IPv4 ranges above.
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['2002::', 16], // 6to4, embeds an IPv4 address
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family === 6) return !blockedV6.check(address, 'ipv6');
  return false;
}
