/*
 * Free My TV's service on LG webOS, for what the page can't do itself. Both go through the TV's remote control API
 * (127.0.0.1:3000): newer webOS gives each app's page its own origin (file://io.freemytv-webos), and the API closes any
 * connection that isn't from file:// ("invalid origin"); from here the handshake says file://.
 *  - ssap: one call for the page, the app list.
 *  - watch: Return to Free My TV (Home Settings, off by default). It follows the app in front and, when an app closes
 *    onto LG's home, opens Free My TV again. LG's home opened from Free My TV (Home pressed there) stays, and nothing
 *    opens while the TV is going off. The TV asks once to allow it, with a key of its own.
 * Plain ES5 with Node's net only: older webOS ships an old Node.
 */
var net = require('net');
var Service = require('webos-service');

var NAME = require('./package.json').name;
var SELF = NAME.replace(/\.service$/, '');   // io.freemytv
var service = new Service(NAME);

function buffer(x) {   // Buffer.from is missing before Node 4.5
  return Buffer.from ? Buffer.from(x) : new Buffer(x);
}

/** A client's frame (1 text, 10 pong): masked, as the protocol asks. */
function frame(payload, op) {
  var data = buffer(payload), n = data.length;
  var mask = buffer([Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0]);
  for (var i = 0; i < n; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([buffer(n < 126 ? [0x80 | op, 0x80 | n] : [0x80 | op, 0xfe, n >> 8, n & 0xff]), mask, data]);
}

/**
 * A connection to the remote control API, registered with these permissions (the TV asks the first time):
 * on.registered(clientKey), then on.message(m) for each later message, and on.closed(refused) once at the end.
 */
function connect(permissions, clientKey, on) {
  var socket = net.connect(3000, '127.0.0.1'), buf = buffer([]), open = false, text = '', ended = false;
  function end(refused) {
    if (ended) return;
    ended = true;
    socket.destroy();
    on.closed(!!refused);
  }
  function send(obj) {
    if (!ended) socket.write(frame(JSON.stringify(obj), 1));
  }
  function onMessage(m) {
    if (m.type === 'registered') on.registered(m.payload['client-key']);
    else if (m.type === 'error' && m.id === 'register') end(true);   // the person said no on the TV
    else on.message(m);
  }
  socket.on('connect', function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: file://\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZnJlZW15dHYtd2Vib3MtYXBp\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var head = buf.toString('binary').indexOf('\r\n\r\n');
      if (head < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { end(false); return; }
      open = true;
      buf = buf.slice(head + 4);
      var payload = {forcePairing: false, pairingType: 'PROMPT',
        manifest: {manifestVersion: 1, appVersion: '1.0', permissions: permissions}};
      if (clientKey) payload['client-key'] = clientKey;
      send({type: 'register', id: 'register', payload: payload});
    }
    // The server's frames: unmasked, a message possibly in several (continuation frames until FIN).
    while (buf.length >= 2) {
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, n = buf[1] & 0x7f, off = 2;
      if (n === 126) {
        if (buf.length < 4) return;
        n = buf.readUInt16BE(2);
        off = 4;
      } else if (n === 127) {
        if (buf.length < 10) return;
        n = buf.readUInt32BE(6);
        off = 10;
      }
      if (buf.length < off + n) return;
      var data = buf.slice(off, off + n);
      buf = buf.slice(off + n);
      if (op === 8) { end(false); return; }
      if (op === 9) { socket.write(frame(data, 10)); continue; }   // a ping, on a connection kept open
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
      if (ended) return;
    }
  });
  socket.on('error', function () { end(false); });
  socket.on('close', function () { end(false); });
  return {send: send, close: function () { end(false); }};
}

/** done({clientKey, payload}), {refused: true} when the person said no on the TV, or null. */
function call(uri, clientKey, done) {
  var finished = false, conn = null;
  var timer = setTimeout(function () { finish(null); }, 90000);   // time to answer the TV's prompt
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (conn) conn.close();
    done(result);
  }
  conn = connect(['READ_INSTALLED_APPS'], clientKey, {
    registered: function (key) {
      clientKey = key;
      conn.send({type: 'request', id: 'call', uri: 'ssap://' + uri});
    },
    message: function (m) {
      if (m.id === 'call') finish(m.type === 'error' ? null : {clientKey: clientKey, payload: m.payload});
      else if (m.type === 'error') finish(null);
    },
    closed: function (refused) { finish(refused ? {refused: true} : null); }
  });
}

service.register('ssap', function (message) {
  var p = message.payload || {};
  // Only the app list, the one call the page makes: nothing else goes to the TV's API, nor gets its client key.
  if (p.uri !== 'com.webos.applicationManager/listLaunchPoints') {
    message.respond({returnValue: false, errorText: 'Only listLaunchPoints'});
    return;
  }
  call(p.uri, p.clientKey, function (result) {
    if (!result) message.respond({returnValue: false, errorText: 'No answer from the remote control API'});
    else {
      result.returnValue = true;
      message.respond(result);
    }
  });
});

// MARK: - Return to Free My TV

// LG's home screen (webOS 6 and newer open it as an app; older ones as a bar over the last one).
var HOME = /^com\.webos\.app\.(home|launcher)$/;
var watch = {on: false, key: null, conn: null, ready: false, last: '', waiting: [], back: 0, retry: 0, ask: 0};
var keepAlive = null;

/** While watching, the service stays up after the page closes (webos-service ends an idle one after 5 s). */
function hold(on) {
  try {
    if (on && !keepAlive) service.activityManager.create('keepAlive', function (activity) { keepAlive = activity; });
    else if (!on && keepAlive) {
      service.activityManager.complete(keepAlive, function () {});
      keepAlive = null;
    }
  } catch (e) {}
}

/** The page's calls waiting for the first answer: watching or not (refused, no API, or no answer in 90 s). */
function answer(ok) {
  clearTimeout(watch.ask);
  var list = watch.waiting;
  watch.waiting = [];
  for (var i = 0; i < list.length; i++) list[i].respond({returnValue: true, watching: ok, clientKey: watch.key});
}

function stopWatch() {
  watch.on = false;
  clearTimeout(watch.back);
  clearTimeout(watch.retry);
  if (watch.conn) watch.conn.close();
  hold(false);
  answer(false);
}

/** Free My TV again, by the TV's own launch; through the remote control API where that's refused. */
function launchSelf() {
  service.call('luna://com.webos.applicationManager/launch', {id: SELF}, function (m) {
    if (m && m.payload && m.payload.returnValue) return;
    if (watch.conn && watch.ready) watch.conn.send({type: 'request', id: 'launch', uri: 'ssap://system.launcher/launch', payload: {id: SELF}});
  });
}

function front(app) {
  if (!app) return;   // between two apps
  clearTimeout(watch.back);
  var from = watch.last;
  watch.last = app;
  // An app gave way to LG's home (not Free My TV itself, whose Home is the way there): Free My TV, if LG's home is still
  // in front a moment later and the TV is on.
  if (HOME.test(app) && from && from !== SELF && !HOME.test(from)) {
    watch.back = setTimeout(function () {
      if (watch.last === app && watch.conn && watch.ready) {
        watch.conn.send({type: 'request', id: 'power', uri: 'ssap://com.webos.service.tvpower/power/getPowerState'});
      }
    }, 1200);
  }
}

function startWatch() {
  if (watch.conn || !watch.on) return;
  var conn = watch.conn = connect(['READ_RUNNING_APPS', 'READ_POWER_STATE', 'LAUNCH'], watch.key, {
    registered: function (key) {
      watch.key = key;
      watch.ready = true;
      conn.send({type: 'subscribe', id: 'front', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo'});
      answer(true);
    },
    message: function (m) {
      if (m.id === 'front') {
        if (m.type === 'error') stopWatch();   // not allowed on this TV
        else if (m.payload) front(m.payload.appId || '');
      } else if (m.id === 'power') {
        var p = m.payload || {};
        // Only with the picture on: not while it's going to standby or off. A TV that doesn't say counts as on.
        if (m.type === 'error' || !p.state || (p.state === 'Active' && !p.processing)) launchSelf();
      }
    },
    closed: function (refused) {
      var wasReady = watch.ready;
      if (watch.conn === conn) { watch.conn = null; watch.ready = false; }
      // Refused on the TV, or down before it was up while the page waits: off, as the page will show. Dropped later
      // (the TV's network restarting): up again in 15 s.
      if (refused || (!wasReady && watch.waiting.length)) { stopWatch(); return; }
      if (watch.on) watch.retry = setTimeout(startWatch, 15000);
    }
  });
}

service.register('watch', function (message) {
  var p = message.payload || {};
  if (!p.on) {
    stopWatch();
    message.respond({returnValue: true, watching: false});
    return;
  }
  if (p.clientKey && !watch.key) watch.key = p.clientKey;
  watch.on = true;
  hold(true);
  if (watch.ready) {
    message.respond({returnValue: true, watching: true, clientKey: watch.key});
    return;
  }
  watch.waiting.push(message);
  clearTimeout(watch.ask);
  watch.ask = setTimeout(function () { if (!watch.ready) stopWatch(); }, 95000);   // the TV's prompt went unanswered
  clearTimeout(watch.retry);
  startWatch();
});
