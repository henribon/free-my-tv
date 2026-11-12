/*
 * Free My TV's Home button on LG webOS: a small helper with no window. Without root the TV can't replace its home
 * screen, so this reads the remote's keys and, right after a press of Home, opens Free My TV over LG's home screen.
 * It also opens Free My TV when the TV starts or wakes up, and when an app is left and LG's home screen would show.
 * LG's home screen stays only when asked for (the drawer's LG Home, or leaving Free My TV itself), until another app
 * opens. And it keeps the app loaded: LG closes it behind other apps, and from closed it takes seconds to open.
 * The keys are only read, never grabbed: the remote keeps working whatever happens here. Only Home's key number is
 * looked at, and nothing is kept or sent anywhere. Which app is on screen comes from the TV's remote control API, which
 * the TV asks once to allow (a call to the app manager is only for LG's own apps).
 * It's a native app because only those may read /dev/input; the web app's JS service may not.
 * Plain ES5 with Node's own modules, as in webos/service.
 */
var fs = require('fs'), net = require('net'), cp = require('child_process');

var APP = 'io.freemytv', PORT = 17171;
var HOME_KEY = 773, REMOTES = /^LGE M-RCU - Builtin \[0\]$|^LGE RCU$/;
var REOPEN_MS = 500;     // after the key comes up: LG's home screen, slower than us, may have come up over ours
var SLEPT_MS = 10000;    // timers stand still while the TV is off: a gap this long means it just came back on
var CHECK_MS = 20000;    // how often to see whether LG has closed the app
var CHECK_MAX_MS = 600000, CLOSED_SOON_MS = 180000;   // closed again this soon, LG wants the room: wait longer, up to this
var COVER_MS = 300;      // LG's home screen this long after an app was left: ours over it
var SETTLED_MS = 8000;   // an app on screen this long has started: Free My TV can load behind it
var HOME_SCREENS = /^com\.webos\.app\.(home|homeconnect)$/;   // LG's home screen, as the app manager names it
var SSAP_KEY = '/media/developer/temp/freemytv-homekey.key';   // the remote control API's key (the only place it may write)
var LOG = '/media/developer/temp/freemytv-homekey.log';   // only written when it exists (touch it over SSH to debug)

function log(text) {
  try { if (fs.existsSync(LOG)) fs.appendFileSync(LOG, new Date().toISOString() + ' ' + text + '\n'); } catch (e) {}
}

function die() {
  process.kill(process.pid, 'SIGKILL');   // process.exit would wait for the reads blocked on the remote, forever
}

function open(why) {
  log('open: ' + why);
  cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', 'luna://com.webos.applicationManager/launch', JSON.stringify({id: APP})],
      {timeout: 8000}, function (err) { if (err) log('launch failed: ' + err.message); });
}

var reopen = null, checkEvery = CHECK_MS, closedBefore = false, loadedAt = 0;
// The app on screen ('' between two apps, null until told) and the last one that wasn't nothing.
var foreground = null, lastApp = null, lgWanted = false, cover = null, settled = null, shown = false, homeAt = 0;

function lgShowing() {
  return HOME_SCREENS.test(foreground || '');
}

/** A client's WebSocket frame: masked, as the protocol asks (op 1 text, 10 pong). */
function frame(op, data) {
  var n = data.length, mask = Buffer.from([Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0]);
  var out = Buffer.from(data);
  for (var i = 0; i < n; i++) out[i] ^= mask[i % 4];
  return Buffer.concat([Buffer.from(n < 126 ? [0x80 | op, 0x80 | n] : [0x80 | op, 0xfe, n >> 8, n & 0xff]), mask, out]);
}

/**
 * Follows the app on screen through the TV's remote control API (127.0.0.1:3000, the one LG's phone app uses): the
 * app manager's own call is only for LG's apps. The first time, the TV asks to allow it, and the key it gives is kept;
 * a "no" is kept too, until Home Settings turns the Home button off and on. The connection is made again when it drops.
 */
function watchScreen(wait) {
  var key = '';
  try { key = fs.readFileSync(SSAP_KEY, 'utf8').trim(); } catch (e) {}
  if (key === 'refused') { log('the TV was told not to allow the remote control API'); return; }
  var socket = net.connect(3000, '127.0.0.1'), buf = Buffer.alloc(0), open = false, text = '', subscribed = false;
  function send(obj) { socket.write(frame(1, Buffer.from(JSON.stringify(obj)))); }
  socket.on('connect', function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: file://\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZnJlZW15dHYtaG9tZWtleQ==\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { socket.destroy(); return; }
      open = true;
      buf = buf.slice(end + 4);
      var payload = {forcePairing: false, pairingType: 'PROMPT', manifest: {manifestVersion: 1, appVersion: '1.0', permissions: ['READ_RUNNING_APPS']}};
      if (key) payload['client-key'] = key;
      send({type: 'register', id: 'register', payload: payload});
    }
    while (buf.length >= 2) {   // the server's frames: unmasked, a message possibly in several
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, n = buf[1] & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = buf.readUInt32BE(6); off = 10; }
      if (buf.length < off + n) return;
      var data = buf.slice(off, off + n);
      buf = buf.slice(off + n);
      if (op === 8) { socket.destroy(); return; }
      if (op === 9) { socket.write(frame(10, data)); continue; }   // unanswered pings close the connection in 40 s
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
    }
  });
  function onMessage(m) {
    if (m.type === 'registered') {
      if (m.payload && m.payload['client-key'] && m.payload['client-key'] !== key) {
        key = m.payload['client-key'];
        try { fs.writeFileSync(SSAP_KEY, key, {mode: 384}); } catch (e) { log('key not kept: ' + e.code); }
      }
      send({type: 'subscribe', id: 'screen', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo'});
    } else if (m.id === 'register' && m.type === 'error') {
      log('the remote control API: ' + (m.error || 'refused'));
      if (/denied|reject/i.test(m.error || '')) try { fs.writeFileSync(SSAP_KEY, 'refused', {mode: 384}); } catch (e) {}
      socket.destroy();
    } else if (m.id === 'screen' && m.payload && typeof m.payload.appId === 'string') {
      subscribed = true;
      onForeground(m.payload.appId);
    }
  }
  socket.on('error', function () {});
  // It drops while a big app starts (YouTube): the app on screen stays the last one told, so leaving it meanwhile shows
  // when the connection is back.
  socket.on('close', function () {
    wait = subscribed ? 2000 : Math.min((wait || 5000) * 2, CHECK_MAX_MS);
    log('remote control API closed, again in ' + wait / 1000 + ' s');
    setTimeout(function () { watchScreen(wait); }, wait);
  });
}

/**
 * The app on screen changed: another app ends LG's home screen on purpose; LG's home screen after one is covered.
 * Between two apps the TV tells none for a second or two (webOS 10.3): that's no reason to cover anything.
 */
function onForeground(id) {
  if (id === foreground) return;
  foreground = id;
  log('on screen: ' + (id || '(none)') + (lgWanted ? ', LG wanted' : ''));
  clearTimeout(cover);
  if (!id) return;
  var before = lastApp;
  lastApp = id;
  if (id === APP) { shown = true; lgWanted = false; }
  if (!HOME_SCREENS.test(id)) {
    if (id !== APP) {
      lgWanted = false;
      clearTimeout(settled);
      settled = setTimeout(function () { if (foreground === id) keepLoaded(id); }, SETTLED_MS);
    }
    return;
  }
  // Free My TV itself was left (Back, then Exit): that's a choice too. Not Home pressed on it: LG's comes up a moment.
  if (before === APP && Date.now() - homeAt > 3000) lgWanted = true;
  if (lgWanted || before === null) return;
  cover = setTimeout(function () {
    if (lgShowing() && !lgWanted) open('left ' + before);
  }, COVER_MS);
}

/**
 * Loads the app again behind the one in front, hidden: once that app has been on screen for a few seconds (`behind`,
 * when the TV tells which app it is), or else once it has stayed closed for two checks, so not while one starts up.
 * Never under LG's home screen, which it could come over.
 */
function keepLoaded(behind) {
  cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', 'luna://com.webos.applicationManager/dev/running', '{}'], {timeout: 5000}, function (err, out) {
    var answered = /returnValue/.test(String(out)), closed = answered && String(out).indexOf('"id":"' + APP + '"') < 0;
    if (closed && (lgWanted || lgShowing() || foreground === '')) closed = false;
    if (closed && (behind ? checkEvery === CHECK_MS : closedBefore)) {
      var now = Date.now();
      // Closed again soon, without being shown since: LG wants the room. Wait longer each time, up to CHECK_MAX_MS.
      checkEvery = now - loadedAt < CLOSED_SOON_MS && !shown ? Math.min(checkEvery * 2, CHECK_MAX_MS) : CHECK_MS;
      loadedAt = now;
      shown = false;
      closed = false;
      log('loading the app behind ' + (behind || 'the app on screen') + ', next check in ' + checkEvery / 1000 + ' s');
      cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', 'luna://com.webos.applicationManager/launch', JSON.stringify({id: APP, preload: 'full'})],
          {timeout: 8000}, function () {});
    }
    if (behind) return;   // the regular checks go on by themselves
    closedBefore = closed;
    setTimeout(keepLoaded, checkEvery);
  });
}

function onKey(code, value) {
  if (code !== HOME_KEY) return;
  if (value === 1) {
    clearTimeout(reopen);
    lgWanted = false;
    homeAt = Date.now();
    open('home');   // at once: the TV takes long enough as it is to bring it to the front
  } else if (value === 0) {
    reopen = setTimeout(function () { open('home, again'); }, REOPEN_MS);
  }
}

/** Reads one remote's events for good: struct input_event is 16 bytes in a 32-bit process, 24 in a 64-bit one. */
function read(path) {
  var size = process.arch === 'arm' || process.arch === 'ia32' ? 16 : 24, buf = Buffer.alloc(size * 16), fd;
  try { fd = fs.openSync(path, 'r'); } catch (e) { log('no access to ' + path + ': ' + e.code); return; }
  log('reading ' + path);
  (function next() {
    fs.read(fd, buf, 0, buf.length, null, function (err, n) {
      if (err) { log('read failed: ' + err.code); try { fs.closeSync(fd); } catch (e) {} setTimeout(function () { read(path); }, 5000); return; }
      for (var at = 0; at + size <= n; at += size) {
        if (buf.readUInt16LE(at + size - 8) === 1) onKey(buf.readUInt16LE(at + size - 6), buf.readInt32LE(at + size - 4));
      }
      next();
    });
  })();
}

function remotes() {
  var name = '', found = [];
  fs.readFileSync('/proc/bus/input/devices', 'utf8').split('\n').forEach(function (line) {
    var m = /^N: Name="(.*)"/.exec(line);
    if (m) name = m[1];
    m = /^H: Handlers=.*\b(event\d+)/.exec(line);
    if (m && REMOTES.test(name)) found.push('/dev/input/' + m[1]);
  });
  return found;
}

function watch() {
  log('watching, uid ' + process.getuid() + ', groups ' + process.getgroups().join(','));
  remotes().forEach(read);
  watchScreen();
  setTimeout(keepLoaded, CHECK_MS);
  var last = Date.now();
  setInterval(function () {
    var now = Date.now();
    // The TV freezes this process while it's off, with every clock running on (uptime and hrtime tell nothing): the gap is all there is.
    if (now - last > SLEPT_MS) {
      log('woke up after ' + Math.round((now - last) / 1000) + ' s');
      lgWanted = false;
      open('wake');
      setTimeout(function () { open('wake, again'); }, 4000);   // right after waking, the first one can get lost
    }
    last = now;
  }, 2000);
  // After a boot the service's activity starts this, up to 5 minutes in, so the TV also ends up on Free My TV.
  var uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8'));
  if (uptime < 360) open('boot, up ' + Math.round(uptime) + ' s');
}

/** A second helper can't start (the port is taken), and "stop" on the port ends the one running. */
if (process.argv[2] === '--watch') {
  var server = net.createServer(function (socket) {
    socket.on('data', function (data) {
      log(String(data));
      if (/stop/.test(String(data))) {
        if (fs.existsSync(SSAP_KEY) && fs.readFileSync(SSAP_KEY, 'utf8') === 'refused') fs.unlinkSync(SSAP_KEY);   // asked again when turned on
        die();
      }
      if (/lg/.test(String(data))) { lgWanted = true; clearTimeout(cover); }   // LG Home in the drawer: LG's home screen next
    });
    socket.on('error', function () {});
  });
  server.on('error', die);
  server.listen(PORT, '127.0.0.1', watch);
} else {
  cp.spawn(process.execPath, [__filename, '--watch'], {detached: true, stdio: 'ignore'}).unref();
}
