'use strict';
// SSRF protection: only public http(s) sites on ports 80/443 may be fetched.
const net = require('net');
const dns = require('dns');

class UrlError extends Error {}

const blocked = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], // incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]
  .forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]
  .forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

const bare = h => String(h).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
const hostKey = h => bare(h).replace(/^www\./, '');

function isBlockedIp(ip) {
  try {
    const v = net.isIP(ip);
    if (!v) return true;
    if (v === 6) { // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:hhhh:hhhh): judge by the embedded IPv4 address
      let m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
      if (m) return isBlockedIp(m[1]);
      m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
      if (m) { const a = parseInt(m[1], 16), b = parseInt(m[2], 16); return isBlockedIp([a >> 8, a & 255, b >> 8, b & 255].join('.')); }
    }
    return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
  } catch { return true; }
}

function assertPublicHostname(host) {
  const h = bare(host);
  if (net.isIP(h)) {
    if (isBlockedIp(h)) throw new UrlError('That address is private or not allowed');
    return;
  }
  if (!h.includes('.') || /\.(localhost|local|localdomain|internal|intranet|lan|home|corp|invalid|test)$/.test(h) || h === 'localhost')
    throw new UrlError('That hostname is private or not allowed');
}

// Validates a URL string (used for the start URL and for EVERY request the crawler makes).
function checkUrl(s) {
  let u;
  try { u = new URL(s); } catch { throw new UrlError('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UrlError('Only http and https URLs are allowed');
  if (u.username || u.password) throw new UrlError('URLs containing credentials are not allowed');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new UrlError('Only ports 80 and 443 are allowed');
  assertPublicHostname(u.hostname);
  u.hash = '';
  return u;
}

function parseUserUrl(input) {
  let s = String(input || '').trim();
  if (!s || s.length > 2048) throw new UrlError('Enter a valid website URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  return checkUrl(s);
}

// Used as the socket "lookup": the connection can only go to the addresses validated here,
// which defeats DNS rebinding (no second, unchecked lookup happens).
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length) return cb(new Error('DNS returned no addresses'));
    if (addrs.some(a => isBlockedIp(a.address))) return cb(new UrlError('Host resolves to a private or blocked address'));
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

// Early, friendly check before a crawl starts.
async function preflight(u) {
  const h = bare(u.hostname);
  if (net.isIP(h)) return;
  const addrs = await dns.promises.lookup(h, { all: true });
  if (addrs.some(a => isBlockedIp(a.address))) throw new UrlError('That website resolves to a private or blocked address');
}

module.exports = { UrlError, isBlockedIp, checkUrl, parseUserUrl, safeLookup, preflight, hostKey };
