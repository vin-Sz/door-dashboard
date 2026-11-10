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
  ['weather', 'transit', 'holidays', 'untis', 'calendar'].forEach(function (k) {
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
    return hints.slice(0, 3);
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
  function matchesDirection(texts) {
    var m = C.transit.directionMatch || [];
    if (!m.length) return true;
    for (var i = 0; i < texts.length; i++) {
      var t = String(texts[i] || '').toLowerCase();
      for (var k = 0; k < m.length; k++) if (t.indexOf(m[k].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function fromTransitous(j) {
    var out = [];
    (j.stopTimes || []).forEach(function (st) {
      var p = st.place || {};
      if (p.pickupType === 'NOT_ALLOWED') return;
      if (!matchesDirection([st.headsign, st.tripTo && st.tripTo.name])) return;
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
        replacement: st.mode === 'BUS' && railLine
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

  function renderTransit(now) {
    var el = $('transit'), T = C.transit, r = S.transit.data;
    var title = '<h2>Departures → ' + esc((T.directionMatch && T.directionMatch[0]) || T.stationName) + '</h2>';
    if (!r) {
      setHTML(el, title + '<div class="loading">' + (S.transit.err ? 'Departures unavailable – retrying…' : 'Loading departures…') + '</div>');
      return;
    }
    var t = now.getTime(), rows = [];
    for (var i = 0; i < r.deps.length && rows.length < T.maxRows; i++) {
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

  // Decides which day the school panel shows + banners. Shared with night mode.
  function schoolView(now) {
    var today = schoolDay(now), end = dayEnd(today), nm = nowMin(now);
    var view = { banners: [] };
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
    if (view.sd) {
      var rem = reminderFor(view.sd);
      if (rem) view.banners.push({ cls: '', text: (rem.icon ? rem.icon + ' ' : '') + (view.isToday ? rem.today : rem.tomorrow) });
      view.sd.lessons.forEach(function (l) {
        if (l.status === 'cancelled') {
          view.banners.push({ cls: 'bad', text: '✕ ' + (view.isToday ? '' : 'Tomorrow: ') + l.subject + ' ' + l.start + ' cancelled' });
        }
      });
    }
    return view;
  }

  function renderSchool(now, view) {
    var el = $('school');
    var html = '<h2>School</h2>';
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
      html += sd.src === 'WebUntis' ? stamp('untis', 120) : '';
    } else {
      var t = view.today, next = view.next;
      var nextTxt = next
        ? 'Next school day: ' + DAYS[next.date.getDay()] + (next.offset > 6 ? ' ' + next.date.getDate() + ' ' + MONTHS[next.date.getMonth()] : '') +
          '<br>starts ' + dayStart(next.sd) + ' (' + esc(activeLessons(next.sd)[0].subject) + ')'
        : '';
      var dow = now.getDay();
      if (t.kind === 'holiday') html += calm('🌴', t.name, nextTxt);
      else if (dow === 0 || dow === 6 || (dow === 5 && t.kind === 'school')) html += calm('🌿', dow === 5 ? 'Weekend is here' : 'Weekend – no school', nextTxt);
      else if (holidayOn(dayKey(addDays(now, 1)))) html += calm('🌴', 'Tomorrow: ' + holidayOn(dayKey(addDays(now, 1))).name, nextTxt);
      else html += calm('🌙', 'School is over', nextTxt);
    }
    setHTML(el, html);
  }

  // ------------------------------------------------------------ upcoming (calendar + holidays)
  function renderUpcoming(now) {
    var el = $('upcoming'), html = '<h2>Coming up</h2>', rows = 0, maxRows = 7;
    var cal = S.calendar.data, todayKey = dayKey(now), t = now.getTime();
    if (cal && cal.events) {
      var lastDay = '';
      for (var i = 0; i < cal.events.length && rows < maxRows; i++) {
        var e = cal.events[i];
        var endMs = Date.parse(e.end), startMs = Date.parse(e.start);
        if (e.allDay) { if (e.endDay <= todayKey) continue; } else if (endMs < t) continue;
        var dk = e.allDay ? (e.startDay < todayKey ? todayKey : e.startDay) : dayKey(new Date(startMs));
        if (dk !== lastDay) {
          var off = daysBetween(todayKey, dk), dd = keyToDate(dk);
          var label = off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : DAYS_S[dd.getDay()] + ' ' + dd.getDate() + ' ' + MONTHS[dd.getMonth()].slice(0, 3);
          html += '<div class="evDay">' + label + '</div>';
          lastDay = dk;
        }
        var when = e.allDay ? 'all day' : hm(new Date(startMs)) + (startMs <= t ? ' (now)' : '');
        html += '<div class="ev"><div class="evT">' + esc(e.title) + '</div><div class="evW">' + when +
          (e.location ? ' · ' + esc(e.location) : '') + '</div></div>';
        rows++;
      }
      if (!rows) html += '<div class="empty">Nothing in your calendar for the next days.</div>';
    }
    // Next holidays
    var hols = (S.holidays.data || []).filter(function (h) { return h.end >= todayKey; });
    var hRows = cal ? 1 : 4, shown = 0;
    if (hols.length) {
      if (cal) html += '<div class="evDay">Holidays</div>';
      for (var k = 0; k < hols.length && shown < hRows; k++) {
        var h = hols[k], inDays = daysBetween(todayKey, h.start);
        var sd = keyToDate(h.start);
        var w = inDays <= 0 ? 'now' : inDays === 1 ? 'tomorrow' : 'in ' + inDays + ' days · ' + DAYS_S[sd.getDay()] + ' ' + sd.getDate() + ' ' + MONTHS[sd.getMonth()].slice(0, 3);
        html += '<div class="ev"><div class="evT">' + (h.type === 'school' ? '🌴 ' : '🎉 ') + esc(h.name) + '</div><div class="evW">' + w + '</div></div>';
        shown++;
      }
    }
    if (!cal && !hols.length) html += '<div class="empty">Nothing coming up.</div>';
    html += cal ? stamp('calendar', 120) : stamp('holidays', 60 * 48);
    setHTML(el, html);
  }

  // ------------------------------------------------------------ clock, banners, night
  function isNight(now) {
    if (/[#&]night=1/.test(location.hash)) return true; // preview: add #night=1 to the URL
    var nt = C ? C.night : DEFAULTS.night;
    var a = toMin(nt.start), b = toMin(nt.end), m = nowMin(now);
    return a > b ? (m >= a || m < b) : (m >= a && m < b);
  }
  var wakeUntil = 0;

  function renderClock(now, view) {
    setHTML($('clock'), hm(now));
    setHTML($('date'), DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()]);
    var b = view.banners.slice(0, 3).map(function (x) {
      return '<div class="banner ' + x.cls + '">' + esc(x.text) + '</div>';
    });
    setHTML($('banners'), b.join(''));
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

  // Single self-rescheduling timer: no stacking intervals.
  function tick() {
    try {
      var now = new Date();
      renderAll(false);
      runTasks(now);
      pixelShift(now);
      nightly();
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
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, false);
  else start();
})();
