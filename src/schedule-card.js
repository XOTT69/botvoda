import {humanDate, nextDate, validatedPeriods} from './schedule-card-model.js';

const escapeXml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function minuteLabel(value) {
  if (value === 1440) return '24:00';
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' +
    String(value % 60).padStart(2, '0');
}

function scheduleRows(periods) {
  if (periods === null) return [{unknown: true}];
  if (!periods.length) return [{start: 0, end: 1440, on: true}];
  const rows = [];
  let cursor = 0;
  for (const [start, end] of periods) {
    if (cursor < start) rows.push({start: cursor, end: start, on: true});
    rows.push({start, end, on: false});
    cursor = end;
  }
  if (cursor < 1440) rows.push({start: cursor, end: 1440, on: true});
  return rows;
}

function cardRows(rows, top) {
  return rows.map((row, index) => {
    const y = top + index * 73;
    if (row.unknown) {
      return '<rect x="82" y="' + y + '" width="860" height="64" rx="32" fill="#12294c" ' +
        'stroke="#819dc8" stroke-width="2" stroke-dasharray="10 8"/>' +
        '<text x="512" y="' + (y + 43) + '" text-anchor="middle" class="unknown">Графік ще не опублікований</text>';
    }
    const color = row.on ? '#28b64e' : '#e22135';
    const dark = row.on ? '#126032' : '#8f1122';
    const icon = row.on
      ? '<circle cx="150" cy="' + (y + 32) + '" r="25" fill="#7cf5a1"/><path d="m139 ' +
        (y + 32) + ' 8 9 17-18" fill="none" stroke="#07552b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="m159 ' + (y + 7) + '-23 31h16l-8 23 28-35h-17l9-19Z" fill="#fff"/>';
    return '<rect x="82" y="' + y + '" width="860" height="64" rx="32" fill="' + dark + '" ' +
      'stroke="' + color + '" stroke-width="3"/><path d="M114 ' + (y + 2) + 'h700" stroke="#ffffff" opacity=".08"/>' + icon +
      '<text x="222" y="' + (y + 43) + '" class="hours">' + minuteLabel(row.start) + ' — ' +
      minuteLabel(row.end) + '</text><text x="650" y="' + (y + 42) + '" class="state">' +
      (row.on ? 'Є світло' : 'Немає світла') + '</text>';
  }).join('');
}

function dayDate(date) {
  const [weekday] = humanDate(date).split(', ');
  const dt = new Date(date + 'T12:00:00Z');
  const dateText = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'UTC', day: 'numeric', month: 'long'
  }).format(dt);
  return dateText + ', ' + weekday.toLowerCase();
}

function dayCard(label, date, periods, top) {
  const rows = scheduleRows(periods);
  const height = 166 + rows.length * 73;
  const calendarX = 108;
  return {
    height,
    svg: '<g><rect x="48" y="' + top + '" width="928" height="' + height + '" rx="46" ' +
      'fill="url(#card)" stroke="#4773b7" stroke-width="3"/>' +
      '<rect x="51" y="' + (top + 3) + '" width="922" height="' + (height - 6) + '" rx="43" ' +
      'fill="none" stroke="#9fc5ff" stroke-opacity=".12"/>' +
      '<g transform="translate(' + calendarX + ' ' + (top + 36) + ')" fill="none" stroke="#f4f7ff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="0" y="8" width="78" height="73" rx="9"/><path d="M19 0v18M59 0v18M1 31h76"/>' +
      '<path d="M17 47h5m17 0h5m17 0h5M17 65h5m17 0h5m17 0h5" stroke-width="10"/></g>' +
      '<text x="225" y="' + (top + 78) + '" class="dayTitle">' + label + '</text>' +
      '<text x="225" y="' + (top + 126) + '" class="date">' + escapeXml(dayDate(date)) + '</text>' +
      cardRows(rows, top + 151) + '</g>'
  };
}

function skyline(top, opacity = 1) {
  const buildings = [
    [0, 112, 122, 5], [85, 132, 166, 7], [196, 104, 136, 6], [287, 129, 183, 8],
    [399, 93, 126, 5], [614, 104, 130, 5], [703, 110, 178, 8], [796, 95, 139, 6],
    [878, 124, 208, 9], [978, 108, 158, 7]
  ];
  const art = buildings.map(([x, width, height, floors], index) => {
    const y = top + 218 - height;
    const windows = [];
    for (let row = 0; row < floors; row++) {
      for (let col = 0; col < Math.floor((width - 20) / 20); col++) {
        const lit = (row * 7 + col * 3 + index) % 5 !== 0;
        windows.push('<rect x="' + (x + 10 + col * 20) + '" y="' + (y + 13 + row * 18) +
          '" width="7" height="9" rx="1" fill="' + (lit ? '#ffd34c' : '#173566') + '" opacity=".9"/>');
      }
    }
    return '<g><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="4" fill="#061329" stroke="#163c72" stroke-width="2"/><path d="M' +
      (x + width / 2) + ' ' + (y - 13) + 'v13" stroke="#061329" stroke-width="5"/>' + windows.join('') + '</g>';
  }).join('');
  return '<g opacity="' + opacity + '">' + art +
    '<rect x="0" y="' + (top + 132) + '" width="1024" height="86" fill="url(#skyFade)"/></g>';
}

function bulb() {
  return '<g fill="none" stroke="#ffdc42" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">' +
    '<path d="M160 34v25M108 52l17 18m87-18-17 18M88 111h28m106 0h28" stroke-width="9"/>' +
    '<path d="M160 63c-35 0-58 25-58 58 0 22 12 36 27 54 7 8 10 16 10 28h42c0-12 3-20 10-28 15-18 27-32 27-54 0-33-23-58-58-58Z" stroke-width="10"/>' +
    '<path d="M137 204h46m-41 15h36m-28 15h20M143 122v40m34-40v40m-34-12h34" stroke-width="9"/></g>';
}

function localUpdateTime(timestamp) {
  const dt = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(dt);
  const get = key => parts.find(part => part.type === key)?.value || '';
  return get('day') + '.' + get('month') + '.' + get('year') + ' о ' + get('hour') + ':' + get('minute');
}

export function scheduleCardSvg({today, todayPeriods, tomorrow, tomorrowPeriods, updatedAt, demo = false}) {
  if (tomorrow !== null && nextDate(today) !== tomorrow) throw new Error('Schedule card dates must be consecutive');
  if (todayPeriods !== null && validatedPeriods(todayPeriods) === null) throw new Error('Invalid schedule for today');
  if (tomorrowPeriods !== null && validatedPeriods(tomorrowPeriods) === null) throw new Error('Invalid schedule for tomorrow');

  const first = dayCard('Сьогодні', today, todayPeriods, 326);
  const secondTop = 326 + first.height + 23;
  const second = tomorrow === null ? {height:0,svg:''} : dayCard('Завтра', tomorrow, tomorrowPeriods, secondTop);
  const contentEnd = tomorrow === null ? 326 + first.height : secondTop + second.height;
  const height = Math.max(tomorrow === null ? 1060 : 1536, contentEnd + 190);
  const updateY = height - 112;
  const mottoY = height - 39;
  const stars = Array.from({length: 52}, (_, index) => {
    const x = (index * 173 + 37) % 1016 + 4;
    const y = (index * 97 + 19) % Math.max(1, height - 20) + 10;
    const radius = index % 9 === 0 ? 2 : 1.25;
    return '<circle cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="#e8f2ff" opacity=".56"/>';
  }).join('');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="' + height + '" viewBox="0 0 1024 ' + height + '">' +
    '<defs><linearGradient id="bg" x2="0%" y2="100%"><stop stop-color="#06142e"/><stop offset=".38" stop-color="#0b2b5e"/><stop offset="1" stop-color="#040d1e"/></linearGradient>' +
    '<linearGradient id="card" x2="100%" y2="100%"><stop stop-color="#14345f"/><stop offset="1" stop-color="#091a36"/></linearGradient>' +
    '<linearGradient id="skyFade" x2="0%" y2="100%"><stop stop-color="#071a38" stop-opacity="0"/><stop offset="1" stop-color="#071a38"/></linearGradient>' +
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<style>text{font-family:"Noto Sans",sans-serif;fill:#f7f9ff}.brand{font-size:68px;font-weight:700;letter-spacing:-1px}.tagText{font-size:48px;font-weight:700;fill:#09172e}.dayTitle{font-size:58px;font-weight:700}.date{font-size:30px;fill:#bacbfa;font-weight:500}.hours{font-size:36px;font-weight:700}.state{font-size:31px;font-weight:500}.unknown{font-size:29px;fill:#d7e3ff;font-weight:500}.footer{font-size:27px;fill:#c5d5fa}.motto{font-size:36px;font-style:italic}.heart{font-size:51px;fill:#ffd12d}</style></defs>' +
    '<rect width="1024" height="' + height + '" fill="url(#bg)"/>' + stars +
    skyline(68, .25) + bulb() +
    '<path d="M306 44v205" stroke="#b8d3ff" stroke-opacity=".75" stroke-width="3"/>' +
    '<text x="354" y="126" class="brand">Світло</text><text x="354" y="194" class="brand">Покровська</text>' +
    '<rect x="350" y="220" width="353" height="75" rx="38" fill="#ffd12d" filter="url(#glow)"/>' +
    '<text x="526" y="273" class="tagText" text-anchor="middle">Графік 2.2</text>' +
    first.svg + second.svg + (demo ? '<rect x="0" y="298" width="1024" height="27" fill="#ffd12d"/><text x="512" y="318" style="fill:#08152b;font-size:18px;font-weight:700" text-anchor="middle">ДЕМОНСТРАЦІЯ · години вигадані</text>' : '') + skyline(height - 220, .14) +
    '<path d="M90 ' + (updateY - 1) + 'h155m534 0h155" stroke="#7396d2" stroke-opacity=".7" stroke-width="2"/>' +

    '<text x="512" y="' + (updateY + 9) + '" class="footer" text-anchor="middle">Оновлено: ' + escapeXml(localUpdateTime(updatedAt)) + '</text>' +
    '<text x="512" y="' + mottoY + '" class="motto" text-anchor="middle">Світло переможе! </text>' +
    '<text x="512" y="' + (height - 10) + '" font-size="16" fill="#aabbd9" text-anchor="middle">Плановий графік · під час екстрених відключень може не діяти</text>' +
    '</svg>';
}
