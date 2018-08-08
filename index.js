const fs = require("fs");

const encodeTime = (h, m) => h * 60 + m;

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

const createRoute = line => ({
  stops: [],
  id: line.slice(3, 10),
  days: parseInt(line.slice(21, 28), 2),
  from: line.slice(9, 15),
  to: line.slice(15, 21)
});
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
const scheduleDataRe = /^BX/;
const pointRe = /^L[OIT]/;
const originRe = /^LO/;
const intermediateRe = /^LI/;
const terminateRe = /^LT/;

async function* getSchedule(stations, dataStream) {
  let currentRoute = null;

  for await (const line of chunksToLines(dataStream)) {
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
}

async function* run() {
  const { value: stations } = await getStations(
    fs.createReadStream("/home/jacob/Downloads/ttis989/ttisf989.msn", {
      encoding: "utf-8"
    })
  ).next();

  const routes = [];
  const schedule = getSchedule(
    stations,
    fs.createReadStream("/home/jacob/Downloads/ttis989/ttisf989.mca", {
      encoding: "utf-8"
    })
  );

  let numStops = 0;
  let maxRouteStops = 0;
  const stationsSet = new Set();
  const platformsSet = new Set();

  for await (const route of schedule) {
    routes.push(route);
    numStops += route.stops.length;
    maxRouteStops = Math.max(maxRouteStops, route.stops.length);
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

  let i = 0;
  for ({ days, stops } of routes) {
    data[i] = (0 << 31) | (days << 24) | ((stops.length & 0b1111111) << 17);
    i += 2;
    for (const { id, platform, arrival, departure } of stops) {
      const platformIndex = platforms.indexOf(platform);
      const d1 =
        (1 << 31) |
        ((id & 0b111111111111) << 18) |
        ((platformIndex & 0b11111111) << 10);
      const d2 =
        (0 << 31) |
        ((arrival & 0b11111111111) << 20) |
        ((departure & 0b11111111111) << 9);
      data[i] = d1;
      data[i + 1] = id; // d2;
      i += 2;
    }
  }

  console.log({ numRoutes, numStops, size, maxRouteStops });
  console.log(platforms.length);
  console.log(Object.keys(stations).length);
  console.log(stationsSet.size);
  // console.log(JSON.stringify({ stations, routes }).length)
  // fs.writeFileSync(
  //   '/home/jacob/Downloads/ttis989/ttisf989.json',
  //   JSON.stringify({ stations, routes })
  // );
  fs.writeFileSync(
    "/home/jacob/Downloads/ttis989/ttisf989.ui32",
    new Uint8Array(data.buffer)
  );

  const ids = Object.values(stations).map(s => s.id);

  const SUR = Object.values(stations).find(s => s.tla === "SUR").id;
  const CLJ = Object.values(stations).find(s => s.tla === "CLJ").id;
  const WAT = CLJ; // stations.WATRLMN.id;

  console.time("ROUTE FAST");
  const DAY = (1 << 6) << 24;
  const foundRoutes = [];
  for (let i = 0; i < data.length; i += 2) {
    if ((data[i] & (1 << 31)) !== 0) {
      throw new Error("Invalid state");
    }

    const startIndex = i;
    const nextIndex = i + ((data[i] >> 17) & 0b1111111) * 2;
    if ((data[i] & DAY) !== 0) {
      i += 2;
      for (; i < nextIndex; i += 2) {
        if ((data[i] & (1 << 31)) === 0) {
          throw new Error("Invalid state");
        }

        // const from = (data[i] >> 18) & 0b111111111111;
        const from = data[i + 1];
        if (from === WAT) {
          i = nextIndex;
          break;
        } else if (from === SUR) {
          i += 2;
          for (; i < nextIndex; i += 2) {
            if ((data[i] & (1 << 31)) === 0) {
              throw new Error("Invalid state");
            }

            // const to = (data[i] >> 18) & 0b111111111111;
            const to = data[i + 1];
            if (to === WAT) {
              foundRoutes.push(startIndex);
              i = nextIndex;
              break;
            }
          }
          break;
        }
      }
    }

    i = nextIndex;
  }
  console.timeEnd("ROUTE FAST");

  console.time("ROUTE");
  const surWatOnMon = routes.filter(({ days, stops }) => {
    if ((days & (1 << 6)) === 0) return false;

    let i = 0;
    for (; i < stops.length; i += 1) {
      const { id } = stops[i];
      if (id === WAT) {
        return false;
      } else if (id === SUR) {
        break;
      }
    }

    i += 1;
    for (; i < stops.length; i += 1) {
      const { id } = stops[i];
      if (id === WAT) {
        return true;
      }
    }

    return false;
  });
  console.timeEnd("ROUTE");

  // console.log(surWatOnMon.map(r => r.stops.map(s => sIds[s.id])));
  console.log(foundRoutes.length);
  console.log(surWatOnMon.length);
}

/*
ROUTE
a (7) - days
b (22) - id
c (16) - from
d (16) - to
e (7) - numStops

STOP
a (12) - station id
b (11) - arrival
c (11) - departure
d  (8) - platform
*/

run().next();
