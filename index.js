/* eslint-disable no-console, no-bitwise, no-restricted-syntax, require-yield, no-cond-assign, no-unused-vars, no-param-reassign, prefer-const */
const path = require("path");
const fs = require("fs");
const os = require("os");
const protobuf = require("protobufjs");

const encodeTime = (h, m) => h * 60 + m;

const formatTime = value => {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
};

const day = 24 * 60 * 60 * 1000;
const encodeDate = (y, m, d) =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2018, 0, 1)) / day);

const encodeRouteId = id => {
  const charIndex = id[0].toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
  const num = Number(id.slice(1));
  return ((charIndex & 0b11111) << 17) | (num & 0b11111111111111111);
};

const formatId = value => {
  const char = String.fromCharCode(
    ((value >> 17) & 0b11111) + "a".charCodeAt(0)
  ).toUpperCase();
  const num = value & 0b11111111111111111;
  return `${char}${String(num).padStart(5, "0")}`;
};

async function* chunksToLines(chunksAsync) {
  let previous = "";
  for await (const chunk of chunksAsync) {
    previous += chunk;
    let eolIndex;
    while ((eolIndex = previous.indexOf("\n")) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex + 1);
      yield line;
      previous = previous.slice(eolIndex + 1);
    }
  }
  if (previous.length > 0) {
    yield previous;
  }
}

const csvLineRe = /^(?:("(?:[^"\n]|\\")*"|[^,\n]*),)*("(?:[^"\n]|\\")*"|[^,\n]*)$/;
async function* parseCsv(dataStream) {
  for await (const line of chunksToLines(dataStream)) {
    const [, /* initial */ ...matches] = line.slice(0, -1).match(csvLineRe);
    yield matches;
  }
}

async function* getTlaMap(dataStream) {
  const names = {};
  for await (const [name, tla] of parseCsv(dataStream)) {
    names[tla] = name;
  }
  return Object.keys(names)
    .sort()
    .reduce((accum, tla, index) => {
      accum[tla] = { id: index, name: names[tla] };
      return accum;
    }, {});
}

async function* getStationIdMap(tlas, dataStream) {
  let i = 0;
  const stations = {};

  for await (const line of chunksToLines(dataStream)) {
    if (line[0] === "A") {
      const tla = line.slice(43, 46);

      if (tlas[tla]) {
        const { id } = tlas[tla];
        const toploc = line.slice(36, 43).trimRight();

        stations[toploc] = id;
      }
    }
  }

  return stations;
}

const TYPE_NORMAL = 0;
const TYPE_BUS_REPLACEMENT = 1;

const types = {
  "": TYPE_NORMAL, // cancellations
  OO: TYPE_NORMAL,
  OU: TYPE_NORMAL,
  OL: TYPE_NORMAL,
  OW: TYPE_NORMAL,
  XC: TYPE_NORMAL,
  XD: TYPE_NORMAL,
  XI: TYPE_NORMAL,
  XR: TYPE_NORMAL,
  XU: TYPE_NORMAL,
  XX: TYPE_NORMAL,
  XZ: TYPE_NORMAL,
  BS: TYPE_BUS_REPLACEMENT,
  BR: TYPE_BUS_REPLACEMENT
};

const createRoute = line => {
  const status = line.slice(79, 80).trimRight();
  const typeCode = line.slice(30, 32).trimRight();
  const type = types[typeCode];

  if (type == null) {
    throw new Error(`Expected type for ${typeCode}`);
  }

  const id = line.slice(3, 9);
  const days = parseInt(line.slice(21, 28), 2);

  const dateFrom = encodeDate(
    2000 + Number(line.slice(9, 11)),
    Number(line.slice(11, 13)),
    Number(line.slice(13, 15))
  );
  const dateTo = encodeDate(
    2000 + Number(line.slice(15, 17)),
    Number(line.slice(17, 19)),
    Number(line.slice(19, 21))
  );

  return { stops: [], id, days, dateFrom, dateTo, type, status };
};
const createStop = (stations, line) => {
  const stationId = stations[line.slice(2, 9).trimRight()];
  if (stationId == null) return null;

  let arrival;
  let departure;
  let platform;

  switch (line[1]) {
    case "O":
    case "T":
      arrival = encodeTime(
        Number(line.slice(15, 17)),
        Number(line.slice(17, 19))
      );
      departure = arrival;
      platform = line.slice(19, 22).trimRight();
      break;
    case "I": {
      const passTime = line.slice(20, 24).trimRight();
      if (passTime.length > 0) return null;

      arrival = encodeTime(
        Number(line.slice(25, 27)),
        Number(line.slice(27, 29))
      );
      departure = encodeTime(
        Number(line.slice(29, 31)),
        Number(line.slice(31, 33))
      );
      platform = line.slice(33, 36).trimRight();
      break;
    }
    default:
      throw new Error("Unknown format");
  }

  return { stationId, platform, arrival, departure };
};
const scheduleRe = /^BSN/;
const scheduleChangedRe = /^BS[DR]/;
const scheduleDataRe = /^BX/;
const pointRe = /^L[OIT]/;
// const originRe = /^LO/;
// const intermediateRe = /^LI/;
const terminateRe = /^LT/;

async function* getRoutes(stationMap, dataStream) {
  let currentRoute = null;

  let changed = 0;
  for await (const line of chunksToLines(dataStream)) {
    if (scheduleRe.test(scheduleChangedRe)) {
      changed += 1;
    }
    if (scheduleRe.test(line)) {
      currentRoute = createRoute(line);
    } else if (scheduleDataRe.test(line)) {
      // Do nothing
    } else if (currentRoute != null && pointRe.test(line)) {
      const stop = createStop(stationMap, line);
      if (stop != null) {
        currentRoute.stops.push(stop);
        if (terminateRe.test(line)) {
          yield currentRoute;
          currentRoute = null;
        }
      }
    } else {
      currentRoute = null;
    }
  }

  if (changed !== 0) {
    throw new Error(
      "Expected all schedules to be new (no deletions or revisions)"
    );
  }
}

function routeEncoder() {
  const platforms = [];

  return ({ id: routeId, from, to, days, stops }) => {
    const size = (1 + stops.length) * 2;
    const data = new Uint32Array(size);

    let i = 0;
    if (data[i] !== 0) throw new Error("Invalid state");

    data[i] =
      (0 << 31) |
      ((stops.length & 0b1111111) << 23) |
      ((routeId & 0b1111111111111111111111) << 1);
    data[i + 1] =
      (0 << 31) |
      ((from & 0b11111111111) << 20) |
      ((to & 0b11111111111) << 9) |
      ((days & 0b1111111) << 2);
    i += 2;

    for (const { stationId, platform, arrival, departure } of stops) {
      if (data[i] !== 0) throw new Error("Invalid state");

      let platformIndex = platforms.indexOf(platform);
      if (platformIndex === -1) {
        platformIndex = platforms.push(platform);
      }

      const d1 =
        (1 << 31) |
        ((stationId & 0b111111111111) << 18) |
        ((platformIndex & 0b11111111) << 10);
      const d2 =
        (0 << 31) |
        ((arrival & 0b11111111111) << 20) |
        ((departure & 0b11111111111) << 9);
      data[i] = d1;
      data[i + 1] = d2;
      i += 2;
    }

    return new Uint8Array(data.buffer);
  };
}

async function* encodeRoutes(stationMap, dataStream) {
  const encodeRoute = routeEncoder();

  for await (const route of getRoutes(stationMap, dataStream)) {
    yield encodeRoute(route);
  }
}

function findRoute(POINTA, POINTB, DAY, TODAY, data) {
  const routes = new Map();

  let i = 0;
  while (i < data.length) {
    const startIndex = i;
    const nextIndex = i + (((data[i] >> 23) & 0b1111111) + 1) * 2;

    const routeId = (data[i] >>> 1) & 0b1111111111111111111111;
    const from = (data[i + 1] >>> 20) & 0b11111111111;
    const to = (data[i + 1] >>> 9) & 0b11111111111;
    const days = (data[i + 1] >>> 2) & 0b1111111;

    if ((days & DAY) !== 0 && TODAY >= from && TODAY <= to) {
      routes.delete(routeId);
      i += 2;

      for (; i < nextIndex; i += 2) {
        const fromId = (data[i] >>> 18) & 0b111111111111;
        if (fromId === POINTB) {
          break;
        } else if (fromId === POINTA) {
          i += 2;
          for (; i < nextIndex; i += 2) {
            const toId = (data[i] >>> 18) & 0b111111111111;
            if (toId === POINTB) {
              routes.set(routeId, startIndex);
              break;
            }
          }
          break;
        }
      }
    }

    i = nextIndex;
  }

  return routes;
}

async function* run() {
  const { value: tlaMap } = await getTlaMap(
    fs.createReadStream(path.join(__dirname, "station_codes.csv"), {
      encoding: "utf-8"
    })
  ).next();

  const { value: stationMap } = await getStationIdMap(
    tlaMap,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.msn"),
      { encoding: "utf-8" }
    )
  ).next();

  const routes = [];
  const schedule = getRoutes(
    stationMap,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.mca"),
      { encoding: "utf-8" }
    )
  );

  encodeRoutes(
    stationMap,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.mca"),
      { encoding: "utf-8" }
    )
  );

  const routeStream = fs.createWriteStream(
    path.join(os.homedir(), "Downloads/ttis989/ttisf989.ui32")
  );

  fs.writeFileSync(
    path.join(os.homedir(), "Downloads/ttis989/stations.json"),
    JSON.stringify(tlaMap)
  );

  let numStops = 0;
  let maxRouteStops = 0;
  const stationsSet = new Set();
  const platformsSet = new Set();
  const fromTo = {};

  const encodeRoute = routeEncoder();
  for await (const route of schedule) {
    routes.push(route);
    routeStream.write(encodeRoute(route));
    numStops += route.stops.length;
    maxRouteStops = Math.max(maxRouteStops, route.stops.length);
    const key = `${route.from}:${route.to}`;
    fromTo[key] = (fromTo[key] || 0) + 1;
    for (const { id, platform, arrival, departure } of route.stops) {
      stationsSet.add(id);
      platformsSet.add(platform);
    }
  }

  routeStream.end();

  const platforms = Array.from(platformsSet);
  const numRoutes = routes.length;
  const size = numRoutes + numStops;
  const data = new Uint32Array(size * 2);

  protobuf.load("types.proto", (err, root) => {
    if (err) {
      console.error(err);
      return;
    }

    const Data = root.lookupType("types.Data");

    const r = routes.map(r => ({
      id: r.id,
      days: r.days,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      stops: r.stops.map(s => ({
        stationId: s.stationId,
        arrival: s.arrival,
        departure: s.departure,
        platform: 0
      }))
    }));

    const message = { routes: r };

    const buffer = Data.encode(message).finish();
    fs.writeFileSync(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.pr"),
      buffer
    );
  });

  // const idMap = Object.values(stations).reduce((accum, { id, tla }) => {
  //   accum[id] = tla;
  //   return accum;
  // }, {});
  // const tlaIdMap = Object.values(stations).reduce((accum, { id, tla }) => {
  //   accum[tla] = id;
  //   return accum;
  // }, {});

  console.log({ numRoutes, numStops, size, maxRouteStops });
  // console.log(fromTo);
  // console.log(Object.keys(fromTo).length);
  console.log(platforms.length);
  console.log(Object.keys(stationMap).length);
  console.log(stationsSet.size);
  // console.log(JSON.stringify({ stations, routes }).length)
  // fs.writeFileSync(
  //   '/home/jacob/Downloads/ttis989/ttisf989.json',
  //   JSON.stringify({ stations, routes })
  // );

  // let POINTA = Object.values(stations).find(s => s.tla === "SUR").id;
  // let CLJ = Object.values(stations).find(s => s.tla === "CLJ").id;
  // let POINTB = stations.WATRLMN.id;
  let POINTA = tlaMap.WAT.id;
  let POINTB = tlaMap.SUR.id;
  // POINTB = tlaMap.EXD.id;
  const TODAY = encodeDate(2018, 8, 9);
  const DAY = 1 << 6;

  console.log({ POINTA, POINTB });

  // [POINTA, POINTB] = [POINTB, POINTA];

  console.time("ROUTE FAST");
  const fastRoutes = findRoute(POINTA, POINTB, DAY, TODAY, data);
  console.timeEnd("ROUTE FAST");

  console.time("ROUTE");
  const slowRoutes = new Map();
  routes.forEach(route => {
    const { id: routeId, to, from, days, stops } = route;

    if ((days & DAY) !== 0 && TODAY >= from && TODAY <= to) {
      const aIndex = stops.findIndex(s => s.id === POINTA);
      const bIndex = stops.findIndex(s => s.id === POINTB);
      if (aIndex !== -1 && bIndex !== -1 && bIndex > aIndex) {
        slowRoutes.set(routeId, route);
      } else {
        slowRoutes.delete(routeId);
      }
    }
  });
  console.timeEnd("ROUTE");

  // console.log(slowRoutes.map(r => r.stops.map(s => sIds[s.id])));
  console.log(fastRoutes.size);
  console.log(slowRoutes.size);

  const formatRoute = route => {
    const start = route.stops.find(s => s.id === POINTA);
    const end = route.stops.find(s => s.id === POINTB);
    let duration = end.arrival - start.departure;
    if (duration < 0) duration += 24 * 60;
    return {
      // ...route,
      id: formatId(route.id),
      start: formatTime(start.departure),
      end: formatTime(end.arrival),
      duration
      // stops: route.stops.map(stop => ({
      //   ...stop,
      //   id: idMap[stop.id]
      // }))
    };
  };

  const untime = s => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  console.log(
    Array.from(slowRoutes.values(), formatRoute)
      .sort((a, b) => untime(a.start) - untime(b.start))
      .filter(s => untime(s.start) >= encodeTime(17, 0))
      .filter(s => untime(s.start) <= encodeTime(18, 0))
  );
}

/*
ROUTE
a (22) - id (5 + 17 bits)
b (7) - days
c (11) - from (could be 10)
d (11) - to (could be 10)
e (7) - num stops (optimisation only, could be removed if needed)
f (1) - bus replacement
g (2) - status (P, C, O, N)

STOP
a (12) - station id
b (11) - arrival
c (11) - departure
d  (8) - platform
*/

run().next();
