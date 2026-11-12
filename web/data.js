/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), 3 per hour (up to 6 in Home Settings);
 *  - weather, sunrise and sunset (Open-Meteo, every 30 min) and optional crypto prices (Binance, every 5 min);
 *  - the day's games (ESPN's scoreboards, every minute while one is on), on TVs in Brazil.
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

/**
 * Weekday and month names for formatDate on TVs without Intl (strings.js), here where translate.py finds them.
 * "months" is the form next to a day ("28 октября"), as the catalogues' patterns use it.
 */
I18N.dateNames = function (kind) {
  if (kind === 'months') {
    return [tr('monthday|January'), tr('monthday|February'), tr('monthday|March'), tr('monthday|April'),
      tr('monthday|May'), tr('monthday|June'), tr('monthday|July'), tr('monthday|August'), tr('monthday|September'),
      tr('monthday|October'), tr('monthday|November'), tr('monthday|December')];
  }
  if (kind === 'shortMonths') {
    return [tr('month|Jan'), tr('month|Feb'), tr('month|Mar'), tr('month|Apr'), tr('month|May'), tr('month|Jun'),
      tr('month|Jul'), tr('month|Aug'), tr('month|Sep'), tr('month|Oct'), tr('month|Nov'), tr('month|Dec')];
  }
  if (kind === 'weekdays') {
    return [tr('weekday|Sunday'), tr('weekday|Monday'), tr('weekday|Tuesday'), tr('weekday|Wednesday'),
      tr('weekday|Thursday'), tr('weekday|Friday'), tr('weekday|Saturday')];
  }
  return [tr('weekday|Sun'), tr('weekday|Mon'), tr('weekday|Tue'), tr('weekday|Wed'), tr('weekday|Thu'),
    tr('weekday|Fri'), tr('weekday|Sat')];
};

var Place = (function () {
  'use strict';
  var EURO = /^(AT|BE|BG|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '40.7128',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-74.0060',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    currency: (CONFIG.currency || (country === 'BR' ? 'BRL' : EURO.test(country) ? 'EUR' : 'USD')).toUpperCase(),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', CONFIG.theme || 'auto'); },
    weather: function () { return pick('weather', true); },
    /** OK on the screensaver opens the title it shows, in its app; any other key only closes it (off by default). */
    saverWatch: function () { return pick('saverWatch', false) === true; },
    /** LG: the remote's Home button opens Free My TV (webos/homekey). On unless turned off. */
    homeKey: function () { return pick('homeKey', true) === true; },
    /** What the screensaver shows: 'photos' (the picks' photos, as it always has) or 'clock' (a clock and the weather). */
    saver: function () { return pick('saver', 'photos') === 'clock' ? 'clock' : 'photos'; },
    /** Dimming over the picture, for a dark room: 'off', 'low', 'medium', 'high' or 'auto' (medium at night). */
    dim: function () { return pick('dim', 'off'); },
    /** The weather card's forecast: 'hours' (the next 6 hours) or 'days' (the next 5 days). */
    forecast: function () { return pick('forecast', 'hours') === 'days' ? 'days' : 'hours'; },
    quotes: function () { return pick('quotes', CONFIG.showCrypto !== false); },
    /** The games panel (Brazil's football and tennis, from ESPN): on by default on TVs in Brazil. */
    sports: function () { return pick('sports', Place.country === 'BR') === true; },
    coin: function (i) { var c = pick('coins', null); return c ? c[i] !== false : true; },
    /** Picks per tab: 3 (as it was) up to 6. */
    cards: function () { var n = pick('cards', 3); return n < 3 ? 3 : n > 6 ? 6 : n; },
    /** Cartoons and anime out of the picks (Home Settings), or config.properties' hide_animation. */
    hideAnimation: function () { return pick('hideAnimation', CONFIG.hideAnimation === true) === true; },
    shelf: function () { return pick('shelf', null); },
    /** The shelf_apps of the build that last set the shelf, so a new one wins once over the TV's choice. */
    shelfConfig: function () { return pick('shelfConfig', ''); },
    /** The weather's city, picked on the TV (Home Settings → City), or config.properties' (or the time zone's). */
    city: function () { return pick('city', Place.city); },
    latitude: function () { return pick('latitude', Place.lat); },
    longitude: function () { return pick('longitude', Place.lon); },
    /** The TMDB key typed on the TV (Home Settings → TMDB key), or config.properties' ('' for none). */
    tmdbKey: function () { return String(pick('tmdbKey', CONFIG.tmdbKey || '')).trim(); },
    /** True when the key in use was typed on the TV (Remove takes it back to config.properties'). */
    tmdbKeyOnTV: function () { return v.tmdbKey !== undefined; },
    setCity: function (name, lat, lon) { v.city = name; v.latitude = lat; v.longitude = lon; save(); this.version++; },
    /** Streaming services (keys like "netflix") whose titles are left out of the picks. */
    serviceOff: function (key) { return pick('servicesOff', []).indexOf(key) >= 0; },
    setServiceOff: function (key, off) {
      var list = pick('servicesOff', []).filter(function (k) { return k !== key; });
      if (off) list.push(key);
      this.set('servicesOff', list);
    },
    openPicks: function () { return pick('openPicks', CONFIG.openPicksIn === 'nuvio' ? 'nuvio' : 'apps'); },
    set: function (name, value) { v[name] = value; save(); this.version++; },
    setCoin: function (i, on) {
      var c = (pick('coins', null) || [true, true, true, true]).slice();
      c[i] = on;
      this.set('coins', c);
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  /**
   * Open-Meteo, over plain http where https fails: its certificate chains to Let's Encrypt's ISRG root, which 2015 and
   * 2016 TVs (Tizen 2.3 and 2.4) don't trust. Only the city's coordinates and the forecast go in the clear. Each call
   * tries https first, so a newer TV whose request once timed out doesn't stay on http.
   */
  function getMeteo(path, done) {
    get('https://' + path, {}, function (err, body) {
      // A certificate the TV doesn't trust ends as a network error: status 0, or onerror.
      if (err && /^(no connection|HTTP 0)$/.test(err.message)) {
        get('http://' + path, {}, done);
        return;
      }
      done(err, body);
    });
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  function place() { return Prefs.latitude() + ',' + Prefs.longitude(); }
  // Both forecasts in one answer, the next 48 hours and today plus 5 days: Home Settings → Forecast switches without
  // asking again, and offline too.
  var QUERY = '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code'
      + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=6&forecast_hours=48';
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    // Fetched with another query (an older version): shown, and fetched again now.
    if (w && w.place === place()) { weather = parseWeather(w.body); weatherAt = w.query === QUERY ? w.at : 0; }
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, dl = o.daily, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: dl.temperature_2m_max[0], min: dl.temperature_2m_min[0],
      sunrise: localTime(dl.sunrise[0], off), sunset: localTime(dl.sunset[0], off), hours: [], days: []
    };
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    // The next 5 days, from tomorrow (none in a forecast cached before the days). Only days that haven't started at
    // the city: today, and past days in a forecast cached offline, are left out.
    for (var j = 0; dl.weather_code && j < dl.time.length && w.days.length < 5; j++) {
      if (localTime(dl.time[j] + 'T12:00', off) - 12 * 3600000 <= now) continue;
      var p = dl.time[j].split('-');   // named by its noon on the TV's clock, right even with the city far away
      w.days.push({at: new Date(+p[0], p[1] - 1, +p[2], 12).getTime(), max: dl.temperature_2m_max[j],
        min: dl.temperature_2m_min[j], code: dl.weather_code[j]});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var at = place();
    getMeteo('api.open-meteo.com/v1/forecast?latitude=' + Prefs.latitude() + '&longitude=' + Prefs.longitude() + QUERY, function (err, body) {
      fetchingWeather = false;
      if (at !== place()) { refreshWeather(); return; }   // another city was picked meanwhile
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather', {place: at, body: body, at: weatherAt, query: QUERY});
      changed();
    });
  }

  /** Places with this name (Open-Meteo, in the app's language): done(error, [{label, city, lat, lon}]). */
  function findCity(name, done) {
    var lang = I18N.lang.replace(/-.*/, '');   // Open-Meteo takes the language without the country
    getMeteo('geocoding-api.open-meteo.com/v1/search?count=10&format=json&language=' + lang + '&name='
        + encodeURIComponent(name.trim()), function (err, body) {
      if (err) { done(err); return; }
      var results = (body && body.results) || [], out = [], seen = {};
      for (var i = 0; i < results.length; i++) {
        var r = results[i], city = r.name || '';
        if (!city || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        var label = city, parts = [r.admin1, r.country];
        for (var j = 0; j < parts.length; j++) if (parts[j] && parts[j] !== city) label += ', ' + parts[j];
        if (seen['#' + label]) continue;   // places with the same name, state and country read the same
        seen['#' + label] = true;
        out.push({label: label, city: city, lat: r.latitude.toFixed(4), lon: r.longitude.toFixed(4)});
      }
      done(null, out);
    });
  }

  // MARK: - Prices

  var COINS = ['BTC', 'ETH', 'SOL', 'USDT'];
  var CURRENCY = Place.currency;
  var QUOTE = CURRENCY === 'USD' ? 'USDT' : CURRENCY;
  /** Binance refuses the whole request when it has no pairs in the currency (INR...): the prices go in dollars then. */
  function inDollars() {
    store('dollarsFor', CURRENCY);
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  /** A pair with no trade for a day: Binance halted it and keeps answering with the frozen last price (AUD since 2026-10-06). */
  function halted(list) {
    for (var i = 0; list && i < list.length; i++) if (list[i].closeTime > 0 && Date.now() - list[i].closeTime > 864e5) return true;
    return false;
  }
  if (stored('dollarsFor') === CURRENCY && CURRENCY !== 'USD') {
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  var prices = [NaN, NaN, NaN, NaN], changes = [NaN, NaN, NaN, NaN], pricesAt = 0, fetchingPrices = false;

  /** Indexes in COINS of the coins that are on (the dollar only in Brazilian reais, where Binance lists it). */
  function activeCoins() {
    var out = [];
    if (!Prefs.quotes()) return out;
    for (var i = 0; i < COINS.length; i++) if (Prefs.coin(i) && (i < 3 || CURRENCY === 'BRL')) out.push(i);
    return out;
  }

  function parsePrices(list) {
    var found = 0;
    for (var i = 0; list && i < list.length; i++) {
      for (var k = 0; k < COINS.length; k++) {
        if (list[i].symbol !== COINS[k] + QUOTE) continue;
        found++;
        var last = parseFloat(list[i].lastPrice), open = parseFloat(list[i].openPrice);
        prices[k] = last;
        changes[k] = open > 0 ? (last - open) / open * 100 : NaN;
      }
    }
    return found;
  }

  (function () {
    var p = stored('prices');
    if (p && p.quote === QUOTE && parsePrices(p.body)) pricesAt = p.at;
  })();

  function refreshPrices() {
    var coins = activeCoins(), now = Date.now();
    if (!coins.length || fetchingPrices || (now - pricesAt < 5 * 60000 && now >= pricesAt)) return;
    fetchingPrices = true;
    var symbols = coins.map(function (i) { return '%22' + COINS[i] + QUOTE + '%22'; }).join(',');
    var path = '/api/v3/ticker/24hr?type=MINI&symbols=%5B' + symbols + '%5D';
    // Binance.com refuses the US (HTTP 451); Binance.US answers the same call in dollars. data-api.binance.vision is
    // Binance's own address for public market data, with Binance.com's pairs on another domain and certificate chain:
    // it answers where a network blocks or intercepts api.binance.com (#375). A refusal skips it.
    var hosts = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api.binance.us'];
    (function next(h, refused) {
      get(hosts[h] + path, {}, function (err, body) {
        // A pair Binance doesn't list (HTTP 400): the prices go in dollars. Binance.US has only dollar pairs: its 400
        // counts only where Binance.com refuses the US (HTTP 451), not after a timeout or a 5xx there.
        if (err && err.message === 'HTTP 400' && QUOTE !== 'USDT' && (h < 2 || refused)) { fetchingPrices = false; inDollars(); refreshPrices(); return; }
        // Halted: dollars for this run, not saved like the 400's (the market may open again).
        if (!err && QUOTE !== 'USDT' && halted(body)) { fetchingPrices = false; CURRENCY = 'USD'; QUOTE = 'USDT'; refreshPrices(); return; }
        if (err || !parsePrices(body)) {
          var refusal = !!err && err.message === 'HTTP 451';
          if (h + 1 < hosts.length && !(err && err.message === 'HTTP 400')) next(refusal ? 2 : h + 1, refused || refusal);
          else fetchingPrices = false;
          return;
        }
        fetchingPrices = false;
        pricesAt = Date.now();
        store('prices', {quote: QUOTE, body: body, at: pricesAt});
        changed();
      });
    })(0);
  }

  // MARK: - Games (ESPN's public scoreboards: no key, and they answer any origin)

  // What the games panel follows: every game of the Brasileirão's Série A and B, the São Paulo and Rio derbies of the
  // state championships, Botafogo and Portuguesa wherever ESPN has them (Portuguesa's Série D and Copa Paulista come
  // from ge.globo's agenda, below), and the big tennis of the day: semifinals, finals, the season's Finals, two of the
  // top 10 against each other and every match with a Brazilian in it. Botafogo, Portuguesa, two of the top 10 and the
  // finals of the big tournaments are highlighted (`star`), and come first.
  var ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  var LUSA = '4773', BOTAFOGO = '6086', SP_BIG = ['874', '2029', '2026', '2674'], RJ_BIG = ['819', '3445', '3454', '6086'];
  var STARS = [BOTAFOGO, LUSA];
  function derby(big, a, b) { return big.indexOf(a) >= 0 && big.indexOf(b) >= 0; }
  function starred(a, b) { return STARS.indexOf(a) >= 0 || STARS.indexOf(b) >= 0; }
  var SOURCES = [
    {path: 'soccer/bra.1', tag: 'Série A'},
    {path: 'soccer/bra.2', tag: 'Série B'},
    {path: 'soccer/bra.camp.paulista', tag: 'Paulistão', keep: function (a, b) { return derby(SP_BIG, a, b) || starred(a, b); }},
    {path: 'soccer/bra.camp.carioca', tag: 'Carioca', keep: function (a, b) { return derby(RJ_BIG, a, b) || starred(a, b); }},
    {path: 'soccer/bra.copa_do_brazil', tag: 'Copa do Brasil', keep: starred},
    {path: 'soccer/conmebol.libertadores', tag: 'Libertadores', keep: starred},
    {path: 'soccer/conmebol.sudamericana', tag: 'Sul-Americana', keep: starred},
    {path: 'tennis/atp', tag: 'ATP', tennis: true},
    {path: 'tennis/wta', tag: 'WTA', tennis: true}
  ];
  // Tennis's big tournaments, whose finals are highlighted: the Grand Slams, the 1000s and the Finals.
  var BIG_TENNIS = /Australian Open|Roland Garros|French Open|Wimbledon|US Open|\bFinals\b|Masters|Indian Wells|BNP Paribas Open|Miami Open|Madrid|Internazionali|Italian Open|Canadian Open|National Bank Open|Omnium Banque|Cincinnati|Shanghai|Qatar|Doha|Dubai|Wuhan|China Open/;

  /** ESPN's "2026-11-19T22:30Z" → epoch ms. */
  function espnTime(iso) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : 0;
  }

  /** The day on the TV's clock, as ESPN's dates take it: 20261119. */
  function dayOf(at) {
    var d = new Date(at);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /** A crest or flag from ESPN (500 px) through its own resizer: a few KB instead of a hundred. */
  function crest(url) {
    var m = /^https?:\/\/a\.espncdn\.com(\/i\/[^?]+\.png)$/.exec(url || '');
    return m ? 'https://a.espncdn.com/combiner/i?img=' + m[1] + '&w=64&h=64' : url || '';
  }

  /** 'pre', 'in' or 'post'; '' for a game that won't be played (postponed, canceled). Half-time keeps its clock 'half'. */
  function gameState(status) {
    var t = (status && status.type) || {};
    if (/POSTPONED|CANCELED|ABANDONED/.test(t.name || '')) return '';
    return t.state === 'in' || t.state === 'post' ? t.state : 'pre';
  }

  function gameClock(status) {
    var t = (status && status.type) || {};
    return t.name === 'STATUS_HALFTIME' ? 'half' : (status && status.displayClock) || '';
  }

  function soccerGames(src, body) {
    var out = [], events = (body && body.events) || [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i], c = e.competitions && e.competitions[0];
      if (!c || !c.competitors || c.competitors.length !== 2) continue;
      var home = c.competitors[0].homeAway === 'away' ? c.competitors[1] : c.competitors[0];
      var away = home === c.competitors[0] ? c.competitors[1] : c.competitors[0];
      if (!home.team || !away.team || (src.keep && !src.keep(String(home.team.id), String(away.team.id)))) continue;
      var state = gameState(c.status || e.status);
      if (!state) continue;
      out.push({id: e.id, at: espnTime(c.date || e.date), state: state, clock: gameClock(c.status || e.status),
        tag: src.tag || leagueTag(e.league), home: club(home), away: club(away), venue: (c.venue && c.venue.fullName) || '',
        star: starred(String(home.team.id), String(away.team.id))});
    }
    return out;
  }

  /** A side of a game, from a scoreboard or from a club's fixtures (its crest in `logos`, its score an object). */
  function club(x) {
    var t = x.team, s = x.score, logo = t.logo || (t.logos && t.logos[0] && t.logos[0].href);
    return {name: t.shortDisplayName || t.displayName || '', crest: crest(logo),
      score: s === undefined || s === null ? '' : String(typeof s === 'object' ? s.displayValue || '' : s)};
  }

  /** A league in a club's fixtures, named as its source here is ("Série A"), or as ESPN names it. */
  function leagueTag(league) {
    for (var i = 0; league && i < SOURCES.length; i++) if (SOURCES[i].path === 'soccer/' + league.slug) return SOURCES[i].tag;
    return (league && (league.shortName || league.name)) || '';
  }

  function people(x) { return x.athlete ? [x.athlete] : (x.roster && x.roster.athletes) || []; }

  function brazilian(a) { return !!(a && a.flag && a.flag.alt === 'Brazil'); }

  /** "B. Shelton" → "Shelton"; a doubles pair "Matos / Melo", under the Brazilian's flag when there's one. */
  function player(x) {
    var list = people(x), names = [], flag = list[0];
    for (var i = 0; i < list.length; i++) {
      names.push(String(list[i].shortName || list[i].displayName || '').replace(/^[^\s.]+\.\s*/, ''));
      if (brazilian(list[i])) flag = list[i];
    }
    return {name: names.join(' / '), crest: crest(flag && flag.flag && flag.flag.href), score: ''};
  }

  /** Today's matches worth showing, from the tournaments of the day (each one lists all its days). */
  function tennisGames(src, body) {
    var out = [], events = (body && body.events) || [], today = dayOf(Date.now());
    for (var i = 0; i < events.length; i++) {
      var e = events[i], groups = e.groupings || [];
      for (var g = 0; g < groups.length; g++) {
        var singles = /singles/.test((groups[g].grouping && groups[g].grouping.slug) || ''), list = groups[g].competitions || [];
        for (var k = 0; k < list.length; k++) {
          var c = list[k], at = espnTime(c.date), round = (c.round && c.round.displayName) || '';
          if (dayOf(at) !== today || !c.competitors || c.competitors.length !== 2) continue;
          var cs = c.competitors.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          var br = people(cs[0]).concat(people(cs[1])).some(brazilian);
          var top = singles && topTen(src, cs[0].id) && topTen(src, cs[1].id), bigFinal = singles && round === 'Final' && BIG_TENNIS.test(e.name || '');
          if (!br && !top && !(singles && (/^(Semifinal|Final)$/.test(round) || /\bFinals\b/.test(e.name || '')))) continue;
          var state = gameState(c.status);
          if (!state) continue;
          var where = /\bFinals\b/.test(e.name || '') ? 'Finals' : ((c.venue && c.venue.fullName) || '').split(',')[0] || e.name || '';
          out.push({id: c.id, at: at, state: state, clock: '', tag: src.tag + ' ' + where,
            venue: (c.venue && c.venue.court) || '', star: top || bigFinal,
            tennis: true, home: player(cs[0]), away: player(cs[1]), sets: sets(cs)});
        }
      }
    }
    return out;
  }

  // The top 10 of each tour (ESPN's athlete ids, the competitors' ids in singles), once a day: 380 KB each.
  var ranks = stored('ranks') || {at: 0}, fetchingRanks = false;

  function topTen(src, id) { return (ranks[src.tag] || []).indexOf(String(id)) >= 0; }

  function refreshRanks() {
    var now = Date.now();
    if (fetchingRanks || (dayOf(ranks.at) === dayOf(now) && now >= ranks.at)) return;
    fetchingRanks = true;
    var tours = ['ATP', 'WTA'], next = {at: now}, left = tours.length;
    tours.forEach(function (tour) {
      get(ESPN + 'tennis/' + tour.toLowerCase() + '/rankings', {}, function (err, body) {
        var list = (!err && body && body.rankings && body.rankings[0] && body.rankings[0].ranks) || [];
        next[tour] = list.filter(function (r) { return r.current <= 10 && r.athlete; }).map(function (r) { return String(r.athlete.id); });
        if (--left) return;
        fetchingRanks = false;
        if (!next.ATP.length && !next.WTA.length) return;   // offline: again on the next refresh
        ranks = next;
        store('ranks', ranks);
        gamesAt['tennis/atp'] = gamesAt['tennis/wta'] = 0;   // the day's matches again, with the ranking
      });
    });
  }

  /** "6-4 3-6 2-1": the sets so far, first player's games first. */
  function sets(cs) {
    var a = cs[0].linescores || [], b = cs[1].linescores || [], out = [];
    for (var i = 0; i < a.length && i < b.length; i++) out.push(a[i].value + '-' + b[i].value);
    return out.join(' ');
  }

  var games = {}, gamesAt = {}, fetchingGames = 0;   // by source path
  (function () {
    var g = stored('games');
    if (g && g.games) { games = g.games; gamesAt = g.at || {}; }
  })();

  /** Each source again every minute while one of its games is on (or about to start), every 15 min on a day with one, else hourly. */
  function gamesEvery(list, now) {
    var today = dayOf(now), soon = false, some = false;
    for (var i = 0; list && i < list.length; i++) {
      var g = list[i];
      if (g.state === 'in' || (g.state === 'pre' && g.at - now < 10 * 60000 && now - g.at < 3 * 3600000)) soon = true;
      if (dayOf(g.at) === today) some = true;
    }
    return soon ? 60000 : some ? 15 * 60000 : 60 * 60000;
  }

  // Botafogo's next games in every competition ESPN has, for the top of the home screen: every hour.
  var fixtures = stored('fixtures') || {at: 0, list: []}, fetchingFixtures = false;

  function refreshFixtures() {
    var now = Date.now();
    if (fetchingFixtures || (now - fixtures.at < 60 * 60000 && now >= fixtures.at)) return;
    fetchingFixtures = true;
    get(ESPN + 'soccer/all/teams/' + BOTAFOGO + '/schedule?fixture=true', {}, function (err, body) {
      fetchingFixtures = false;
      fixtures = {at: Date.now() - (err ? 50 * 60000 : 0), list: err ? fixtures.list : soccerGames({}, body)};   // no answer: again in 10 minutes
      store('fixtures', fixtures);
      if (!err) changed();
    });
  }

  /** Botafogo's game on now or its next one, with the minute and the score from the day's games while it's on; or null. */
  function nextGame() {
    var now = Date.now(), list = fixtures.list.slice().sort(function (a, b) { return a.at - b.at; });
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      for (var s = 0; s < SOURCES.length; s++) {
        var day = games[SOURCES[s].path] || [];
        for (var k = 0; k < day.length; k++) if (day[k].id === g.id) g = day[k];
      }
      if (g.state !== 'post' && now - g.at < 4 * 3600000) return g;
    }
    return null;
  }

  function refreshGames() {
    if (!Prefs.sports()) return;
    refreshRanks();
    refreshAgenda();
    refreshFixtures();
    if (fetchingGames) return;
    var now = Date.now(), due = [];
    for (var i = 0; i < SOURCES.length; i++) {
      var at = gamesAt[SOURCES[i].path] || 0;
      if (now - at >= gamesEvery(games[SOURCES[i].path], now) || now < at || dayOf(at) !== dayOf(now)) due.push(SOURCES[i]);
    }
    fetchingGames = due.length;
    // The panel is drawn again once, when the last answer is in.
    due.forEach(function (src) {
      // Soccer: ESPN's day for the league, today's games or the next day with any; tennis: the tournaments of the day.
      get(ESPN + src.path + '/scoreboard' + (src.tennis ? '?dates=' + dayOf(now) : ''), {}, function (err, body) {
        if (!err) {
          games[src.path] = src.tennis ? tennisGames(src, body) : soccerGames(src, body);
          gamesAt[src.path] = Date.now();
        }
        if (--fetchingGames) return;
        store('games', {games: games, at: gamesAt});
        changed();
      });
    });
  }

  // Where each football game is on: ge.globo's agenda (five days, with TV channels and streaming services), which only
  // the LG service can read (the page answers no other origin). Every hour, and again on a new day.
  var agenda = stored('agenda') || {at: 0, games: []}, fetchingAgenda = false;

  function refreshAgenda() {
    var now = Date.now();
    if (TV.name !== 'webos' || fetchingAgenda || (now - agenda.at < 60 * 60000 && now >= agenda.at && dayOf(agenda.at) === dayOf(now))) return;
    fetchingAgenda = true;
    TV.agenda(function (list) {
      fetchingAgenda = false;
      agenda = {at: Date.now(), games: list || agenda.games};
      if (!list) agenda.at -= 50 * 60000;   // no answer: again in 10 minutes
      store('agenda', agenda);
      if (list) changed();
    });
  }

  /** ge.globo's day and hour (Brasília, UTC−3 all year since 2019) → epoch ms. */
  function agendaTime(a) {
    var d = /^(\d+)-(\d+)-(\d+)$/.exec(a.day || ''), h = /^(\d+):(\d+)/.exec(a.hour || '');
    return d && h ? Date.UTC(+d[1], d[2] - 1, +d[3], +h[1] + 3, +h[2]) : 0;
  }

  /** "Atlético-MG" → "atletico mg": names compared without accents, case or punctuation. */
  function plain(name) {
    return String(name || '').toLowerCase().replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i')
        .replace(/[óôõ]/g, 'o').replace(/ú/g, 'u').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** 2 for the same name ("Operário PR", "Operário-PR"), 1 when one starts the other ("Athletic", "Athletic Club"), else 0. */
  function sameTeam(a, b) {
    a = plain(a);
    b = plain(b);
    if (!a || !b) return 0;
    return a === b ? 2 : a.indexOf(b + ' ') === 0 || b.indexOf(a + ' ') === 0 ? 1 : 0;
  }

  /** ESPN's game in ge.globo's agenda: within half an hour, both names alike or one the same (not Botafogo for Botafogo-SP). */
  function inAgenda(g) {
    for (var i = 0; i < agenda.games.length; i++) {
      var a = agenda.games[i];
      if (Math.abs(agendaTime(a) - g.at) <= 30 * 60000 && sameTeam(a.home, g.home.name) + sameTeam(a.away, g.away.name) >= 2) return a;
    }
    return null;
  }

  /** "Campeonato Brasileiro Série D" → "Série D": the agenda's championships, short. */
  function agendaTag(champ) {
    return champ === 'Campeonato Brasileiro' ? 'Série A' : champ.replace(/^Campeonato Brasileiro /, '').replace(/^Campeonato /, '');
  }

  /** Portuguesa's games that only ge.globo has (Série D, Copa Paulista), as the panel's games. */
  function agendaOnly(espn) {
    var out = [], covered = espn.map(function (g) { return g.tennis ? null : inAgenda(g); });
    agenda.games.forEach(function (a) {
      if ((plain(a.home) !== 'portuguesa' && plain(a.away) !== 'portuguesa') || covered.indexOf(a) >= 0) return;
      var score = a.score || ['', ''];
      out.push({id: 'ge' + a.id, at: agendaTime(a), state: a.moment === 'NOW' ? 'in' : a.moment === 'PAST' ? 'post' : 'pre', clock: '',
        tag: agendaTag(a.champ), venue: a.venue, star: true,
        home: {name: a.home, crest: a.homeCrest, score: String(score[0])}, away: {name: a.away, crest: a.awayCrest, score: String(score[1])}});
    });
    return out;
  }

  /**
   * Where a game is on: {list: [{name, logo}], usual} or null when nobody says. Football from ge.globo's agenda; tennis
   * isn't in it, and in Brazil the ATP and WTA tours are on ESPN and Disney+ (2026): `usual`, as a rule, not this match.
   */
  function whereToWatch(g) {
    if (g.tennis) return {usual: true, list: [{name: 'ESPN', logo: ''}, {name: 'Disney+', logo: ''}]};
    var a = String(g.id).indexOf('ge') === 0 ? findAgenda(g.id.slice(2)) : inAgenda(g);
    return a && a.watch && a.watch.length ? {list: a.watch, usual: false} : null;
  }

  function findAgenda(id) {
    for (var i = 0; i < agenda.games.length; i++) if (String(agenda.games[i].id) === id) return agenda.games[i];
    return null;
  }

  /** The games to show: today's, or else the next day's: the highlighted ones not over first, then by time. {today, list} */
  function gameDay() {
    var all = [], now = Date.now(), today = dayOf(now);
    for (var i = 0; i < SOURCES.length; i++) all = all.concat(games[SOURCES[i].path] || []);
    all = all.concat(agendaOnly(all));
    function first(g) { return g.star && g.state !== 'post' ? 0 : 1; }
    all.sort(function (a, b) { return first(a) - first(b) || a.at - b.at || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0); });
    var list = all.filter(function (g) { return dayOf(g.at) === today; });
    if (list.length) return {today: true, list: list};
    var next = all.filter(function (g) { return g.at > now; });
    next.sort(function (a, b) { return a.at - b.at; });
    var day = next.length ? dayOf(next[0].at) : 0;
    next = next.filter(function (g) { return dayOf(g.at) === day; });
    next.sort(function (a, b) { return first(a) - first(b) || a.at - b.at; });
    return {today: false, list: next};
  }

  // MARK: - Picks (TMDB)

  var KEY = Prefs.tmdbKey();
  var REGION = Place.country;
  var API = 'https://api.tmdb.org/3';   // TMDB's own mirror of api.themoviedb.org: some ISPs block the other name (#327)

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll'],
    ['now tv', 'now', /nowtv|now\.tv/, /^now( tv)?$/i, 'NOW']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** A service whose app is on the TV and that the person hasn't switched off in Home Settings (Picks from). */
  function usable(key) { return !!appFor(key) && !Prefs.serviceOff(key); }

  /** The streaming services whose app is on this TV, as {key, name}, for Home Settings. */
  function services() {
    var out = [];
    for (var s = 0; s < SERVICES.length; s++) if (appFor(SERVICES[s][1])) out.push({key: SERVICES[s][1], name: SERVICES[s][4]});
    return out;
  }

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  /** "… Amazon Channel" is sold inside another app; Apple TV is only the streaming service (350; 2 is the store). */
  function service(providerName, providerId) {
    var n = (providerName || '').toLowerCase();
    if (n.indexOf(' channel') >= 0) return null;
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[1] === 'appletv' && providerId !== 350) continue;
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  function tmdb(path, done, key) {
    key = key || KEY;
    var bearer = key.indexOf('eyJ') === 0;   // read access token (v4) or API key (v3)
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
    get(url, bearer ? {Authorization: 'Bearer ' + key, Accept: 'application/json'} : {Accept: 'application/json'}, done);
  }

  /** Asks TMDB whether a key works before it's saved: done(error), with error.rejected when TMDB said no. */
  function checkKey(key, done) {
    tmdb('/configuration', function (err) {
      if (err && /rejected/.test(err.message)) err.rejected = true;
      done(err || null);
    }, key);
  }

  var cache = stored('recs') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';

  function saveRecs() { store('recs', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (Prefs.hideAnimation() ? ':no-animation' : '');
    for (var i = 0; i < SERVICES.length; i++) s += usable(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /** This hour's picks (Prefs.cards()): movies ("movie"), shows ("tv") or both (null). */
  function now(kind) {
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      if ((kind === null || kind === p.kind) && (!p.detailed || (p.app && usable(p.app)))) list.push(p);
    }
    if (!list.length) return list;
    var hour = Math.floor(Date.now() / 3600000), out = [], seen = {}, n = Prefs.cards();
    for (var j = 0; j < list.length && out.length < n; j++) {
      var q = list[(hour * n + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  /** TMDB's language, as on Android: Latin American Spanish unless the TV is in Spain, and Germany's German. */
  function lang() {
    if (I18N.lang === 'es') return /-ES\b/i.test(navigator.language || '') ? 'es-ES' : 'es-MX';
    if (I18N.lang === 'de') return 'de-DE';   // TMDB's de-AT and de-CH have few translations of their own
    return I18N.locale();
  }

  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /** TMDB's genres that it leaves in English in some languages. */
  function genre(name) {
    switch (name) {
      case 'Action & Adventure': return tr('genre|Action & Adventure');
      case 'Sci-Fi & Fantasy': return tr('genre|Sci-Fi & Fantasy');
      case 'War & Politics': return tr('genre|War & Politics');
      case 'Kids': return tr('genre|Kids');
      case 'News': return tr('genre|News');
      case 'Soap': return tr('genre|Soap');
      case 'Talk': return tr('genre|Talk');
      default: return name;
    }
  }

  /** The best backdrop: no text over it, the largest, then the best rated. */
  function bestBackdrop(images) {
    var list = images && images.backdrops, best = null, score = -1;
    for (var i = 0; list && i < list.length; i++) {
      var b = list[i];
      if (!b.file_path) continue;
      var s = (b.iso_639_1 === null ? 1e7 : 0) + Math.min(b.width || 0, 3840) * 100 + (b.vote_average || 0);
      if (s > score) { score = s; best = b.file_path; }
    }
    return best;
  }

  /** Genre, runtime or seasons, and the service it's on among the TV's apps. */
  function details(p, done) {
    tmdb('/' + p.kind + '/' + p.id + '?language=' + lang() + '&append_to_response=watch/providers,images&include_image_language=null,'
        + I18N.base + ',en', function (err, o) {
      if (err) { done(err); return; }
      var best = bestBackdrop(o.images);
      if (best) p.backdrop = best;
      if (o.poster_path) p.poster = o.poster_path;
      var parts = [];
      if (p.kind === 'tv') parts.push(tr('Series'));
      if (o.genres && o.genres.length) {
        parts.push(genre(o.genres[0].name));
      }
      if (p.kind === 'movie' && o.runtime > 0) {
        var h = Math.floor(o.runtime / 60), m = o.runtime % 60;
        parts.push(h ? trf('{h}h {m}m', {h: h, m: m}) : trf('{m}m', {m: m}));
      } else if (p.kind === 'tv' && o.number_of_seasons > 0) {
        parts.push(plural('plural|one:{n} season|other:{n} seasons', o.number_of_seasons));
      }
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], flat = here && here.flatrate;
      p.app = null;
      for (var i = 0; flat && i < flat.length && !p.app; i++) {
        var s = service(flat[i].provider_name, flat[i].provider_id);
        if (s && usable(s[1])) { p.app = s[1]; p.service = s[4]; }
      }
      if (p.service && p.app) parts.push(p.service);
      p.meta = parts.join(' · ');
      title(p, o, function () {
        p.detailed = true;
        done(null);
      });
    });
  }

  /**
   * Without a title in the TV's language TMDB answers with the original one, so a Korean series on a German TV reads
   * "닥터X: 하얀 마피아의 시대". Then the English title, when TMDB has one (one more request, only for those).
   */
  function title(p, o, done) {
    var field = p.kind === 'movie' ? 'title' : 'name', own = o[field] || p.title;
    p.title = own;
    if (I18N.lang === 'en' || !own || own !== o['original_' + field] || o.original_language === I18N.base
        || o.original_language === 'en') { done(); return; }
    tmdb('/' + p.kind + '/' + p.id + '?language=en-US', function (err, en) {
      if (!err && en && en[field]) p.title = en[field];
      done();
    });
  }

  /** TMDB's Animation genre (movies and shows: cartoons and anime), left out with Cartoons and anime off. */
  var ANIMATION = 16;

  function animated(o) {
    for (var i = 0; o.genre_ids && i < o.genre_ids.length; i++) if (o.genre_ids[i] === ANIMATION) return true;
    return false;
  }

  function addPick(list, o, kind) {
    if (!o.backdrop_path) return;
    if (Prefs.hideAnimation() && animated(o)) return;
    list.push({id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path, poster: o.poster_path || '', meta: '', app: null, detailed: false});
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  function fetchList(done) {
    tmdb('/watch/providers/movie?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name, res.results[i].provider_id);
        if (s && usable(s[1])) ids.push(res.results[i].provider_id);
      }
      if (!ids.length) { done(new Error("none of the TV's streaming apps are on TMDB (or switched on in Picks from)")); return; }
      var common = '&language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate&include_adult=false'
          + '&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
          + (Prefs.hideAnimation() ? '&without_genres=' + ANIMATION : '');
      var hot = {movie: [], tv: []}, fresh = {movie: [], tv: []};
      each(['movie', 'tv'], function (kind, next) {
        tmdb('/trending/' + kind + '/week?language=' + lang(), function (e, r) {
          var candidates = [];
          for (var j = 0; !e && j < r.results.length && j < 16; j++) addPick(candidates, r.results[j], kind);
          // Trending is only kept when it's on one of the TV's apps: the details say where.
          each(candidates, function (p, n) {
            details(p, function (de) { if (!de && p.app) hot[kind].push(p); n(); });
          }, next);
        });
      }, function () {
        tmdb('/discover/movie?vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0) + common, function (e1, r1) {
          for (var j = 0; !e1 && j < r1.results.length; j++) addPick(fresh.movie, r1.results[j], 'movie');
          tmdb('/discover/tv?vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0) + common, function (e2, r2) {
            for (var k = 0; !e2 && k < r2.results.length; k++) addPick(fresh.tv, r2.results[k], 'tv');
            var list = [], seen = {};
            alternate(list, seen, hot.movie, hot.tv, 24);
            alternate(list, seen, fresh.movie, fresh.tv, 24);
            if (!list.length) { done(new Error('TMDB returned no recommendations')); return; }
            picks = list;
            done(null);
          });
        });
      });
    });
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) return;
    var stale = st !== stamp || p !== period || t - listAt > 6 * 3600000 || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || !wanted[i].detailed;
    if (!stale && !missing) return;
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(function (x) { return !x.detailed; });
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k]);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    // Old WebKit (Tizen 2) has no Intl: toLocaleString ignores its options and prints every digit, without failing.
    // English separators there; a per-language table if someone asks.
    if (typeof Intl === 'undefined') return v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  var SYMBOLS = {USD: '$', BRL: 'R$ ', EUR: '€', GBP: '£', JPY: '¥'};

  return {
    COINS: COINS,
    get city() { return Prefs.city(); },
    currency: CURRENCY,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    usable: usable,
    services: services,
    refresh: function () { refreshWeather(); refreshPrices(); refreshGames(); refreshRecs(); },
    settingsChanged: function () { pricesAt = 0; refreshPrices(); changed(); },
    /** The games panel turned on or off. */
    sportsChanged: function () { refreshGames(); changed(); },
    gameDay: gameDay,
    nextGame: nextGame,
    whereToWatch: whereToWatch,
    findCity: findCity,
    /** Another city picked: its weather now (none shown until it comes). */
    cityChanged: function () { weather = null; weatherAt = 0; refreshWeather(); changed(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },
    prices: prices,
    changes: changes,
    get pricesAt() { return pricesAt; },
    activeCoins: activeCoins,
    hasKey: function () { return !!KEY; },
    checkKey: checkKey,
    /** A key typed (or removed) on the TV: the picks come again with it, or go. */
    keyChanged: function () { KEY = Prefs.tmdbKey(); recsError = ''; failedAt = 0; refreshRecs(); changed(); },
    recsError: function () { return recsError; },
    picks: now,
    showcase: all,
    image: function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path : ''; },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    compact: function (v) {
      if (isNaN(v)) return '—';
      if (v >= 1000000) return fmt(v / 1000000, 2) + 'M';
      if (v >= 10000) return fmt(v / 1000, 1) + 'k';
      if (v >= 1000) return fmt(v / 1000, 2) + 'k';
      if (v >= 100) return fmt(v, 0);
      return fmt(v, 2);
    },
    money: function (v) {
      var s = SYMBOLS[CURRENCY] || CURRENCY + ' ';
      if (isNaN(v)) return s + '—';
      return s + (v >= 1000 ? fmt(v, 0) : fmt(v, 2));
    },
    change: function (v) { return isNaN(v) ? '' : (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; },
    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    /** "3 PM", "15:00", "15 Uhr": the hourly forecast. */
    hour: function (at) { return formatDate('format|h a', at); },
    /** "Seg", "Mon", "Lun", "Mo", "Пн": the short day of the week, capitalized and without the abbreviation's dot. */
    weekday: function (at) {
      var s = formatDate('format|EEE', at).replace(/\.$/, '');
      return s.charAt(0).toUpperCase() + s.substring(1);
    },
    /** "5:21 AM", "05:21": the clock, sunrise and sunset. */
    time: function (at) { return formatDate('format|h:mm a', at); },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? trf('{n} min ago', {n: m}) : trf('{n} h ago', {n: h});
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return day ? tr('Clear') : tr('night|Clear');
      if (code === 1) return day ? tr('Mostly Sunny') : tr('Mostly Clear');
      if (code === 2) return tr('Partly Cloudy');
      if (code === 3) return tr('Cloudy');
      if (code === 45 || code === 48) return tr('Fog');
      if (code >= 51 && code <= 57) return tr('Drizzle');
      if (code === 65 || code === 67 || code === 82) return tr('Heavy Rain');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Snow');
      if (code >= 95) return tr('Thunderstorms');
      return tr('Rain');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    },
    coinName: function (i) { return i === 3 ? tr('Dollar') : ['Bitcoin', 'Ethereum', 'Solana'][i]; }
  };
})();
