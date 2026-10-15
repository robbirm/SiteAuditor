'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../lib/safeUrl');
const { fetchUrl } = require('../lib/fetcher');

const blocked = u => { try { s.parseUserUrl(u); return false; } catch (e) { return e instanceof s.UrlError; } };

test('private, loopback, metadata and tricky addresses are blocked', () => {
  for (const u of ['http://127.0.0.1', 'localhost', 'http://localhost:3000', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5',
    'http://192.168.1.1', 'http://172.16.5.5', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/', 'http://[fd00:ec2::254]/', 'http://[fe80::1]/', 'http://2130706433/', 'http://0x7f.1/',
    'http://0177.0.0.1/', 'http://100.64.1.1', 'http://0.0.0.0', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)',
    'http://user:pw@example.com', 'https://example.com:8080', 'http://intranet', 'http://foo.internal', 'http://foo.local'])
    assert.ok(blocked(u), u);
});

test('normal public sites are allowed', () => {
  for (const u of ['example.com', 'https://www.example.com/path?q=1', 'http://93.184.216.34', 'http://8.8.8.8', 'https://[2606:4700::1111]/'])
    assert.ok(!blocked(u), u);
  assert.equal(s.hostKey('WWW.Example.com'), 'example.com');
});

test('DNS lookups that resolve to private addresses are rejected (DNS rebinding defence)', async () => {
  await new Promise(resolve => s.safeLookup('localhost', {}, err => { assert.ok(err); resolve(); }));
});

test('the fetcher refuses private targets', async () => {
  await assert.rejects(fetchUrl('http://127.0.0.1:9/'));
  await assert.rejects(fetchUrl('http://localhost/'));
  await assert.rejects(fetchUrl('http://169.254.169.254/'));
});
