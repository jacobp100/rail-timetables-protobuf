const path = require("path");
const fs = require("fs");
const os = require("os");

const encodeTime = (h, m) => h * 60 + m;

const day = 24 * 60 * 60 * 1000;
const encodeDate = (y, m, d) =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2018, 0, 01)) / day);

const encodeRouteId = id => {
  const charIndex = id[0].toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
  const num = Number(id.slice(1));
  return (charIndex << 17) | num;
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

async function* getStations(dataStream) {
  let i = 0;
  const stations = {};
  const tlaMap = {};

  for await (const line of chunksToLines(dataStream)) {
    if (line[0] === "A") {
      const tla = line.slice(43, 46);
      const toploc = line.slice(36, 43).trimRight();
      const existing = tlaMap[tla];

      if (existing != null) {
        stations[toploc] = existing;
      } else {
        const id = i;

        const station = { tla, id };
        stations[toploc] = station;
        tlaMap[tla] = station;

        i += 1;
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

  const id = encodeRouteId(line.slice(3, 10));
  const days = parseInt(line.slice(21, 28), 2);

  const from = encodeDate(
    2000 + Number(line.slice(9, 11)),
    Number(line.slice(11, 13)),
    Number(line.slice(13, 15))
  );
  const to = encodeDate(
    2000 + Number(line.slice(15, 17)),
    Number(line.slice(17, 19)),
    Number(line.slice(19, 21))
  );

  return { stops: [], id, days, from, to, type, status };
};
const createStop = (stations, line) => {
  const station = stations[line.slice(2, 9).trimRight()];
  if (station == null) return null;
  const { id } = station;

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
    case "I":
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
    default:
      throw new Error("Unknown format");
  }

  return { id, platform, arrival, departure };
};
const scheduleRe = /^BSN/;
const scheduleChangedRe = /^BS[DR]/;
const scheduleDataRe = /^BX/;
const pointRe = /^L[OIT]/;
const originRe = /^LO/;
const intermediateRe = /^LI/;
const terminateRe = /^LT/;

async function* getSchedule(stations, dataStream) {
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
      const stop = createStop(stations, line);
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

async function* run() {
  const { value: stations } = await getStations(
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.msn"),
      { encoding: "utf-8" }
    )
  ).next();

  const routes = [];
  const schedule = getSchedule(
    stations,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.mca"),
      { encoding: "utf-8" }
    )
  );

  let numStops = 0;
  let maxRouteStops = 0;
  const stationsSet = new Set();
  const platformsSet = new Set();
  const fromTo = {};

  for await (const route of schedule) {
    routes.push(route);
    numStops += route.stops.length;
    maxRouteStops = Math.max(maxRouteStops, route.stops.length);
    const key = `${route.from}:${route.to}`;
    fromTo[key] = (fromTo[key] || 0) + 1;
    for (const { id, platform, arrival, departure } of route.stops) {
      stationsSet.add(id);
      platformsSet.add(platform);
    }
  }

  const platforms = Array.from(platformsSet);
  const numRoutes = routes.length;
  const size = numRoutes + numStops;
  const data = new Uint32Array(size * 2);

  const idMap = Object.values(stations).reduce((accum, { id, tla }) => {
    accum[id] = tla;
    return accum;
  }, {});

  {
    let i = 0;
    for ({ id: routeId, from, to, days, stops } of routes) {
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
      for (const { id: stopId, platform, arrival, departure } of stops) {
        if (data[i] !== 0) throw new Error("Invalid state");
        const platformIndex = platforms.indexOf(platform);
        const d1 =
          (1 << 31) |
          ((stopId & 0b111111111111) << 18) |
          ((platformIndex & 0b11111111) << 10);
        const d2 =
          (0 << 31) |
          ((arrival & 0b11111111111) << 20) |
          ((departure & 0b11111111111) << 9);
        data[i] = d1;
        data[i + 1] = d2;
        i += 2;
      }
    }
  }

  console.log({ numRoutes, numStops, size, maxRouteStops });
  // console.log(fromTo);
  // console.log(Object.keys(fromTo).length);
  console.log(platforms.length);
  console.log(Object.keys(stations).length);
  console.log(stationsSet.size);
  // console.log(JSON.stringify({ stations, routes }).length)
  // fs.writeFileSync(
  //   '/home/jacob/Downloads/ttis989/ttisf989.json',
  //   JSON.stringify({ stations, routes })
  // );
  fs.writeFileSync(
    path.join(os.homedir(), "Downloads/ttis989/ttisf989.ui32"),
    new Uint8Array(data.buffer)
  );

  const ids = Object.values(stations).map(s => s.id);

  const POINTA = Object.values(stations).find(s => s.tla === "SUR").id;
  // const CLJ = Object.values(stations).find(s => s.tla === "CLJ").id;
  const POINTB = stations.WATRLMN.id;
  const TODAY = encodeDate(2018, 8, 9);
  const DAY = 1 << 6;

  console.time("ROUTE FAST");
  const fastRoutes = new Map();
  {
    let i = 0;
    while (i < data.length) {
      const startIndex = i;
      const nextIndex = i + (((data[i] >> 23) & 0b1111111) + 1) * 2;

      const routeId = (data[i] >>> 0) & 0b1111111111111111111111;
      const from = (data[i + 1] >>> 20) & 0b11111111111;
      const to = (data[i + 1] >>> 9) & 0b11111111111;
      const days = (data[i + 1] >>> 2) & 0b1111111;

      if ((days & DAY) !== 0 && TODAY >= from && TODAY <= to) {
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
                fastRoutes.set(routeId, startIndex);
                break;
              }
            }
            break;
          }
        }
      }

      i = nextIndex;
    }
  }
  console.timeEnd("ROUTE FAST");

  console.time("ROUTE");
  const slowRoutesArray = routes.filter(({ to, from, days, stops }) => {
    if ((days & DAY) === 0) return false;
    if (!(TODAY >= from && TODAY <= to)) return false;

    let i = 0;
    for (; i < stops.length; i += 1) {
      const { id } = stops[i];
      if (id === POINTB) {
        return false;
      } else if (id === POINTA) {
        break;
      }
    }

    i += 1;
    for (; i < stops.length; i += 1) {
      const { id } = stops[i];
      if (id === POINTB) {
        return true;
      }
    }

    return false;
  });
  const slowRoutes = slowRoutesArray.reduce(
    (accum, route) => accum.set(route.id, route),
    new Map()
  );
  console.timeEnd("ROUTE");

  // console.log(slowRoutes.map(r => r.stops.map(s => sIds[s.id])));
  console.log(fastRoutes.size);
  console.log(slowRoutes.size);
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
