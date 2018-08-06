const fs = require('fs');

async function* chunksToLines(chunksAsync) {
  let previous = '';
  for await (const chunk of chunksAsync) {
    previous += chunk;
    let eolIndex;
    while ((eolIndex = previous.indexOf('\n')) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex+1);
      yield line;
      previous = previous.slice(eolIndex+1);
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
    if (line[0] === 'A') {
      const toploc = line.slice(36, 43).trimRight();
      const tla = line.slice(43, 46);
      const id = i;
      
      stations[toploc] = { tla, id };
      
      i += 1;
    }
  }

  return stations;
}

const createRoute = () => ({ stops: [] });
const createStop = (stations, line) => {
  const station = stations[line.slice(2, 9).trimRight()];
  if (station == null) return null;
  const { id } = station;

  let arrival;
  let departure;
  let platform;

  switch (line[1]) {
    case 'O':
    case 'T':
      arrival = Number(line.slice(15, 17)) * 60 + Number(line.slice(17, 19));
      departure = arrival;
      platform = line.slice(19, 22).trimRight();
      break;
    case 'I':
      arrival = Number(line.slice(25, 27)) * 60 + Number(line.slice(27, 29));
      departure = Number(line.slice(29, 31)) * 60 + Number(line.slice(31, 33));
      platform = line.slice(33, 36).trimRight();
      break;
    default:
      throw new Error('Unknown format');
  }

  const time = arrival;
  const stall = departure - arrival;

  return { id, time, stall, platform };
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
      currentRoute = createRoute();
    } else if (scheduleDataRe.test(line)) {
      // Do nothing
    } else if (currentRoute != null && pointRe.test(line)) {
      const stop = createStop(stations, line);
      if (stop != null) {
        currentRoute.stops.push(stop);
        if (terminateRe.test(line)) {
          yield currentRoute
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
    fs.createReadStream('/home/jacob/Downloads/ttis989/ttisf989.msn', { encoding: 'utf-8' })
  ).next();

  const routes = [];
  const schedule = getSchedule(
    stations,
    fs.createReadStream('/home/jacob/Downloads/ttis989/ttisf989.mca', { encoding: 'utf-8' })
  );
  let size = 0
  const platforms = new Set();
  for await (const route of schedule) {
    routes.push(route);
    size += 1 + route.stops.length;
    for (const { platform } of route.stops) {
      platforms.add(platform.replace(/[FR]$/, ''));
    }
  }

  const compStations = new Set(Object.values(stations).map(s => s.tla));
  console.log(size)
  console.log(platforms.size)
  console.log(Object.keys(stations).length)
  console.log(compStations.size)
  // console.log(JSON.stringify({ stations, routes }).length)
  // fs.writeFileSync(
  //   '/home/jacob/Downloads/ttis989/ttisf989.json',
  //   JSON.stringify({ stations, routes })
  // );
}

/*
BINARY
x1098765432109876543210987654321
x1aaaaaaaaaaaabbbbbbbbbbccccccc
a - station id
b - time
c - platform
*/

run().next();
