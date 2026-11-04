/*
 * Free My TV's Home button on LG webOS: a small helper with no window. Without root the TV can't replace its home
 * screen, so this reads the remote's keys and, right after a press of Home, opens Free My TV over LG's home screen.
 * It also opens Free My TV when the TV starts or wakes up. To reach LG's home screen, turn it off in Home Settings.
 * And it keeps the app loaded: LG closes it behind other apps, and from closed it takes seconds to open.
 * The keys are only read, never grabbed: the remote keeps working whatever happens here. Only Home's key number is
 * looked at, and nothing is kept or sent anywhere.
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

/**
 * Loads the app again behind the one in front, hidden, once it has stayed closed for two checks: not while another app
 * is starting up.
 */
function keepLoaded() {
  cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', 'luna://com.webos.applicationManager/dev/running', '{}'], {timeout: 5000}, function (err, out) {
    var answered = /returnValue/.test(String(out)), closed = answered && String(out).indexOf('"id":"' + APP + '"') < 0;
    if (closed && closedBefore) {
      var now = Date.now();
      checkEvery = now - loadedAt < CLOSED_SOON_MS ? Math.min(checkEvery * 2, CHECK_MAX_MS) : CHECK_MS;
      loadedAt = now;
      closed = false;
      log('loading the app behind, next check in ' + checkEvery / 1000 + ' s');
      cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', 'luna://com.webos.applicationManager/launch', JSON.stringify({id: APP, preload: 'full'})],
          {timeout: 8000}, function () {});
    }
    closedBefore = closed;
    setTimeout(keepLoaded, checkEvery);
  });
}

function onKey(code, value) {
  if (code !== HOME_KEY) return;
  if (value === 1) {
    clearTimeout(reopen);
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
  setTimeout(keepLoaded, CHECK_MS);
  var last = Date.now();
  setInterval(function () {
    var now = Date.now();
    // The TV freezes this process while it's off, with every clock running on (uptime and hrtime tell nothing): the gap is all there is.
    if (now - last > SLEPT_MS) {
      log('woke up after ' + Math.round((now - last) / 1000) + ' s');
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
      if (/stop/.test(String(data))) die();
    });
    socket.on('error', function () {});
  });
  server.on('error', die);
  server.listen(PORT, '127.0.0.1', watch);
} else {
  cp.spawn(process.execPath, [__filename, '--watch'], {detached: true, stdio: 'ignore'}).unref();
}
