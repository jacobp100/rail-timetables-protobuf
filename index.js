/* eslint-disable no-console, no-bitwise, no-restricted-syntax, require-yield, no-cond-assign, no-unused-vars, no-param-reassign, prefer-const */
// If this fails, run node --max_old_space_size=6000 index.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const protobuf = require("protobufjs");
const { flatbuffers } = require("flatbuffers");
const sqlite3 = require("sqlite3");
const { sortBy } = require("lodash");
const FlatTypes = require("./flat-js/types_generated");

const ttis = process.argv[2] || "515";
const dir = path.join(os.homedir(), "Downloads", `ttis${ttis}`);

const attempt = fn => {
  try {
    fn();
  } catch (e) {}
};

const createIndexTable = () => {
  const values = [];
  const fn = value => {
    let index = values.indexOf(value);
    if (index === -1) index = values.push(value) - 1;
    return index;
  };
  fn.getValues = () => values;
  return fn;
};

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

const routesIndexTable = createIndexTable();
const createRoute = line => {
  // const status = line.slice(79, 80).trimRight();
  const typeCode = line.slice(30, 32).trimRight();
  const type = types[typeCode];

  if (type == null) {
    throw new Error(`Expected type for ${typeCode}`);
  }

  const routeIdValue = line.slice(3, 9);
  const routeId = routesIndexTable(routeIdValue);
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

async function writeToProtobuf(routes) {
  const message = { routes };
  const root = await loadProtoBuf("types.proto");
  const buffer = root
    .lookupType("types.Data")
    .encode(message)
    .finish();

  fs.writeFileSync(path.join(dir, `ttisf${ttis}.pr`), buffer);
}

async function writeToFlatBuf(routes) {
  const builder = new flatbuffers.Builder(0);

  const routesData = routes.map(route => {
    const stopsData = route.stops.map(stop => {
      const platform = builder.createString(stop.platform);
      FlatTypes.Stop.startStop(builder);
      FlatTypes.Stop.addStationId(builder, stop.stationId);
      FlatTypes.Stop.addArrivalTime(builder, stop.arrivalTime);
      FlatTypes.Stop.addDepartureTime(builder, stop.departureTime);
      FlatTypes.Stop.addPlatform(builder, platform);
      return FlatTypes.Stop.endStop(builder);
    });
    const stopsVector = FlatTypes.Route.createStopsVector(builder, stopsData);

    const routeId = builder.createString(route.routeId);
    FlatTypes.Route.startRoute(builder);
    FlatTypes.Route.addRouteId(builder, routeId);
    FlatTypes.Route.addOperatingDays(builder, route.operatingDays);
    FlatTypes.Route.addDateFrom(builder, route.dateFrom);
    FlatTypes.Route.addDateTo(builder, route.dateTo);
    FlatTypes.Route.addStops(builder, stopsVector);
    return FlatTypes.Route.endRoute(builder);
  });
  const routesVector = FlatTypes.Root.createRoutesVector(builder, routesData);

  FlatTypes.Root.startRoot(builder);
  FlatTypes.Root.addRoutes(builder, routesVector);
  const data = FlatTypes.Root.endRoot(builder);

  FlatTypes.Root.finishRootBuffer(builder, data);

  const buffer = builder.asUint8Array();

  fs.writeFileSync(path.join(dir, `ttisf${ttis}.fb`), buffer);
}

async function writeToSqlite(routes) {
  const dbFilename = path.join(dir, `ttisf${ttis}.db`);
  attempt(() => fs.rmSync(dbFilename));

  const db = new sqlite3.Database(dbFilename);

  db.serialize(() => {
    db.exec(`
      DROP TABLE IF EXISTS route;
      CREATE TABLE route(
        atocId STRING,
        routeId INTEGER PRIMARY KEY,
        operatingDays INTEGER,
        dateFrom INTEGER,
        dateTo INTEGER
      );

      DROP TABLE IF EXISTS stop;
      CREATE TABLE stop(
        routeId INTEGER,
        stationId INTEGER,
        arrivalTime INTEGER,
        departureTime INTEGER,
        platform STRING,
        FOREIGN KEY(routeId) REFERENCES route(routeId)
      );
    `);

    const addRoute = db.prepare("INSERT INTO route VALUES (?, ?, ?, ?, ?)");
    const addStop = db.prepare("INSERT INTO stop VALUES (?, ?, ?, ?, ?)");

    db.parallelize(() => {
      routes.forEach((route, routeId) => {
        const atocId = route.routeId;
        addRoute.run(
          atocId,
          routeId,
          route.operatingDays,
          route.dateFrom,
          route.dateTo
        );

        route.stops.forEach(stop => {
          addStop.run(
            routeId,
            stop.stationId,
            stop.arrivalTime,
            stop.departureTime,
            stop.platform
          );
        });
      });

      addRoute.finalize();
      addStop.finalize();
    });
  });

  db.close();
}

async function* run() {
  const { value: crcMap } = await getTlaMap(
    fs.createReadStream(path.join(__dirname, "station_codes.csv"), {
      encoding: "utf-8"
    })
  ).next();

  const { value: stationMap } = await getStationIdMap(
    crcMap,
    fs.createReadStream(path.join(dir, `ttisf${ttis}.msn`), {
      encoding: "utf-8"
    })
  ).next();

  const schedule = getRoutes(
    stationMap,
    fs.createReadStream(path.join(dir, `ttisf${ttis}.mca`), {
      encoding: "utf-8"
    })
  );

  let routes = [];
  for await (const route of schedule) {
    routes.push(route);
  }

  const stations = Object.values(sortBy(crcMap, "index"));
  fs.writeFileSync(path.join(dir, "/stations.json"), JSON.stringify(stations));

  await Promise.all([
    writeToProtobuf(routes)
    // writeToFlatBuf(routes)
    // writeToSqlite(routes)
  ]);
}

run().next();
