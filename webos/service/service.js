/*
 * Free My TV's service on LG webOS: one call to the TV's remote control API (127.0.0.1:3000) for the web app.
 * Newer webOS gives each app's page its own origin (file://io.freemytv-webos), and the API closes any connection
 * that isn't from file:// ("invalid origin"); from here the handshake says file://.
 * Plain ES5 with Node's net only: older webOS ships an old Node.
 */
var net = require('net');
var Service = require('webos-service');

var service = new Service(require('./package.json').name);

function buffer(x) {   // Buffer.from is missing before Node 4.5
  return Buffer.from ? Buffer.from(x) : new Buffer(x);
}

/** A client's text frame: masked, as the protocol asks. */
function frame(text) {
  var data = buffer(text), n = data.length;
  var mask = buffer([Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0]);
  for (var i = 0; i < n; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([buffer(n < 126 ? [0x81, 0x80 | n] : [0x81, 0xfe, n >> 8, n & 0xff]), mask, data]);
}

/** done({clientKey, payload}), {refused: true} when the person said no on the TV, or null. */
function call(uri, clientKey, done) {
  var socket = net.connect(3000, '127.0.0.1'), buf = buffer([]), open = false, text = '', finished = false;
  var timer = setTimeout(function () { finish(null); }, 90000);   // time to answer the TV's prompt
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.destroy();
    done(result);
  }
  function send(obj) {
    socket.write(frame(JSON.stringify(obj)));
  }
  function onMessage(m) {
    if (m.type === 'registered') {
      clientKey = m.payload['client-key'];
      send({type: 'request', id: 'call', uri: 'ssap://' + uri});
    } else if (m.id === 'call') {
      finish(m.type === 'error' ? null : {clientKey: clientKey, payload: m.payload});
    } else if (m.type === 'error') {
      finish(m.id === 'register' ? {refused: true} : null);
    }
  }
  socket.on('connect', function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nOrigin: file://\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZnJlZW15dHYtd2Vib3MtYXBp\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { finish(null); return; }
      open = true;
      buf = buf.slice(end + 4);
      var payload = {forcePairing: false, pairingType: 'PROMPT',
        manifest: {manifestVersion: 1, appVersion: '1.0', permissions: ['READ_INSTALLED_APPS']}};
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
      if (op === 8) { finish(null); return; }
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
    }
  });
  socket.on('error', function () { finish(null); });
  socket.on('close', function () { finish(null); });
}

// The Home button's helper (webos/homekey). It can't be started from a page or kept alive by this service: it's its own
// native app, the only kind that may read the remote. A boot starts nothing by itself, so a persistent activity calls
// `tick` every few minutes, and within the first minutes after a boot, that starts the helper.
var HOMEKEY = 'io.freemytv.homekey', HOMEKEY_PORT = 17171, ACTIVITY = 'io.freemytv.homekey.boot', BOOT_WINDOW_S = 600;

/** Tells the helper something ('ping', 'stop'); done(whether it's running). */
function tellHomekey(what, done) {
  var socket = net.connect(HOMEKEY_PORT, '127.0.0.1');
  socket.on('connect', function () { socket.end(what); done(true); });
  socket.on('error', function () { done(false); });
}

/** With preload: it has no window, and a plain launch would take what's on screen away, to LG's home screen. */
function startHomekey(done) {
  service.call('luna://com.webos.applicationManager/launch', {id: HOMEKEY, preload: 'full'}, function (reply) { done(reply.payload); });
}

service.register('homekey', function (message) {
  var on = !(message.payload && message.payload.on === false);
  var activity = null;
  function answer(result) { message.respond({returnValue: true, on: on, result: result, activity: activity}); }
  if (message.payload && message.payload.lg) {
    // LG's home screen on purpose: the helper (if it runs) first hears not to cover it.
    tellHomekey('lg', function () {
      service.call('luna://com.webos.applicationManager/launch', {id: 'com.webos.app.home'}, function (reply) {
        message.respond({returnValue: reply.payload.returnValue !== false, result: reply.payload});
      });
    });
    return;
  }
  function running() {
    tellHomekey('ping', function (yes) { if (yes) answer('running'); else startHomekey(answer); });
  }
  if (!on) {
    service.call('luna://com.palm.activitymanager/cancel', {activityName: ACTIVITY}, function () {
      tellHomekey('stop', function (yes) { answer(yes ? 'stopped' : 'not running'); });
    });
    return;
  }
  if (message.payload && message.payload.again) { running(); return; }   // the activity is there: only make sure it runs
  service.call('luna://com.palm.activitymanager/create', {activity: {name: ACTIVITY, description: 'Free My TV: Home button after a boot',
    type: {foreground: true, persist: true}, schedule: {interval: '5m', precise: true},
    callback: {method: 'luna://' + require('./package.json').name + '/tick', params: {}}},
    start: true, replace: true, subscribe: false}, function (reply) {
    activity = reply.payload;
    running();
  });
});

service.register('tick', function (message) {
  function done(result) {
    if (message.payload && message.payload.$activity && message.activity) {
      service.activityManager.complete(message.activity, {restart: true}, function () { message.respond({returnValue: true, result: result}); });
    } else {
      message.respond({returnValue: true, result: result});
    }
  }
  tellHomekey('ping', function (yes) {
    if (yes) done('running');
    else if (parseFloat(require('fs').readFileSync('/proc/uptime', 'utf8')) > BOOT_WINDOW_S) done('not after a boot');
    else startHomekey(done);
  });
});

// Where the day's football is on in Brazil: ge.globo's agenda page carries five days of it (two back, two ahead) as JSON,
// each game with its TV channels and streaming services. The page doesn't answer other origins, so it's read here.
var https = require('https'), zlib = require('zlib');

/** done(list of games) or done(null). */
function agenda(done) {
  var finished = false;
  function finish(result) { if (!finished) { finished = true; done(result); } }
  var req = https.get({host: 'ge.globo.com', path: '/agenda/', headers: {'Accept-Encoding': 'gzip', 'User-Agent': 'Mozilla/5.0'}}, function (res) {
    if (res.statusCode !== 200) { res.resume(); finish(null); return; }
    var chunks = [], body = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
    body.on('data', function (chunk) { chunks.push(chunk); });
    body.on('end', function () { finish(agendaGames(Buffer.concat(chunks).toString('utf8'))); });
    body.on('error', function () { finish(null); });
  });
  req.setTimeout(20000, function () { req.abort(); });
  req.on('error', function () { finish(null); });
}

/** The page's window.dataSportsSchedule.sport (football by day), a game each, with only what the app shows. */
function agendaGames(html) {
  var at = html.indexOf('window.dataSportsSchedule'), from = html.indexOf('sport:', at), to = html.indexOf('multisport:', from);
  if (at < 0 || from < 0 || to < 0) return null;
  var days = null;
  try { days = JSON.parse(html.slice(from + 6, to).replace(/[\s,]+$/, '')); } catch (e) { return null; }
  var out = [];
  Object.keys(days).forEach(function (day) {
    (days[day].championshipsAgenda || []).forEach(function (c) {
      ['past', 'now', 'future'].forEach(function (when) {
        (c[when] || []).forEach(function (e) {
          var m = e.match, s = m && m.scoreboard;
          if (!m || !m.firstContestant || !m.secondContestant) return;
          out.push({id: m.id, day: m.startDate, hour: String(m.startHour || '').slice(0, 5), moment: m.moment,
            champ: (c.championship && c.championship.name) || '', venue: (m.location && m.location.popularName) || '',
            home: m.firstContestant.popularName, homeCrest: m.firstContestant.badgePng || '',
            away: m.secondContestant.popularName, awayCrest: m.secondContestant.badgePng || '',
            score: s && s.home !== null && s.home !== undefined ? [s.home, s.away] : null,
            watch: (m.liveWatchSources || []).map(function (w) { return {name: w.name, logo: w.officialLogoUrl || w.highlightLogoUrl || ''}; })});
        });
      });
    });
  });
  return out;
}

service.register('agenda', function (message) {
  agenda(function (games) {
    if (games) message.respond({returnValue: true, games: games});
    else message.respond({returnValue: false, errorText: 'No agenda from ge.globo'});
  });
});

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
