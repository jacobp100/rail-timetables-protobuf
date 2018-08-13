const axios = require("axios");
const parser = require("fast-xml-parser");

const queueName = "D34fd2fced-994f-41c9-83ef-b4404491bcfe";
const user = "d3user";
const password = "d3password";
// r6a-Urs-aqD-SHM

const token = "d8e6b11e-b942-4941-b42e-f4b16d2c9239";

let query = `
  <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types" xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/">
    <soap:Header>
        <typ:AccessToken>
          <typ:TokenValue>${token}</typ:TokenValue>
        </typ:AccessToken>
    </soap:Header>
    <soap:Body>
        <ldb:GetNextDeparturesWithDetailsRequest>
          <ldb:numRows>12</ldb:numRows>
          <ldb:crs>WAT</ldb:crs>
          <ldb:filterList>
              <ldb:crs>SUR</ldb:crs>
          </ldb:filterList>
          <ldb:timeOffset>0</ldb:timeOffset>
          <ldb:timeWindow>120</ldb:timeWindow>
        </ldb:GetNextDeparturesWithDetailsRequest>
    </soap:Body>
  </soap:Envelope>
`.trim();

query = `
  <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types" xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/">
    <soap:Header>
        <typ:AccessToken>
          <typ:TokenValue>${token}</typ:TokenValue>
        </typ:AccessToken>
    </soap:Header>
    <soap:Body>
        <ldb:GetDepartureBoardRequest>
          <ldb:numRows>12</ldb:numRows>
          <ldb:crs>CHX</ldb:crs>
          <ldb:filterCrs>HYS</ldb:filterCrs>
          <ldb:filterType>to</ldb:filterType>
          <ldb:timeOffset>0</ldb:timeOffset>
          <ldb:timeWindow>120</ldb:timeWindow>
        </ldb:GetDepartureBoardRequest>
    </soap:Body>
  </soap:Envelope>
`.trim();

const getTime = str => {
  if (str != null && str.includes(":")) {
    const [h, m] = str.split(":");
    return Number(h) * 60 + Number(m);
  } else {
    return null;
  }
};

const safeString = s => (s != null ? String(s) : null);

const status = {
  ON_TIME: 0,
  DELAYED_BY: 1,
  DELAYED: 2,
  CANCELLED: 3
};

const parseService = ({
  "lt4:serviceID": serviceId,
  "lt4:etd": etd,
  "lt4:std": std,
  "lt4:platform": platform
}) => {
  const startPlatform = safeString(platform);
  if (etd === "On time") {
    return {
      serviceId,
      startTime: getTime(std),
      status: { type: status.ON_TIME },
      startPlatform
    };
  } else if (etd === "Delayed") {
    return {
      serviceId,
      startTime: null,
      status: { type: status.DELAYED },
      startPlatform
    };
  } else if (etd === "Cancelled") {
    return {
      serviceId,
      startTime: null,
      status: { type: status.CANCELLED },
      startPlatform: null
    };
  } else if (getTime(etd) != null) {
    return {
      serviceId,
      startTime: getTime(etd),
      status: {
        type: status.DELAYED_BY,
        by: getTime(etd) - getTime(std)
      },
      startPlatform
    };
  } else {
    return null;
  }
};

axios("https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb9.asmx", {
  method: "post",
  headers: { "Content-Type": "text/xml" },
  data: query
})
  .then(r => parser.parse(r.data))
  .then(r => {
    return r["soap:Envelope"]["soap:Body"].GetDepartureBoardResponse
      .GetStationBoardResult;
  })
  .then(r => {
    return r["lt5:trainServices"]["lt5:service"].map(parseService);
  })
  .then(console.log)
  .catch(console.error);
