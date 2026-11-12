/*
 * Door dashboard - runs on Safari 12 (iOS 12.5).
 * Language level: ES2017 max. No ?. ?? class fields, object spread,
 * optional catch binding, Promise.allSettled, Array.flat.
 */
(function () {
  'use strict';

  // All personal settings (location, station, timetable) arrive encrypted in
  // data/config.enc.json and are only readable with the key from the URL.
  var C = null, TT = null;
  var DEFAULTS = {
    night: { start: '22:30', end: '05:30' },
    nightlyReload: '03:30',
    refresh: { weather: 15, transit: 2, holidays: 720, privateData: 10, version: 5 }
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_S = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MIN = 60000;

  // ------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12); return x; }
  function toMin(s) { var p = s.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function nowMin(d) { return d.getHours() * 60 + d.getMinutes(); }
  function keyToDate(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function setHTML(el, html) { if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; } }
  function daysBetween(aKey, bKey) { return Math.round((keyToDate(bKey) - keyToDate(aKey)) / 86400000); }
  function fmtDur(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  var store = {
    get: function (k) {
      try { var v = localStorage.getItem('dd_' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (k, v) {
      try { localStorage.setItem('dd_' + k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ }
    }
  };

  function fetchJSON(url, timeoutMs) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        reject(new Error('timeout'));
      }, timeoutMs || 15000);
    });
    var opts = { cache: 'no-store', credentials: 'omit' };
    if (ctrl) opts.signal = ctrl.signal;
    var req = fetch(url, opts).then(function (r) {
      if (!r.ok) { var err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
      return r.json();
    });
    return Promise.race([req, timeout]).then(function (v) {
      clearTimeout(timer); return v;
    }, function (e) {
      clearTimeout(timer); throw e;
    });
  }

  // ------------------------------------------------------------ state
  // Each source: { data, ts (ms of last success), err }
  var S = {};
  ['weather', 'transit', 'route', 'holidays', 'untis', 'calendar'].forEach(function (k) {
    var cached = store.get(k);
    S[k] = { data: cached ? cached.data : null, ts: cached ? cached.ts : 0, err: null };
  });

  function ok(name, data) {
    S[name].data = data; S[name].ts = Date.now(); S[name].err = null;
    store.set(name, { data: data, ts: S[name].ts });
    renderAll(true);
  }
  function fail(name, e) {
    S[name].err = (e && e.message) || 'error';
    renderAll(true);
  }

  // "Updated 07:41" / stale warning
  function stamp(name, staleAfterMin) {
    var s = S[name];
    if (!s.ts) return '';
    var age = (Date.now() - s.ts) / MIN;
    var t = hm(new Date(s.ts));
    if (age > staleAfterMin) return '<div class="stamp stale">⚠ stale · last update ' + t + '</div>';
    return '<div class="stamp">updated ' + t + '</div>';
  }

  // ------------------------------------------------------------ weather
  var WMO = {
    0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅️', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫', 'Fog'], 48: ['🌫', 'Icy fog'],
    51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌧', 'Heavy drizzle'],
    56: ['🌧', 'Freezing drizzle'], 57: ['🌧', 'Freezing drizzle'],
    61: ['🌦', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'],
    66: ['🌧', 'Freezing rain'], 67: ['🌧', 'Freezing rain'],
    71: ['🌨', 'Light snow'], 73: ['🌨', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨', 'Snow grains'],
    80: ['🌦', 'Showers'], 81: ['🌧', 'Showers'], 82: ['⛈', 'Heavy showers'],
    85: ['🌨', 'Snow showers'], 86: ['❄️', 'Snow showers'],
    95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Thunderstorm, hail'], 99: ['⛈', 'Thunderstorm, hail']
  };
  function wmo(code, isDay) {
    var w = WMO[code] || ['🌡', 'Weather'];
    if (!isDay && (code === 0 || code === 1)) return ['🌙', w[1]];
    return w;
  }

  function loadWeather() {
    var w = C.weather;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.lat + '&longitude=' + w.lon +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,precipitation' +
      '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,is_day,wind_gusts_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset' +
      '&timezone=Europe%2FBerlin&timeformat=unixtime&forecast_days=2';
    return fetchJSON(url).then(function (j) {
      if (!j || !j.current || !j.hourly) throw new Error('bad weather data');
      ok('weather', j);
    }, function (e) { fail('weather', e); });
  }

  function weatherHints(j, now) {
    var h = j.hourly, hints = [];
    var t0 = now.getTime() / 1000;
    var maxP = 0, sumR = 0, minFeel = 99, maxT = -99, snow = false, gust = 0, freezing = false, storm = false;
    var rainFrom = null;
    for (var i = 0; i < h.time.length; i++) {
      if (h.time[i] < t0 - 3600 || h.time[i] > t0 + 10 * 3600) continue;
      var p = h.precipitation_probability[i] || 0;
      if (p > maxP) maxP = p;
      if (rainFrom === null && (p >= 55 || (h.precipitation[i] || 0) >= 0.3)) rainFrom = h.time[i];
      sumR += h.precipitation[i] || 0;
      if (h.apparent_temperature[i] < minFeel) minFeel = h.apparent_temperature[i];
      if (h.temperature_2m[i] > maxT) maxT = h.temperature_2m[i];
      var c = h.weather_code[i];
      if ((c >= 71 && c <= 77) || c === 85 || c === 86) snow = true;
      if (c === 56 || c === 57 || c === 66 || c === 67) freezing = true;
      if (c >= 95) storm = true;
      if ((h.wind_gusts_10m[i] || 0) > gust) gust = h.wind_gusts_10m[i];
    }
    if (storm) hints.push('⛈ Thunderstorms expected – be careful');
    if (snow) hints.push('❄️ Snow – wear boots');
    else if (maxP >= 55 || sumR >= 1) {
      hints.push('☂️ Take an umbrella' + (rainFrom && rainFrom > t0 + 3600 ? ' (rain from ' + hm(new Date(rainFrom * 1000)) + ')' : ''));
    }
    else if (maxP >= 30 || sumR >= 0.3) hints.push('🌂 Maybe pack an umbrella');
    if (freezing || (j.current.temperature_2m <= 1 && sumR > 0)) hints.push('⚠️ Slippery – watch for ice');
    if (minFeel < 0) hints.push('🧤 Freezing – coat, hat & gloves');
    else if (minFeel < 8) hints.push('🧥 Wear a warm jacket');
    else if (minFeel < 15) hints.push('🧥 Take a jacket');
    else if (maxT >= 27) hints.push('💧 Hot – take water');
    if (gust >= 55) hints.push('💨 Strong wind (' + Math.round(gust) + ' km/h gusts)');
    if (!hints.length) hints.push('👍 No jacket or umbrella needed');
    if (j.daily && j.daily.uv_index_max && j.daily.uv_index_max[0] >= 6 && now.getHours() < 16) {
      hints.push('🧴 High UV – sunscreen');
    }
    return hints.slice(0, 2);
  }

  function renderWeather(now) {
    var el = $('weather'), j = S.weather.data;
    if (!j) {
      setHTML(el, '<div class="loading">' + (S.weather.err ? 'Weather unavailable – retrying…' : 'Loading weather…') + '</div>');
      return;
    }
    var c = j.current, w = wmo(c.weather_code, c.is_day);
    var d = j.daily;
    var hi = d ? Math.round(d.temperature_2m_max[0]) : null, lo = d ? Math.round(d.temperature_2m_min[0]) : null;
    var html = '<div class="wNow"><div class="wIcon">' + w[0] + '</div>' +
      '<div class="wTemp">' + Math.round(c.temperature_2m) + '°</div>' +
      '<div class="wMeta"><b>' + esc(w[1]) + '</b><br>Feels like ' + Math.round(c.apparent_temperature) + '°' +
      (hi !== null ? '<br>Today ' + lo + '° / ' + hi + '°' : '') +
      '<br>Wind ' + Math.round(c.wind_speed_10m) + ' km/h</div></div>';
    html += '<div class="wHint"><div>' + weatherHints(j, now).map(esc).join('</div><div>') + '</div></div>';

    // next hours
    var h = j.hourly, t0 = now.getTime() / 1000, cells = [];
    for (var i = 0; i < h.time.length && cells.length < 7; i++) {
      if (h.time[i] <= t0 - 1800) continue;
      var hw = wmo(h.weather_code[i], h.is_day[i]);
      var p = h.precipitation_probability[i];
      cells.push('<div class="wHour">' + pad(new Date(h.time[i] * 1000).getHours()) + ':00' +
        '<span class="i">' + hw[0] + '</span><span class="t">' + Math.round(h.temperature_2m[i]) + '°</span>' +
        '<span class="p">' + (p >= 10 ? p + '%' : '') + '</span></div>');
    }
    html += '<div class="wHours">' + cells.join('') + '</div>';
    html += stamp('weather', C.refresh.weather * 3);
    setHTML(el, html);
  }

  // ------------------------------------------------------------ transit
  function matchesDirection(texts, dirs) {
    var m = dirs || C.transit.directionMatch || [];
    if (!m.length) return true;
    for (var i = 0; i < texts.length; i++) {
      var t = String(texts[i] || '').toLowerCase();
      for (var k = 0; k < m.length; k++) if (t.indexOf(m[k].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function fromTransitous(j, dirs) {
    var out = [];
    (j.stopTimes || []).forEach(function (st) {
      var p = st.place || {};
      if (p.pickupType === 'NOT_ALLOWED') return;
      if (!matchesDirection([st.headsign, st.tripTo && st.tripTo.name], dirs)) return;
      var plan = Date.parse(p.scheduledDeparture), when = Date.parse(p.departure || p.scheduledDeparture);
      if (isNaN(plan)) return;
      var line = st.routeShortName || st.displayName || '';
      var railLine = /^(RB|RE|S|IC|ICE|EC|RS)\s?\d/i.test(line);
      out.push({
        plan: plan, when: isNaN(when) ? plan : when,
        delay: st.realTime ? Math.round(((isNaN(when) ? plan : when) - plan) / MIN) : null,
        line: line,
        dest: (st.headsign || (st.tripTo && st.tripTo.name) || '').replace(', Hauptbahnhof', ' Hbf'),
        platform: p.track || p.scheduledTrack || '',
        cancelled: !!(st.cancelled || st.tripCancelled || p.cancelled),
        bus: st.mode === 'BUS',
        replacement: st.mode === 'BUS' && railLine,
        mode: st.mode || ''
      });
    });
    return out;
  }

  function fromDBF(j, now) {
    var out = [];
    (j.departures || []).forEach(function (d) {
      var routeNames = (d.route || []).map(function (r) { return r.name; });
      if (!matchesDirection([d.destination].concat(routeNames))) return;
      if (!d.scheduledDeparture) return;
      var t = toMin(d.scheduledDeparture);
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(t / 60), t % 60);
      if (day.getTime() < now.getTime() - 6 * 60 * MIN) day = new Date(day.getTime() + 86400000);
      var plan = day.getTime();
      var delay = (typeof d.delayDeparture === 'number') ? d.delayDeparture : null;
      out.push({
        plan: plan, when: plan + (delay || 0) * MIN, delay: delay,
        line: d.train || '', dest: d.destination || '', platform: d.platform || '',
        cancelled: !!d.isCancelled, bus: false, replacement: false
      });
    });
    return out;
  }

  function loadTransit() {
    var T = C.transit, now = new Date();
    var u1 = 'https://api.transitous.org/api/v5/stoptimes?stopId=' + encodeURIComponent(T.transitousStopId) + '&n=40';
    return fetchJSON(u1).then(function (j) {
      return { src: 'Transitous', deps: fromTransitous(j) };
    }).catch(function () {
      var u2 = 'https://dbf.finalrewind.org/' + encodeURIComponent(T.dbfStation) + '.json';
      return fetchJSON(u2).then(function (j) { return { src: 'DBF', deps: fromDBF(j, now) }; });
    }).then(function (r) {
      r.deps.sort(function (a, b) { return a.when - b.when; });
      ok('transit', r);
    }, function (e) { fail('transit', e); });
  }

  // ------------------------------------------------------------ school route ("To school" box)
  // config.schoolRoutes: [{ name, stopId, stop, lines:['S30'], mode:'bus'|'rail'|'',
  //   directionMatch:[...], walkMinutes, to, window:['05:30','07:45'] }]
  function routes() { return (C && C.schoolRoutes) || []; }

  function routeActive(now) {
    // Only on school days, from the window start until the first lesson.
    if (!routes().length) return false;
    var sd = schoolDay(now), start = dayStart(sd);
    if (sd.kind !== 'school' || !start) return false;
    var m = nowMin(now), from = 24 * 60;
    routes().forEach(function (r) { if (r.window) from = Math.min(from, toMin(r.window[0]) - 60); });
    return m >= from && m < toMin(start);
  }

  function loadRoutes() {
    if (!routeActive(new Date())) return Promise.resolve();
    var list = routes();
    return Promise.all(list.map(function (r, idx) {
      var u = 'https://api.transitous.org/api/v5/stoptimes?stopId=' + encodeURIComponent(r.stopId) + '&n=30' +
        '&time=' + encodeURIComponent(new Date(Date.now() - 5 * MIN).toISOString());
      return fetchJSON(u).then(function (j) {
        return fromTransitous(j, r.directionMatch).filter(function (d) {
          if (r.lines && r.lines.length) {
            var okLine = false;
            for (var k = 0; k < r.lines.length; k++) if (d.line.indexOf(r.lines[k]) === 0) okLine = true;
            if (!okLine) return false;
          }
          if (r.mode === 'bus' && !d.bus) return false;
          if (r.mode === 'rail' && d.bus) return false;
          if (r.window) {
            var dm = nowMin(new Date(d.plan));
            if (dm < toMin(r.window[0]) || dm > toMin(r.window[1])) return false;
          }
          d.route = idx;
          return true;
        });
      });
    })).then(function (lists) {
      var all = [];
      lists.forEach(function (l) { all = all.concat(l); });
      all.sort(function (a, b) { return a.when - b.when; });
      ok('route', all);
    }, function (e) { fail('route', e); });
  }

  // Next connection you can still catch (walking time included).
  function nextRoute(now) {
    var deps = S.route.data || [], t = now.getTime();
    var fresh = (Date.now() - S.route.ts) < 30 * MIN;
    if (!fresh) return null;
    for (var i = 0; i < deps.length; i++) {
      var d = deps[i], r = routes()[d.route];
      if (!r || d.cancelled) continue;
      if (d.when - (r.walkMinutes || 0) * MIN >= t - 30000) return { d: d, r: r };
    }
    return null;
  }

  function routeBanners(now) {
    var out = [];
    if (!routeActive(now)) return out;
    var deps = S.route.data || [], t = now.getTime();
    for (var i = 0; i < deps.length; i++) {
      var d = deps[i], r = routes()[d.route];
      if (!r || d.when < t || d.when - t > 90 * MIN) continue;
      if (d.cancelled) out.push({ cls: 'bad', text: '✕ ' + d.line + ' ' + hm(new Date(d.plan)) + ' from ' + r.stop + ' is cancelled' });
      else if (d.delay !== null && d.delay >= 5) {
        out.push({ cls: 'bad', text: '⏱ ' + d.line + ' ' + hm(new Date(d.plan)) + ' is ' + d.delay + ' min late – leave at ' +
          hm(new Date(d.when - (r.walkMinutes || 0) * MIN)) });
      }
    }
    return out.slice(0, 2);
  }

  function routeBox(now) {
    if (!routeActive(now)) return '';
    var n = nextRoute(now);
    if (!n) {
      return S.route.ts ? '<div class="route late"><div class="rLbl">TO SCHOOL</div><div class="rMain">No usual connection left</div>' +
        '<div class="rSub">Check the DB Navigator app</div></div>' : '';
    }
    var d = n.d, r = n.r, leaveAt = d.when - (r.walkMinutes || 0) * MIN;
    var leaveIn = Math.round((leaveAt - now.getTime()) / MIN);
    var delay = d.delay === null ? '' : d.delay > 0 ? ' <span class="late-red">+' + d.delay + '</span>' : ' <span class="ontime">on time</span>';
    var leave = leaveIn <= 0 ? '<b class="ontime">Leave now</b>' : leaveIn <= 20 ? 'Leave in <b>' + leaveIn + ' min</b>' : 'Leave at <b>' + hm(new Date(leaveAt)) + '</b>';
    return '<div class="route' + (leaveIn <= 5 ? ' soon' : '') + '"><div class="rLbl">TO SCHOOL</div>' +
      '<div class="rMain"><span class="dLine">' + esc(d.line) + '</span>' + hm(new Date(d.plan)) + ' ' + esc(r.stop) + delay + '</div>' +
      '<div class="rSub">' + leave + (r.to ? ' · → ' + esc(r.to) : '') + '</div></div>';
  }

  function renderTransit(now) {
    var el = $('transit'), T = C.transit, r = S.transit.data;
    var box = routeBox(now);
    var title = '<h2>Departures → ' + esc((T.directionMatch && T.directionMatch[0]) || T.stationName) + '</h2>' + box;
    if (!r) {
      setHTML(el, title + '<div class="loading">' + (S.transit.err ? 'Departures unavailable – retrying…' : 'Loading departures…') + '</div>');
      return;
    }
    var t = now.getTime(), rows = [], maxRows = box ? Math.max(3, T.maxRows - 2) : T.maxRows;
    for (var i = 0; i < r.deps.length && rows.length < maxRows; i++) {
      var d = r.deps[i];
      var mins = Math.round((d.when - t) / MIN);
      if (mins < 0) continue;
      var leave = mins - T.walkMinutes;
      var cls = 'dep' + (d.cancelled ? ' cancel' : '');
      var timeSub = '';
      if (d.cancelled) timeSub = '<small class="late-red">cancelled</small>';
      else if (d.delay !== null && d.delay > 0) timeSub = '<small class="late-red">+' + d.delay + '</small>';
      else if (d.delay === 0) timeSub = '<small class="ontime">on time</small>';
      var sub = [];
      if (d.replacement) sub.push('<span class="busTxt">🚌 Bus</span>');
      else if (d.platform) sub.push((d.bus ? 'Stop ' : 'Pl. ') + esc(d.platform));
      var inCls = 'dIn';
      if (!d.cancelled) {
        if (leave < 0) { sub.push('too late to walk'); inCls += ' late'; }
        else if (leave === 0) { sub.push('<b class="ontime">Leave now</b>'); inCls += ' go'; }
        else if (leave <= 15) { sub.push('leave in ' + leave + ' min'); if (leave <= 5) inCls += ' go'; }
        else sub.push('leave at ' + hm(new Date(d.when - T.walkMinutes * MIN)));
      }
      rows.push('<div class="' + cls + '">' +
        '<div class="dTime">' + hm(new Date(d.plan)) + timeSub + '</div>' +
        '<div class="dMain"><div class="dDest"><span class="dLine">' + esc(d.line) + '</span>' + esc(d.dest) + '</div>' +
        '<div class="dSub">' + sub.join(' · ') + '</div></div>' +
        '<div class="' + inCls + '">' + (d.cancelled ? '–' : mins === 0 ? 'now' : mins < 60 ? mins + '′' : '') + '</div>' +
        '</div>');
    }
    if (!rows.length) rows.push('<div class="empty">No departures towards ' +
      esc((T.directionMatch && T.directionMatch[0]) || '') + ' in the next hours.</div>');
    setHTML(el, title + rows.join('') + stamp('transit', 10));
  }

  // ------------------------------------------------------------ holidays
  function loadHolidays() {
    var H = C.holidays, from = dayKey(new Date()), to = dayKey(addDays(new Date(), 200));
    var q = '?countryIsoCode=' + H.country + '&subdivisionCode=' + H.subdivision +
      '&languageIsoCode=EN&validFrom=' + from + '&validTo=' + to;
    function map(type) {
      return function (arr) {
        return (arr || []).map(function (h) {
          var name = (h.name && h.name[0] && h.name[0].text) || 'Holiday';
          return { start: h.startDate, end: h.endDate, name: name, type: type };
        });
      };
    }
    // School holidays may include today, so start a few weeks back.
    var qSchool = q.replace('validFrom=' + from, 'validFrom=' + dayKey(addDays(new Date(), -30)));
    return Promise.all([
      fetchJSON('https://openholidaysapi.org/SchoolHolidays' + qSchool).then(map('school')),
      fetchJSON('https://openholidaysapi.org/PublicHolidays' + q).then(map('public'))
    ]).then(function (r) {
      ok('holidays', r[0].concat(r[1]).sort(function (a, b) { return a.start < b.start ? -1 : 1; }));
    }, function (e) { fail('holidays', e); });
  }

  function holidayOn(key) {
    var list = S.holidays.data || [];
    for (var i = 0; i < list.length; i++) if (list[i].start <= key && list[i].end >= key) return list[i];
    return null;
  }

  // ------------------------------------------------------------ private data (WebUntis / calendar)
  function b64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function dataKey() {
    var m = /[#&]k=([^&]+)/.exec(location.hash);
    if (m) { store.set('key', decodeURIComponent(m[1])); return decodeURIComponent(m[1]); }
    return store.get('key');
  }
  var subtle = window.crypto && window.crypto.subtle;
  var privateMissing = {};

  function decrypt(obj, pass) {
    var enc = new TextEncoder();
    return subtle.digest('SHA-256', enc.encode(pass)).then(function (hash) {
      return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);
    }).then(function (k) {
      return subtle.decrypt({ name: 'AES-GCM', iv: b64(obj.iv) }, k, b64(obj.ct));
    }).then(function (buf) {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
    });
  }

  function loadPrivate() {
    var key = dataKey();
    if (!key || !subtle) return Promise.resolve();
    function one(name, onData) {
      return fetchJSON('data/' + name + '.enc.json?t=' + Date.now()).then(function (obj) {
        privateMissing[name] = false;
        return decrypt(obj, key);
      }).then(function (data) {
        if (data) (onData || function (d) { ok(name, d); })(data);
      }, function (e) {
        if (e && e.status === 404) privateMissing[name] = true;
        else if (S[name]) fail(name, e);
        else lockMsg = (e && e.name === 'OperationError') ? 'Wrong key' : lockMsg;
      });
    }
    return Promise.all([one('config', gotConfig), one('untis'), one('calendar')]);
  }

  function gotConfig(data) {
    if (!data || !data.config) return;
    var old = store.get('cfg');
    store.set('cfg', { data: data, ts: Date.now() });
    if (!C) { applyConfig(data); renderAll(true); }
    else if (old && JSON.stringify(old.data) !== JSON.stringify(data)) reloadTo(version || Date.now());
  }

  function applyConfig(data) {
    var c = data.config || {};
    C = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) C[k] = c[k];
    if (!C.night) C.night = DEFAULTS.night;
    if (!C.nightlyReload) C.nightlyReload = DEFAULTS.nightlyReload;
    C.refresh = Object.assign({}, DEFAULTS.refresh, c.refresh || {});
    TT = data.timetable || { blocks: {}, week: {}, reminders: [] };
    setupTasks();
  }

  // ------------------------------------------------------------ school
  function staticLessons(date) {
    var day = (TT.week[date.getDay()] || []);
    return day.map(function (l) {
      var b = TT.blocks[l.block];
      return { start: b[0], end: b[1], subject: l.subject, teacher: l.teacher || '',
        room: l.room || TT.defaultRoom || '', status: 'normal', note: '' };
    });
  }

  // Returns { kind: 'school'|'weekend'|'holiday'|'free', lessons, name, src }
  function schoolDay(date) {
    var key = dayKey(date), dow = date.getDay();
    if (dow === 0 || dow === 6) return { kind: 'weekend', lessons: [] };
    var hol = holidayOn(key);
    if (hol) return { kind: 'holiday', name: hol.name, lessons: [] };
    var u = S.untis.data;
    var uFresh = u && (Date.now() - S.untis.ts) < 36 * 60 * MIN;
    if (uFresh && u.from <= key && u.to >= key) {
      var ls = (u.lessons || []).filter(function (l) { return l.date === key; });
      ls.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      if (!ls.length) return { kind: 'free', lessons: [], src: 'WebUntis' };
      return { kind: 'school', lessons: ls, src: 'WebUntis' };
    }
    var st = staticLessons(date);
    return st.length ? { kind: 'school', lessons: st, src: 'timetable' } : { kind: 'free', lessons: [] };
  }

  function activeLessons(sd) {
    return sd.lessons.filter(function (l) { return l.status !== 'cancelled'; });
  }
  function dayEnd(sd) {
    var a = activeLessons(sd);
    return a.length ? a[a.length - 1].end : null;
  }
  function dayStart(sd) {
    var a = activeLessons(sd);
    return a.length ? a[0].start : null;
  }

  function nextSchoolDay(from, maxDays) {
    for (var i = 1; i <= (maxDays || 14); i++) {
      var d = addDays(from, i), sd = schoolDay(d);
      if (sd.kind === 'school' && activeLessons(sd).length) return { date: d, sd: sd, offset: i };
    }
    return null;
  }

  function reminderFor(sd) {
    var list = TT.reminders || [];
    for (var i = 0; i < list.length; i++) {
      for (var k = 0; k < sd.lessons.length; k++) {
        if (sd.lessons[k].subject === list[i].subject && sd.lessons[k].status !== 'cancelled') return list[i];
      }
    }
    return null;
  }

  function lessonRows(sd, now, isToday) {
    var nm = nowMin(now);
    return sd.lessons.map(function (l) {
      var cls = 'les';
      if (l.status === 'cancelled') cls += ' cancelled';
      else if (l.status === 'changed') cls += ' changed';
      if (isToday && l.status !== 'cancelled') {
        if (toMin(l.end) <= nm) cls += ' done';
        else if (toMin(l.start) <= nm) cls += ' now';
      }
      var meta = [];
      if (l.status === 'cancelled') meta.push('Cancelled');
      if (l.note) meta.push(esc(l.note));
      if (l.status !== 'cancelled') {
        if (l.room) meta.push(esc(l.room));
        if (l.teacher) meta.push(esc(l.teacher));
      }
      return '<div class="' + cls + '"><div class="lTime">' + l.start + '–' + l.end + '</div>' +
        '<div class="lSub">' + esc(l.subject) + '</div><div class="lMeta">' + meta.join(' · ') + '</div></div>';
    }).join('');
  }

  function calm(icon, title, sub) {
    return '<div class="calm"><div class="big">' + icon + '</div><div class="t">' + esc(title) + '</div>' +
      '<div class="s">' + sub + '</div></div>';
  }

  // ------------------------------------------------------------ homework, exams, birthdays, countdowns
  function homeworkList() {
    var a = (S.untis.data && S.untis.data.homework) || [], b = (S.calendar.data && S.calendar.data.homework) || [];
    return a.concat(b).sort(function (x, y) { return x.due < y.due ? -1 : 1; });
  }
  function examList() {
    var a = (S.untis.data && S.untis.data.exams) || [], b = (S.calendar.data && S.calendar.data.exams) || [];
    return a.concat(b).sort(function (x, y) { return x.date < y.date ? -1 : 1; });
  }
  function hwText(h) { return (h.subject ? h.subject + ' – ' : '') + h.text; }
  function exText(x) { return (x.subject ? x.subject + ' ' : '') + x.name; }
  function shortDay(key, todayKey) {
    var off = daysBetween(todayKey, key), d = keyToDate(key);
    return off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : off < 7 ? DAYS_S[d.getDay()] : DAYS_S[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }

  // Birthdays from config ("MM-DD") and from calendar events named "...birthday" / "Geburtstag".
  function birthdayList(now) {
    var out = [], todayKey = dayKey(now), y = now.getFullYear();
    ((C && C.birthdays) || []).forEach(function (b) {
      var key = y + '-' + b.date;
      if (key < todayKey) key = (y + 1) + '-' + b.date;
      var age = b.year ? (+key.slice(0, 4) - b.year) : null;
      out.push({ name: b.name, day: key, age: age });
    });
    var ev = (S.calendar.data && S.calendar.data.events) || [];
    ev.forEach(function (e) {
      if (/birthday|geburtstag/i.test(e.title) && e.startDay >= todayKey) {
        out.push({ name: e.title.replace(/'s birthday|birthday|geburtstag( von)?/ig, '').replace(/[:\-–]+$/, '').trim() || e.title, day: e.startDay, age: null });
      }
    });
    return out.filter(function (b) { return daysBetween(todayKey, b.day) <= 30; })
      .sort(function (a, b) { return a.day < b.day ? -1 : 1; });
  }

  function countdownList(now) {
    var todayKey = dayKey(now);
    var a = ((S.calendar.data && S.calendar.data.countdowns) || []).concat((C && C.countdowns) || []);
    return a.filter(function (c) { return c.day >= todayKey; }).sort(function (x, y) { return x.day < y.day ? -1 : 1; });
  }

  function hiddenEvent(title) {
    var h = (C && C.calendarHide) || [];
    for (var i = 0; i < h.length; i++) if (title.toLowerCase().indexOf(h[i].toLowerCase()) >= 0) return true;
    return /birthday|geburtstag/i.test(title);
  }

  // Decides which day the school panel shows + banners (most urgent first). Shared with night mode.
  function schoolView(now) {
    var today = schoolDay(now), end = dayEnd(today), nm = nowMin(now), todayKey = dayKey(now);
    var view = { banners: routeBanners(now) };
    if (today.kind === 'school' && end && nm < toMin(end)) {
      view.date = now; view.sd = today; view.isToday = true;
    } else {
      var next = nextSchoolDay(now, 14);
      if (next && next.offset === 1) {
        view.date = next.date; view.sd = next.sd; view.isToday = false;
      } else {
        view.calm = true; view.today = today; view.next = next;
      }
    }
    var when = view.isToday ? 'today' : 'tomorrow';
    if (view.sd) {
      view.sd.lessons.forEach(function (l) {
        if (l.status === 'cancelled') {
          view.banners.push({ cls: 'bad', text: '✕ ' + (view.isToday ? '' : 'Tomorrow: ') + l.subject + ' ' + l.start + ' cancelled' });
        }
      });
      var key = dayKey(view.date);
      examList().forEach(function (x) { if (x.date === key) view.banners.push({ cls: 'bad', text: '📄 Exam ' + when + ': ' + exText(x) }); });
      homeworkList().forEach(function (h) { if (h.due === key) view.banners.push({ cls: 'warn', text: '📝 Due ' + when + ': ' + hwText(h) }); });
    }
    birthdayList(now).forEach(function (b) {
      if (b.day === todayKey) view.banners.push({ cls: 'info', text: '🎂 ' + b.name + (b.age ? ' turns ' + b.age : '') + ' today' });
    });
    if (view.sd) {
      var rem = reminderFor(view.sd);
      if (rem) view.banners.push({ cls: '', text: (rem.icon ? rem.icon + ' ' : '') + (view.isToday ? rem.today : rem.tomorrow) });
    }
    return view;
  }

  // "Due" + "Exams" block under the lessons: at most 3 lines.
  function dueBlock(fromKey, todayKey) {
    var lines = [], until = dayKey(addDays(keyToDate(fromKey), 7));
    homeworkList().forEach(function (h) {
      if (h.due >= fromKey && h.due <= until && lines.length < 2) {
        lines.push('<div class="dueL"><span class="dueD">' + shortDay(h.due, todayKey) + '</span>' + esc(hwText(h)) + '</div>');
      }
    });
    var ex = [];
    examList().forEach(function (x) {
      if (x.date >= todayKey && x.date <= dayKey(addDays(keyToDate(todayKey), 14)) && lines.length + ex.length < 3) {
        ex.push('<div class="dueL"><span class="dueD">' + shortDay(x.date, todayKey) + '</span>' + esc(exText(x)) + '</div>');
      }
    });
    if (!lines.length && !ex.length) return '';
    return '<div class="due">' + (lines.length ? '<div class="dueH">DUE</div>' + lines.join('') : '') +
      (ex.length ? '<div class="dueH ex">EXAMS</div>' + ex.join('') : '') + '</div>';
  }

  function weekendExtras(now, next) {
    var out = [], todayKey = dayKey(now);
    if (next) {
      var nk = dayKey(next.date);
      homeworkList().forEach(function (h) {
        if (h.due === nk && out.length < 2) out.push('📝 Due ' + DAYS[next.date.getDay()] + ': ' + esc(hwText(h)));
      });
    }
    var j = S.weather.data;
    if (j && j.hourly && j.daily) {
      var h = j.hourly, t0 = now.getTime() / 1000, endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22).getTime() / 1000;
      var rainAt = null;
      for (var i = 0; i < h.time.length; i++) {
        if (h.time[i] < t0 - 1800 || h.time[i] > endOfDay) continue;
        if ((h.precipitation_probability[i] || 0) >= 50) { rainAt = h.time[i]; break; }
      }
      var wx = rainAt === null ? 'Dry all day' : rainAt <= t0 ? 'Rain now' : 'Dry until ' + hm(new Date(rainAt * 1000));
      wx += ' · max ' + Math.round(j.daily.temperature_2m_max[0]) + '°';
      if (j.daily.sunset) wx += ' · sunset ' + hm(new Date(j.daily.sunset[0] * 1000));
      out.push(wx);
    }
    return out.length ? '<div class="wkx">' + out.join('<br>') + '</div>' : '';
  }

  function renderSchool(now, view) {
    var el = $('school');
    var html = '<h2>School</h2>', todayKey = dayKey(now);
    if (view.sd) {
      var sd = view.sd, start = dayStart(sd), end = dayEnd(sd);
      var head;
      if (view.isToday) {
        var left = toMin(end) - nowMin(now);
        head = nowMin(now) < toMin(start)
          ? 'Today · <b>' + start + '–' + end + '</b>'
          : 'Today · ends <b>' + end + '</b> (' + fmtDur(left) + ')';
      } else {
        head = 'Tomorrow · <b>' + start + '–' + end + '</b>';
      }
      html += '<div class="sHead">' + head + '</div>' + lessonRows(sd, now, view.isToday);
      if (!activeLessons(sd).length) html += '<div class="empty">All lessons cancelled 🎉</div>';
      html += dueBlock(dayKey(view.date), todayKey);
      html += sd.src === 'WebUntis' ? stamp('untis', 120) : '';
    } else {
      var t = view.today, next = view.next;
      var nextTxt = next
        ? 'Next school day: ' + DAYS[next.date.getDay()] + (next.offset > 6 ? ' ' + next.date.getDate() + ' ' + MONTHS[next.date.getMonth()] : '') +
          '<br>starts ' + dayStart(next.sd) + ' (' + esc(activeLessons(next.sd)[0].subject) + ')'
        : '';
      var extras = weekendExtras(now, next);
      var dow = now.getDay();
      if (t.kind === 'holiday') html += calm('🌴', t.name, nextTxt) + extras;
      else if (dow === 0 || dow === 6 || (dow === 5 && t.kind === 'school')) html += calm('🌿', dow === 5 ? 'Weekend is here' : 'Weekend – no school', nextTxt) + extras;
      else if (holidayOn(dayKey(addDays(now, 1)))) html += calm('🌴', 'Tomorrow: ' + holidayOn(dayKey(addDays(now, 1))).name, nextTxt) + extras;
      else html += calm('🌙', 'School is over', nextTxt) + extras;
    }
    setHTML(el, html);
  }

  // ------------------------------------------------------------ upcoming (calendar | countdowns + birthdays + holidays)
  var upPage = 0, upPageAt = 0;

  function pageEvents(now) {
    var html = '', rows = 0, maxRows = 7;
    var cal = S.calendar.data, todayKey = dayKey(now), t = now.getTime(), lastDay = '';
    for (var i = 0; i < cal.events.length && rows < maxRows; i++) {
      var e = cal.events[i];
      if (hiddenEvent(e.title)) continue;
      var endMs = Date.parse(e.end), startMs = Date.parse(e.start);
      if (e.allDay) { if (e.endDay <= todayKey) continue; } else if (endMs < t) continue;
      var dk = e.allDay ? (e.startDay < todayKey ? todayKey : e.startDay) : dayKey(new Date(startMs));
      if (dk !== lastDay) { html += '<div class="evDay">' + shortDay(dk, todayKey) + '</div>'; lastDay = dk; }
      var when = e.allDay ? 'all day' : hm(new Date(startMs)) + (startMs <= t ? ' (now)' : '');
      html += '<div class="ev"><div class="evT">' + esc(e.title) + '</div><div class="evW">' + when +
        (e.location ? ' · ' + esc(e.location) : '') + '</div></div>';
      rows++;
    }
    return rows ? html : '<div class="empty">Nothing planned for the next days.</div>';
  }

  function inDays(todayKey, key) {
    var n = daysBetween(todayKey, key), d = keyToDate(key);
    var date = DAYS_S[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
    return n <= 0 ? 'today' : n === 1 ? 'tomorrow · ' + date : 'in ' + n + ' days · ' + date;
  }

  // Returns '' when there is nothing to show.
  function pageExtras(now, maxRows) {
    var todayKey = dayKey(now), html = '', rows = 0;
    var cds = countdownList(now), bds = birthdayList(now);
    var hols = (S.holidays.data || []).filter(function (h) { return h.end >= todayKey && h.type === 'school'; });
    if (cds.length) {
      html += '<div class="evDay">Countdowns</div>';
      cds.slice(0, 3).forEach(function (c) { html += '<div class="ev"><div class="evT">⏳ ' + esc(c.title) + '</div><div class="evW">' + inDays(todayKey, c.day) + '</div></div>'; rows++; });
    }
    if (bds.length) {
      html += '<div class="evDay">Birthdays</div>';
      bds.slice(0, 3).forEach(function (b) {
        html += '<div class="ev"><div class="evT">🎂 ' + esc(b.name) + (b.age ? ' (' + b.age + ')' : '') + '</div><div class="evW">' + inDays(todayKey, b.day) + '</div></div>'; rows++;
      });
    }
    if (hols.length && rows < maxRows) {
      html += '<div class="evDay">Holidays</div>';
      hols.slice(0, Math.min(2, maxRows - rows)).forEach(function (h) {
        html += '<div class="ev"><div class="evT">🌴 ' + esc(h.name) + '</div><div class="evW">' + (h.start <= todayKey ? 'now' : inDays(todayKey, h.start)) + '</div></div>';
      });
    }
    return html;
  }

  function renderUpcoming(now) {
    var el = $('upcoming'), html = '<h2>Coming up</h2>';
    var cal = S.calendar.data;
    var extras = pageExtras(now, 6);
    var pages = [];
    if (cal && cal.events) pages.push(pageEvents(now));
    if (extras) pages.push(extras);
    if (!pages.length) pages.push('<div class="empty">Nothing coming up.</div>');
    if (upPage >= pages.length) upPage = 0;
    html += pages[upPage];
    if (pages.length > 1) {
      html += '<div class="dots">' + pages.map(function (p, i) { return '<i' + (i === upPage ? ' class="on"' : '') + '></i>'; }).join('') + '</div>';
    } else {
      html += cal ? stamp('calendar', 120) : stamp('holidays', 60 * 48);
    }
    el.__pages = pages.length;
    setHTML(el, html);
  }

  // Switch "Coming up" pages every 15 s.
  function rotatePages(now) {
    var el = $('upcoming');
    if (!el || !el.__pages || el.__pages < 2 || document.body.className === 'night') return;
    if (now.getTime() - upPageAt < 15000) return;
    upPageAt = now.getTime();
    upPage = (upPage + 1) % el.__pages;
    try { renderUpcoming(now); } catch (e) { showErr(e); }
  }

  // ------------------------------------------------------------ clock, banners, night
  function isNight(now) {
    if (/[#&]night=1/.test(location.hash)) return true; // preview: add #night=1 to the URL
    var nt = C ? C.night : DEFAULTS.night;
    var a = toMin(nt.start), b = toMin(nt.end), m = nowMin(now);
    return a > b ? (m >= a || m < b) : (m >= a && m < b);
  }
  var wakeUntil = 0;

  // Short public-domain quotes, one per day.
  var QUOTES = [
    ['The secret of getting ahead is getting started.', 'Mark Twain'],
    ['Well done is better than well said.', 'Benjamin Franklin'],
    ['It always seems impossible until it is done.', 'Nelson Mandela'],
    ['Whether you think you can, or you think you can’t – you’re right.', 'Henry Ford'],
    ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
    ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
    ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
    ['Knowledge is power.', 'Francis Bacon'],
    ['Little by little, one travels far.', 'J. R. R. Tolkien'],
    ['Quality is not an act, it is a habit.', 'Will Durant'],
    ['Fall seven times, stand up eight.', 'Japanese proverb'],
    ['A journey of a thousand miles begins with a single step.', 'Lao Tzu'],
    ['The best way out is always through.', 'Robert Frost'],
    ['Stay hungry, stay foolish.', 'Whole Earth Catalog'],
    ['Action is the foundational key to all success.', 'Pablo Picasso'],
    ['He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'],
    ['Learning never exhausts the mind.', 'Leonardo da Vinci'],
    ['The only way to do great work is to love what you do.', 'Steve Jobs'],
    ['Courage is grace under pressure.', 'Ernest Hemingway'],
    ['Done is better than perfect.', 'Sheryl Sandberg'],
    ['Patience is bitter, but its fruit is sweet.', 'Aristotle'],
    ['We are what we repeatedly do.', 'Will Durant'],
    ['Make each day your masterpiece.', 'John Wooden'],
    ['First, solve the problem. Then, write the code.', 'John Johnson'],
    ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
    ['Without music, life would be a mistake.', 'Friedrich Nietzsche'],
    ['Imagination is more important than knowledge.', 'Albert Einstein'],
    ['Life is like riding a bicycle. To keep your balance you must keep moving.', 'Albert Einstein'],
    ['Be yourself; everyone else is already taken.', 'Oscar Wilde'],
    ['In the middle of difficulty lies opportunity.', 'Albert Einstein']
  ];

  function renderClock(now, view) {
    setHTML($('clock'), hm(now));
    setHTML($('date'), DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
    var b = view.banners.slice(0, 3).map(function (x) {
      return '<div class="banner ' + x.cls + '">' + esc(x.text) + '</div>';
    });
    if (!b.length) {
      var day = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(now.getFullYear(), 0, 1)) / 86400000);
      var q = QUOTES[day % QUOTES.length];
      b.push('<div class="quote">“' + esc(q[0]) + '”<span>– ' + esc(q[1]) + '</span></div>');
    }
    setHTML($('banners'), b.join(''));
  }

  // Small dot bottom right: green = all fresh, orange = one source stale, red = several.
  function renderHealth(now) {
    var night = document.body.className === 'night', stale = [];
    function chk(name, maxMin, need) {
      if (!need) return;
      if (!S[name].ts || (Date.now() - S[name].ts) / MIN > maxMin) stale.push(name);
    }
    chk('weather', 60, true);
    chk('transit', 15, !night && !!(C && C.transit));
    chk('holidays', 60 * 48, true);
    chk('untis', 120, !!S.untis.ts);
    chk('calendar', 120, !!S.calendar.ts);
    var el = $('health');
    if (!el) return;
    el.className = stale.length === 0 ? 'ok' : stale.length === 1 ? 'warn' : 'bad';
    el.title = stale.length ? 'stale: ' + stale.join(', ') : 'all data fresh';
  }

  function renderNight(now) {
    setHTML($('nClock'), hm(now));
    setHTML($('nDate'), DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
    var info = [];
    var w = S.weather.data;
    if (w && w.current) info.push(wmo(w.current.weather_code, 0)[0] + ' ' + Math.round(w.current.temperature_2m) + '°');
    // After midnight "today" is the relevant school day, before midnight "tomorrow".
    var base = now.getHours() < 12 ? addDays(now, -1) : now;
    var next = nextSchoolDay(base, 7);
    if (next) {
      var lbl = next.offset === 1 ? (now.getHours() < 12 ? 'Today' : 'Tomorrow') : DAYS[next.date.getDay()];
      info.push(lbl + ': school ' + dayStart(next.sd) + '–' + dayEnd(next.sd));
      var rem = reminderFor(next.sd);
      if (rem && next.offset === 1) info.push((rem.icon ? rem.icon + ' ' : '') + (lbl === 'Today' ? rem.today : rem.tomorrow));
    }
    setHTML($('nInfo'), info.map(esc).join('<br>'));
  }

  // ------------------------------------------------------------ main loop
  var lastMinute = -1;
  function renderAll(force) {
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    if (!force && m === lastMinute) return;
    lastMinute = m;
    if (!C) { renderLocked(now); return; }
    var night = isNight(now) && Date.now() > wakeUntil;
    document.body.className = night ? 'night' : '';
    try {
      if (night) { renderNight(now); return; }
      var view = schoolView(now);
      renderClock(now, view);
      renderWeather(now);
      renderTransit(now);
      renderSchool(now, view);
      renderUpcoming(now);
      renderHealth(now);
    } catch (e) { showErr(e); }
  }

  // Without a valid key: only a clock and a lock symbol. Nothing personal.
  var lockMsg = '';
  function renderLocked(now) {
    document.body.className = 'night';
    setHTML($('nClock'), hm(now));
    setHTML($('nDate'), DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
    setHTML($('nInfo'), dataKey() ? (lockMsg ? '🔒 ' + esc(lockMsg) : 'Loading…') : '🔒');
  }

  // Tasks: run every N minutes (slower at night). "running" prevents overlaps.
  // Before the config is decrypted only the config + version checks run.
  var tasks = [
    { fn: loadPrivate, every: 1, night: 1 },
    { fn: checkVersion, every: 5, night: 5 }
  ];
  function setupTasks() {
    tasks = [
      { fn: loadWeather, every: C.refresh.weather, night: 60 },
      { fn: loadTransit, every: C.refresh.transit, night: 0 },
      { fn: loadRoutes, every: C.refresh.transit, night: C.refresh.transit },
      { fn: loadHolidays, every: C.refresh.holidays, night: C.refresh.holidays },
      { fn: loadPrivate, every: C.refresh.privateData, night: 60 },
      { fn: checkVersion, every: C.refresh.version, night: C.refresh.version }
    ];
    tasks.forEach(function (t) { t.last = 0; t.running = false; });
    nightlyAt = nextNightly();
  }
  tasks.forEach(function (t) { t.last = 0; t.running = false; });

  function runTasks(now) {
    var night = isNight(now) && Date.now() > wakeUntil;
    tasks.forEach(function (t) {
      var every = night ? t.night : t.every;
      if (!every || t.running) return;
      if (Date.now() - t.last < every * MIN) return;
      t.running = true; t.last = Date.now();
      var p;
      try { p = t.fn(); } catch (e) { p = null; showErr(e); }
      Promise.resolve(p).then(function () { t.running = false; }, function () { t.running = false; });
    });
  }

  // ------------------------------------------------------------ updates + reloads
  var version = window.BOOT_VERSION;
  function reloadTo(v) {
    var url = location.pathname + '?v=' + encodeURIComponent(v) + location.hash;
    location.replace(url);
  }
  function checkVersion() {
    return fetchJSON('version.json?t=' + Date.now(), 10000).then(function (j) {
      if (!j || !j.version) return;
      if (!version) { version = j.version; return; }
      if (j.version !== version) reloadTo(j.version);
    }, function () { /* offline: keep running */ });
  }
  var bootTime = Date.now();
  function nextNightly() {
    var t = toMin((C && C.nightlyReload) || DEFAULTS.nightlyReload), d = new Date();
    var at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(t / 60), t % 60).getTime();
    return at <= bootTime + 30 * MIN ? at + 86400000 : at;
  }
  var nightlyAt = nextNightly();
  var nightlyBusy = false;
  function nightly() {
    if (Date.now() < nightlyAt || nightlyBusy) return;
    nightlyBusy = true;
    // Only reload when the server is reachable, otherwise Safari shows an error page forever.
    fetchJSON('version.json?t=' + Date.now(), 10000).then(function (j) {
      reloadTo((j && j.version) || version || Date.now());
    }, function () {
      nightlyAt = Date.now() + 10 * MIN; nightlyBusy = false;
    });
  }

  // ------------------------------------------------------------ errors, burn-in, touch
  var errCount = 0;
  function showErr(e) {
    errCount++;
    var el = $('err');
    if (el) el.textContent = '⚠ ' + errCount + ' ' + String((e && e.message) || e).slice(0, 80);
  }
  window.onerror = function (msg) { showErr(msg); };

  var shiftAt = 0;
  function pixelShift(now) {
    if (now.getTime() - shiftAt < 3 * MIN) return;
    shiftAt = now.getTime();
    var r = document.body.className === 'night' ? 24 : 5;
    var x = Math.round((Math.random() * 2 - 1) * r), y = Math.round((Math.random() * 2 - 1) * r);
    var tr = 'translate(' + x + 'px,' + y + 'px)';
    var s = $('shift').style;
    s.webkitTransform = tr; s.transform = tr;
  }

  function onTouch() {
    if (C && document.body.className === 'night') {
      wakeUntil = Date.now() + 2 * MIN;
      tasks.forEach(function (t) { if (t.fn === loadTransit || t.fn === loadWeather) t.last = 0; });
      renderAll(true);
    }
  }
  document.addEventListener('touchstart', onTouch, false);
  document.addEventListener('click', onTouch, false);

  // Keep the screen on. iOS 12 has no Wake Lock API, but a playing (muted,
  // inline, looping) video stops the auto-lock. Newer browsers get the real API.
  var keepVid = null, wakeLock = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () {});
      }
      if (!keepVid) {
        keepVid = document.createElement('video');
        keepVid.setAttribute('muted', '');
        keepVid.setAttribute('playsinline', '');
        keepVid.setAttribute('webkit-playsinline', '');
        keepVid.setAttribute('loop', '');
        keepVid.muted = true;
        keepVid.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
        keepVid.src = 'media/keepawake.mp4' + (window.BOOT_VERSION ? '?v=' + window.BOOT_VERSION : '');
        document.body.appendChild(keepVid);
      }
      if (keepVid.paused) {
        var p = keepVid.play();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* not critical */ }
  }
  document.addEventListener('touchend', keepAwake, false);
  document.addEventListener('click', keepAwake, false);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) keepAwake();
  }, false);

  // Single self-rescheduling timer: no stacking intervals.
  function tick() {
    try {
      var now = new Date();
      renderAll(false);
      runTasks(now);
      pixelShift(now);
      if (C) rotatePages(now);
      nightly();
      if (now.getSeconds() % 30 === 0 && keepVid && keepVid.paused) keepAwake();
      if (errCount > 50) { errCount = 0; nightlyAt = 0; }
    } catch (e) { showErr(e); }
    setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
  }

  // Scripts are loaded in <head>, so wait for the body.
  function start() {
    // Last decrypted config (kept on this device only) lets the screen work offline after a reload.
    var cached = dataKey() ? store.get('cfg') : null;
    if (cached && cached.data) applyConfig(cached.data);
    renderAll(true);
    keepAwake();
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, false);
  else start();
})();
