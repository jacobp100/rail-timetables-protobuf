const fs = require("fs");

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

  for await (const line of chunksToLines(dataStream)) {
    if (line[0] === "A") {
      const toploc = line.slice(36, 43).trimRight();
      const tla = line.slice(43, 46);
      const id = i;

      stations[toploc] = { tla, id };

      i += 1;
    }
  }

  return stations;
}

const createRoute = line => ({
  stops: [],
  id: line.slice(3, 10),
  days: Array.from(line.slice(21, 28), Number),
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
      arrival = Number(line.slice(15, 17)) * 60 + Number(line.slice(17, 19));
      departure = arrival;
      platform = line.slice(19, 22).trimRight();
      break;
    case "I":
      arrival = Number(line.slice(25, 27)) * 60 + Number(line.slice(27, 29));
      departure = Number(line.slice(29, 31)) * 60 + Number(line.slice(31, 33));
      platform = line.slice(33, 36).trimRight();
      break;
    default:
      throw new Error("Unknown format");
  }

  return { id, platform, arrival, departure };
};
const scheduleRe = /^BS/;
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
    fs.createReadStream("/Users/jacob/Downloads/ttis989/ttisf989.msn", {
      encoding: "utf-8"
    })
  ).next();

  const routes = [];
  const schedule = getSchedule(
    stations,
    fs.createReadStream("/Users/jacob/Downloads/ttis989/ttisf989.mca", {
      encoding: "utf-8"
    })
  );

  let size = 0;
  const platformsSet = new Set();

  for await (const route of schedule) {
    routes.push(route);
    size += 1 + route.stops.length;
    for (const { platform, arrival, departure } of route.stops) {
      platformsSet.add(platform);
    }
  }

  const platforms = Array.from(platformsSet);
  const data = new Uint32Array(size * 2);

  let i = 0;
  for (route of routes) {
    i += 2;
    for (const { id, platform, arrival, departure } of route.stops) {
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
      data[i + 1] = d2;
      i += 2;
    }
  }

  console.log(size);
  console.log(platforms.length);
  console.log(Object.keys(stations).length);
  // console.log(JSON.stringify({ stations, routes }).length)
  // fs.writeFileSync(
  //   '/Users/jacob/Downloads/ttis989/ttisf989.json',
  //   JSON.stringify({ stations, routes })
  // );
  fs.writeFileSync(
    "/Users/jacob/Downloads/ttis989/ttisf989.ui32",
    new Uint8Array(data.buffer)
  );
}

/*
ROUTE
a (7) - days
d (22) - id
b (16) - from
c (16) - to

STOP
a (12) - station id
b (11) - arrival
c (11) - departure
d  (8) - platform
*/

run().next();
