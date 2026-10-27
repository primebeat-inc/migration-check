function expandIpv6(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, "0"));
}

// IPv6 は /64 の中でアドレスを変えられるので、/64 単位でまとめる
export function clientKey(ip) {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
}
