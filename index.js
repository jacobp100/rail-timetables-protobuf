/* eslint-disable no-console, no-bitwise, no-restricted-syntax, require-yield, no-cond-assign, no-unused-vars, no-param-reassign, prefer-const */
const path = require("path");
const fs = require("fs");
const os = require("os");
const protobuf = require("protobufjs");
const { sortBy } = require("lodash");

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
  for await (const [name, crc] of parseCsv(dataStream)) {
    names[crc] = name;
  }
  return Object.keys(names)
    .sort()
    .reduce((accum, crc, index) => {
      accum[crc] = { id: index, crc, name: names[crc] };
      return accum;
    }, {});
}

async function* getStationIdMap(crcs, dataStream) {
  let i = 0;
  const stations = {};

  for await (const line of chunksToLines(dataStream)) {
    if (line[0] === "A") {
      const crc = line.slice(43, 46);

      if (crcs[crc]) {
        const { id } = crcs[crc];
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

const reverseString = str =>
  str
    .split("")
    .reverse()
    .join("");

const createRoute = line => {
  // const status = line.slice(79, 80).trimRight();
  const typeCode = line.slice(30, 32).trimRight();
  const type = types[typeCode];

  if (type == null) {
    throw new Error(`Expected type for ${typeCode}`);
  }

  const routeId = line.slice(3, 9);
  const operatingDays = parseInt(reverseString(line.slice(21, 28)), 2);

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

  return { routeId, operatingDays, dateFrom, dateTo, stops: [] };
};
const createStop = (stations, line) => {
  const stationId = stations[line.slice(2, 9).trimRight()];
  if (stationId == null) return null;

  let arrival;
  let departure;
  let platformString;

  switch (line[1]) {
    case "O":
    case "T":
      arrivalTime = encodeTime(
        Number(line.slice(15, 17)),
        Number(line.slice(17, 19))
      );
      departureTime = arrivalTime;
      platform = line.slice(19, 22).trimRight();
      break;
    case "I": {
      const passTime = line.slice(20, 24).trimRight();
      if (passTime.length > 0) return null;

      arrivalTime = encodeTime(
        Number(line.slice(25, 27)),
        Number(line.slice(27, 29))
      );
      departureTime = encodeTime(
        Number(line.slice(29, 31)),
        Number(line.slice(31, 33))
      );
      platform = line.slice(33, 36).trimRight();
      break;
    }
    default:
      throw new Error("Unknown format");
  }

  return { stationId, arrivalTime, departureTime, platform };
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

const loadProtoBuf = f =>
  new Promise((res, rej) => {
    protobuf.load("types.proto", (err, root) => {
      if (err) {
        rej(err);
      } else {
        res(root);
      }
    });
  });

async function* run() {
  const { value: crcMap } = await getTlaMap(
    fs.createReadStream(path.join(__dirname, "station_codes.csv"), {
      encoding: "utf-8"
    })
  ).next();

  const { value: stationMap } = await getStationIdMap(
    crcMap,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.msn"),
      { encoding: "utf-8" }
    )
  ).next();

  const schedule = getRoutes(
    stationMap,
    fs.createReadStream(
      path.join(os.homedir(), "Downloads/ttis989/ttisf989.mca"),
      { encoding: "utf-8" }
    )
  );

  let routes = [];
  for await (const route of schedule) {
    routes.push(route);
  }

  const stations = Object.values(sortBy(crcMap, "index"));
  fs.writeFileSync(
    path.join(os.homedir(), "Downloads/ttis989/stations.json"),
    JSON.stringify(stations)
  );

  const message = { routes };
  const root = await loadProtoBuf("types.proto");
  const buffer = root
    .lookupType("types.Data")
    .encode(message)
    .finish();

  fs.writeFileSync(
    path.join(os.homedir(), "Downloads/ttis989/ttisf989.pr"),
    buffer
  );
}

run().next();
